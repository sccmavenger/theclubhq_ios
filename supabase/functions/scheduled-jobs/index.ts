// Every-5-minutes jobs (DECISIONS D-045): event reminders and RSVP nudges, team calendar
// re-checks with "time changed" alerts (D-047), then an immediate push dispatch so neither waits
// for the next apns-dispatch run.
// Auth: the same APNS_DISPATCH_SECRET bearer token the apns-dispatch cron uses.
import { adminClient, errorResponse, json } from "../_shared/http.ts";
import { dispatchPendingPushes } from "../_shared/dispatch.ts";
import { runReminders } from "../_shared/reminders.ts";
import { runImportRechecks } from "../_shared/importRecheck.ts";
import { purgeDeletedTeams } from "../_shared/teamPurge.ts";

Deno.serve(async (req) => {
  try {
    const expected = Deno.env.get("APNS_DISPATCH_SECRET");
    if (!expected || req.headers.get("Authorization") !== `Bearer ${expected}`) {
      return json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    const admin = adminClient();
    const reminders = await runReminders(admin);
    // A calendar that won't load must not stop reminders or pushes.
    const rechecks = await runImportRechecks(admin).catch((e) => {
      console.error("import rechecks failed", e);
      return { checked: 0, changed: 0, failed: -1 };
    });
    const pushed = await dispatchPendingPushes(admin);
    // Housekeeping: the sheet cache only needs the last few minutes.
    await admin.from("sheet_fetch_cache").delete().lt("fetched_at", new Date(Date.now() - 3600_000).toISOString());
    // Teams deleted more than 30 days ago are gone for good (D-046).
    const purged = await purgeDeletedTeams(admin);
    return json({ reminders, rechecks, pushed, purged });
  } catch (e) {
    return errorResponse(e);
  }
});
