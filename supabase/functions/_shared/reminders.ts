// Event reminders and RSVP nudges (DECISIONS D-045), run every 5 minutes by pg_cron through
// the `scheduled-jobs` function. Planning (which reminder is due, what it says) is pure and
// tested in supabase/tests/reminders_test.ts; `runReminders` does the I/O.
//
//   day_before  18–30 h before start, sent between 7 AM and 9 PM team time ("Tomorrow: Practice")
//   two_hours   1.5–2.5 h before start, any hour ("In 2 hours: Game vs Rage")
//   rsvp_nudge  RSVP cutoff 1–24 h away, 8 AM–8 PM team time, only to families of players who
//               haven't responded ("Jordan hasn't RSVP'd")
// Each (event, kind) is claimed in `event_reminder_log` before sending, so overlapping runs and
// retries never send twice. Users can turn either kind off (`profiles.notification_prefs`).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { enqueueTeamNotification } from "./notify.ts";
import { formatEventTime, validTimeZone } from "./time.ts";

const HOUR = 3600_000;
const DEFAULT_ZONE = "America/Chicago";
const DEFAULT_CUTOFF_LEAD_MS = 4 * HOUR;

export type ReminderKind = "day_before" | "two_hours" | "rsvp_nudge";

export interface ReminderEvent {
  id: string;
  team_id: string;
  title: string;
  event_type: "practice" | "game" | "other";
  starts_at: string;
  rsvp_cutoff_at: string | null;
  location: string | null;
  opponent: string | null;
  home_away: string | null;
}

/** Hour of day (0–23) at `ms` in `tz`. */
export function localHour(ms: number, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
}

function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Which reminders are due for this event right now (before checking the log). */
export function dueReminders(ev: ReminderEvent, now: number, tz: string): ReminderKind[] {
  const start = new Date(ev.starts_at).getTime();
  const until = start - now;
  const due: ReminderKind[] = [];
  if (until <= 30 * HOUR && until >= 18 * HOUR) {
    const h = localHour(now, tz);
    if (h >= 7 && h < 21) due.push("day_before");
  }
  if (until <= 2.5 * HOUR && until >= 1.5 * HOUR) due.push("two_hours");
  const cutoff = ev.rsvp_cutoff_at ? new Date(ev.rsvp_cutoff_at).getTime() : start - DEFAULT_CUTOFF_LEAD_MS;
  const untilCutoff = cutoff - now;
  if (untilCutoff <= 24 * HOUR && untilCutoff >= 1 * HOUR) {
    const h = localHour(now, tz);
    if (h >= 8 && h < 20) due.push("rsvp_nudge");
  }
  return due;
}

/** "Game vs Rage", "Game @ Kings Gold", or the event title. */
export function eventLabel(ev: ReminderEvent): string {
  if (ev.event_type === "game" && ev.opponent) return `Game ${ev.home_away === "away" ? "@" : "vs"} ${ev.opponent}`;
  return ev.title;
}

/** "Today", "Tomorrow", or the weekday, as seen in the team's zone. */
export function relativeDay(eventMs: number, now: number, tz: string): string {
  const day = localDate(eventMs, tz);
  if (day === localDate(now, tz)) return "Today";
  if (day === localDate(now + 24 * HOUR, tz)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(eventMs));
}

/** "Jordan", "Jordan and Mia", "Jordan, Mia and Sam". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function reminderText(kind: ReminderKind, ev: ReminderEvent, now: number, tz: string, kids: string[] = []): { subject: string; body: string } {
  const start = new Date(ev.starts_at).getTime();
  const when = formatEventTime(ev.starts_at, tz);
  const where = ev.location ? ` · ${ev.location}` : "";
  const label = eventLabel(ev);
  switch (kind) {
    case "day_before":
      return { subject: `${relativeDay(start, now, tz)}: ${label}`, body: `${when}${where}` };
    case "two_hours":
      return { subject: `In 2 hours: ${label}`, body: `${when}${where}` };
    case "rsvp_nudge": {
      const cutoff = ev.rsvp_cutoff_at ?? new Date(start - DEFAULT_CUTOFF_LEAD_MS).toISOString();
      const who = joinNames(kids);
      return {
        subject: `RSVP needed: ${label}`,
        body: `${who} ${kids.length > 1 ? "haven't" : "hasn't"} responded for ${when}. RSVPs close ${formatEventTime(cutoff, tz)}.`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------
type Prefs = { event_reminders?: boolean; rsvp_reminders?: boolean };

/** Users who turned this kind of reminder off. */
async function optedOut(admin: SupabaseClient, userIds: string[], key: keyof Prefs): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await admin.from("profiles").select("id, notification_prefs").in("id", userIds);
  return new Set((data ?? []).filter((p) => (p.notification_prefs as Prefs | null)?.[key] === false).map((p) => p.id));
}

/** Everyone who gets team-wide event news: guardians, staff and player accounts. */
async function teamAudience(admin: SupabaseClient, teamId: string): Promise<string[]> {
  const [{ data: parents }, { data: staff }, { data: players }] = await Promise.all([
    admin.from("parent_player_links").select("parent_user_id, players!inner(team_id, archived_at)").eq("players.team_id", teamId).is("players.archived_at", null),
    admin.from("user_roles").select("user_id").eq("team_id", teamId).in("role", ["head_coach", "assistant_coach", "team_manager"]),
    admin.from("players").select("user_id").eq("team_id", teamId).is("archived_at", null).not("user_id", "is", null),
  ]);
  return [...new Set([
    ...(parents ?? []).map((p: { parent_user_id: string }) => p.parent_user_id),
    ...(staff ?? []).map((s: { user_id: string }) => s.user_id),
    ...(players ?? []).map((p: { user_id: string }) => p.user_id),
  ])];
}

/** Claims (event, kind) in the log; false when another run already sent it. */
async function claim(admin: SupabaseClient, eventId: string, kind: ReminderKind): Promise<boolean> {
  const { data, error } = await admin
    .from("event_reminder_log")
    .upsert({ event_id: eventId, kind }, { onConflict: "event_id,kind", ignoreDuplicates: true })
    .select("event_id");
  return !error && (data?.length ?? 0) > 0;
}

export interface ReminderRun {
  checked: number;
  sent: Record<ReminderKind, number>;
}

export async function runReminders(admin: SupabaseClient, now = Date.now()): Promise<ReminderRun> {
  const run: ReminderRun = { checked: 0, sent: { day_before: 0, two_hours: 0, rsvp_nudge: 0 } };
  const { data: events } = await admin
    .from("events")
    .select("id, team_id, title, event_type, starts_at, rsvp_cutoff_at, location, opponent, home_away, teams!inner(time_zone, archived_at)")
    .is("cancelled_at", null)
    .is("teams.archived_at", null)
    .gte("starts_at", new Date(now + 1 * HOUR).toISOString())
    .lte("starts_at", new Date(now + 30 * HOUR).toISOString())
    .limit(1000);
  for (const raw of events ?? []) {
    const ev = raw as unknown as ReminderEvent & { teams: { time_zone: string | null } };
    run.checked++;
    const tz = validTimeZone(ev.teams?.time_zone) ?? DEFAULT_ZONE;
    for (const kind of dueReminders(ev, now, tz)) {
      if (!(await claim(admin, ev.id, kind))) continue;
      try {
        run.sent[kind] += kind === "rsvp_nudge" ? await sendNudges(admin, ev, now, tz) : await sendEventReminder(admin, ev, kind, now, tz);
      } catch (e) {
        console.error("reminder failed", ev.id, kind, e);
      }
    }
  }
  return run;
}

async function sendEventReminder(admin: SupabaseClient, ev: ReminderEvent, kind: ReminderKind, now: number, tz: string): Promise<number> {
  const audience = await teamAudience(admin, ev.team_id);
  const off = await optedOut(admin, audience, "event_reminders");
  const recipients = audience.filter((u) => !off.has(u));
  if (recipients.length === 0) return 0;
  const { subject, body } = reminderText(kind, ev, now, tz);
  return await enqueueTeamNotification(admin, { teamId: ev.team_id, kind: "event_reminder", subject, body, refId: ev.id, recipientUserIds: recipients });
}

/** One nudge per family, naming their kids who haven't responded. */
async function sendNudges(admin: SupabaseClient, ev: ReminderEvent, now: number, tz: string): Promise<number> {
  const [{ data: roster }, { data: rsvps }] = await Promise.all([
    admin.from("players").select("id, first_name, user_id").eq("team_id", ev.team_id).is("archived_at", null),
    admin.from("rsvps").select("player_id").eq("event_id", ev.id),
  ]);
  const answered = new Set((rsvps ?? []).map((r) => r.player_id));
  const missing = (roster ?? []).filter((p) => !answered.has(p.id));
  if (missing.length === 0) return 0;
  const { data: links } = await admin.from("parent_player_links").select("player_id, parent_user_id").in("player_id", missing.map((p) => p.id));
  const kidsByUser = new Map<string, string[]>();
  const add = (uid: string, name: string) => kidsByUser.set(uid, [...(kidsByUser.get(uid) ?? []), name]);
  for (const l of links ?? []) add(l.parent_user_id, missing.find((p) => p.id === l.player_id)!.first_name);
  for (const p of missing) if (p.user_id) add(p.user_id, p.first_name);
  const off = await optedOut(admin, [...kidsByUser.keys()], "rsvp_reminders");
  let sent = 0;
  for (const [uid, kids] of kidsByUser) {
    if (off.has(uid)) continue;
    const { subject, body } = reminderText("rsvp_nudge", ev, now, tz, [...new Set(kids)]);
    sent += await enqueueTeamNotification(admin, { teamId: ev.team_id, kind: "rsvp_reminder", subject, body, refId: ev.id, recipientUserIds: [uid] });
  }
  return sent;
}
