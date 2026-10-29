// Automatic re-checks of team calendar imports (DECISIONS D-047, roadmap #3), run by scheduled-jobs.
// Each calendar import is re-read about every 20 minutes while it has upcoming events (every 6
// hours once it doesn't). Changes to upcoming events are applied like Check for Changes and
// families get one "time changed" push — faster than the source apps' own calendar sync, which
// phones refresh as rarely as once a day. A failed read never touches the games.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { ApiError } from "./http.ts";
import { enqueueTeamNotification } from "./notify.ts";
import { applyImport, changeNotice, loadSource } from "./scheduleImport.ts";
import { CALENDAR_TEAM_KEY } from "./icalImport.ts";
import { mapLimited } from "./sheetImport.ts";

const ACTIVE_EVERY_MS = 20 * 60_000;
const IDLE_EVERY_MS = 6 * 3600_000;
/** After this many failures in a row, try only every 6 hours. */
const BACKOFF_AFTER = 3;
const PER_RUN = 25;

interface ImportRow {
  id: string;
  team_id: string;
  source_url: string;
  title: string;
  sheet_team_key: string;
  time_zone: string | null;
  created_by: string | null;
  last_checked_at: string | null;
  check_failures: number;
}

/** Whether `imp` is due, given whether it still has upcoming events. */
export function isDue(imp: { last_checked_at: string | null; check_failures: number }, hasUpcoming: boolean, now: number): boolean {
  if (!imp.last_checked_at) return true;
  const every = hasUpcoming && imp.check_failures < BACKOFF_AFTER ? ACTIVE_EVERY_MS : IDLE_EVERY_MS;
  // A minute of slack so a 20-minute cadence isn't pushed to 25 by the 5-minute cron.
  return now - Date.parse(imp.last_checked_at) >= every - 60_000;
}

export async function runImportRechecks(admin: SupabaseClient, now = Date.now()) {
  const { data: rows } = await admin
    .from("schedule_imports")
    .select("id, team_id, source_url, title, sheet_team_key, time_zone, created_by, last_checked_at, check_failures, teams!inner(deleted_at, archived_at)")
    .eq("source_kind", "ical")
    .is("teams.deleted_at", null)
    .is("teams.archived_at", null)
    .lt("last_checked_at", new Date(now - ACTIVE_EVERY_MS + 60_000).toISOString())
    .order("last_checked_at", { ascending: true })
    .limit(200);
  const { data: never } = await admin
    .from("schedule_imports")
    .select("id, team_id, source_url, title, sheet_team_key, time_zone, created_by, last_checked_at, check_failures, teams!inner(deleted_at, archived_at)")
    .eq("source_kind", "ical")
    .is("teams.deleted_at", null)
    .is("teams.archived_at", null)
    .is("last_checked_at", null)
    .limit(50);
  const candidates = [...(never ?? []), ...(rows ?? [])] as unknown as ImportRow[];
  if (candidates.length === 0) return { checked: 0, changed: 0, failed: 0 };

  // Which imports still have games to play.
  const { data: upcoming } = await admin
    .from("events")
    .select("import_id")
    .in("import_id", candidates.map((c) => c.id))
    .is("cancelled_at", null)
    .gt("starts_at", new Date(now).toISOString());
  const active = new Set((upcoming ?? []).map((e: { import_id: string }) => e.import_id));
  const due = candidates.filter((c) => isDue(c, active.has(c.id), now)).slice(0, PER_RUN);

  let changed = 0, failed = 0;
  await mapLimited(due, 5, async (imp) => {
    try {
      const loaded = await loadSource({ url: imp.source_url, time_zone: imp.time_zone }, { useCache: false });
      const t = loaded.tournament;
      const tz = t.timeZone ?? imp.time_zone ?? "America/Chicago";
      const r = await applyImport(admin, {
        teamId: imp.team_id, createdBy: imp.created_by, loaded, t, teamKey: CALENDAR_TEAM_KEY, alias: null, wanted: null, tz,
      });
      const notice = changeNotice(r.changes, tz, t.title);
      if (notice) {
        changed++;
        await enqueueTeamNotification(admin, { teamId: imp.team_id, ...notice, includePlayers: true });
      }
    } catch (e) {
      failed++;
      const message = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      await admin.from("schedule_imports").update({
        last_checked_at: new Date(now).toISOString(),
        check_error: message.slice(0, 500),
        check_failures: imp.check_failures + 1,
      }).eq("id", imp.id);
    }
  });
  return { checked: due.length, changed, failed };
}
