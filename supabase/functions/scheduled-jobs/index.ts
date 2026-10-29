// Every-5-minutes jobs (DECISIONS D-045): event reminders and RSVP nudges, then an immediate
// push dispatch so reminders don't wait for the next apns-dispatch run.
// Auth: the same APNS_DISPATCH_SECRET bearer token the apns-dispatch cron uses.
import { adminClient, errorResponse, json } from "../_shared/http.ts";
import { dispatchPendingPushes } from "../_shared/dispatch.ts";
import { runReminders } from "../_shared/reminders.ts";

Deno.serve(async (req) => {
  try {
    const expected = Deno.env.get("APNS_DISPATCH_SECRET");
    if (!expected || req.headers.get("Authorization") !== `Bearer ${expected}`) {
      return json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    const admin = adminClient();
    const reminders = await runReminders(admin);
    const pushed = await dispatchPendingPushes(admin);
    return json({ reminders, pushed });
  } catch (e) {
    return errorResponse(e);
  }
});
