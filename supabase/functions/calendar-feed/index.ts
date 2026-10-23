// Calendar subscription feed (DECISIONS D-036).
//
// GET /functions/v1/calendar-feed/<token>.ics — no Supabase auth, because calendar apps
// can't send any. The secret token (calendar_feeds, service-role only) is the credential;
// the app can rotate it, which makes the old URL return 404.
//
// Output follows RFC 5545: CRLF line endings, lines folded at 75 octets, TEXT values
// escaped. Every team the user belongs to is included, from 60 days back onward. No
// player names, RSVPs, or contacts are ever written to the feed.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { adminClient } from "../_shared/http.ts";

const PAST_WINDOW_MS = 60 * 24 * 3600_000;
const DEFAULT_DURATION_MS = 3600_000;
const MAX_EVENTS = 1500;
const NO_TEAM = "00000000-0000-0000-0000-000000000000";

interface Team {
  id: string;
  name: string;
}
interface EventRow {
  id: string;
  team_id: string;
  title: string;
  event_type: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  location_address: string | null;
  notes: string | null;
  opponent: string | null;
  home_away: string | null;
  cancelled_at: string | null;
  updated_at: string;
  created_at: string;
}

/** Same team set as mobile-api's `context`: staff/org roles, guardian links, own player login. */
async function teamsFor(admin: SupabaseClient, userId: string): Promise<Team[]> {
  const [{ data: roles }, { data: links }, { data: selfPlayers }] = await Promise.all([
    admin.from("user_roles").select("team_id, org_id").eq("user_id", userId),
    admin.from("parent_player_links").select("players!inner(team_id, archived_at)").eq("parent_user_id", userId),
    admin.from("players").select("team_id").eq("user_id", userId).is("archived_at", null),
  ]);
  const teamIds = new Set<string>();
  (roles ?? []).forEach((r) => r.team_id && teamIds.add(r.team_id));
  (links ?? []).forEach((l) => {
    const pl = l.players as unknown as { team_id: string; archived_at: string | null };
    if (!pl.archived_at) teamIds.add(pl.team_id);
  });
  (selfPlayers ?? []).forEach((p) => teamIds.add(p.team_id));
  const orgIds = (roles ?? []).filter((r) => !r.team_id && r.org_id).map((r) => r.org_id as string);

  const ids = [...teamIds].join(",") || NO_TEAM;
  let q = admin.from("teams").select("id, name").is("archived_at", null);
  q = orgIds.length > 0 ? q.or(`id.in.(${ids}),org_id.in.(${orgIds.join(",")})`) : q.in("id", [...teamIds].length ? [...teamIds] : [NO_TEAM]);
  const { data } = await q;
  return (data ?? []) as Team[];
}

/** RFC 5545 §3.3.11 TEXT escaping. */
function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: fold lines longer than 75 octets, never splitting a UTF-8 character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** UTC DATE-TIME form, e.g. 20261024T160000Z. */
function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function summary(ev: EventRow, team: Team | undefined, multiTeam: boolean): string {
  let title = ev.title;
  if (ev.event_type === "game" && ev.opponent) title = `${ev.home_away === "away" ? "@" : "vs"} ${ev.opponent}`;
  if (multiTeam && team) title = `${title} · ${team.name}`;
  // No "Cancelled:" prefix: STATUS:CANCELLED already makes Apple Calendar strike the event
  // through and label it "CANCELED:" (seen in testing, D-036), so a prefix doubles it.
  return title;
}

function description(ev: EventRow, team: Team | undefined): string {
  const lines: string[] = [];
  if (team) lines.push(team.name);
  if (ev.event_type === "game") {
    lines.push(["Game", ev.home_away === "home" ? "Home" : ev.home_away === "away" ? "Away" : null].filter(Boolean).join(" · "));
  }
  if (ev.notes) lines.push("", ev.notes);
  lines.push("", ev.cancelled_at ? "This event was cancelled." : "RSVP and team updates are in the ClubHQ app.");
  return lines.join("\n");
}

function buildCalendar(teams: Team[], events: EventRow[]): string {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const multiTeam = teams.length > 1;
  const name = teams.length === 1 ? `${teams[0].name} (ClubHQ)` : "ClubHQ";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClubHQ//Team Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${text(name)}`,
    `X-WR-CALNAME:${text(name)}`,
    `X-WR-CALDESC:${text("Practices and games from ClubHQ. Changes made by your coach show up here automatically.")}`,
    // Refresh hints only (RFC 7986 / Apple & Microsoft extension); each app picks its own schedule.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const ev of events) {
    const team = byId[ev.team_id];
    const end = ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + DEFAULT_DURATION_MS).toISOString();
    const location = [ev.location, ev.location_address].filter((v) => v && v.trim()).join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id}@teamclubhq.com`,
      `DTSTAMP:${stamp(ev.updated_at)}`,
      `CREATED:${stamp(ev.created_at)}`,
      `LAST-MODIFIED:${stamp(ev.updated_at)}`,
      `DTSTART:${stamp(ev.starts_at)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${text(summary(ev, team, multiTeam))}`,
      `DESCRIPTION:${text(description(ev, team))}`,
    );
    if (location) lines.push(`LOCATION:${text(location)}`);
    lines.push(`STATUS:${ev.cancelled_at ? "CANCELLED" : "CONFIRMED"}`, "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function notFound(): Response {
  return new Response("Calendar not found. Open ClubHQ → Schedule → Calendar sync for a current link.\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("GET only\n", { status: 405 });
  try {
    const url = new URL(req.url);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const token = (url.searchParams.get("token") ?? (last === "calendar-feed" ? "" : last)).replace(/\.ics$/i, "");
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return notFound();

    const admin = adminClient();
    const { data: feed } = await admin.from("calendar_feeds").select("user_id, last_fetched_at").eq("token", token).maybeSingle();
    if (!feed) return notFound();

    const teams = await teamsFor(admin, feed.user_id);
    let events: EventRow[] = [];
    if (teams.length > 0) {
      const { data } = await admin
        .from("events")
        .select("id, team_id, title, event_type, starts_at, ends_at, location, location_address, notes, opponent, home_away, cancelled_at, updated_at, created_at")
        .in("team_id", teams.map((t) => t.id))
        .gte("starts_at", new Date(Date.now() - PAST_WINDOW_MS).toISOString())
        .order("starts_at", { ascending: true })
        .limit(MAX_EVENTS);
      events = (data ?? []) as EventRow[];
    }

    // Record use at most hourly, so support can tell whether a feed is being fetched.
    if (!feed.last_fetched_at || Date.now() - new Date(feed.last_fetched_at).getTime() > 3600_000) {
      await admin.from("calendar_feeds").update({ last_fetched_at: new Date().toISOString() }).eq("token", token);
    }

    const body = buildCalendar(teams, events);
    return new Response(req.method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="clubhq.ics"',
        "Cache-Control": "private, no-cache", // a reset link must stop working at once
      },
    });
  } catch (e) {
    console.error("calendar-feed failed", e);
    return new Response("Temporarily unavailable\n", { status: 503, headers: { "Retry-After": "300" } });
  }
});
