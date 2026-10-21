// Invoked every minute by pg_cron (SQL in docs/DEPLOYMENT.md) so that notifications
// created by the WEB app also reach iOS devices (DECISIONS D-021).
// Auth: a dedicated APNS_DISPATCH_SECRET bearer token — never the publishable key
// (the web app's cron route made that mistake; see the repo review).
import { adminClient, errorResponse, json } from "../_shared/http.ts";
import { dispatchPendingPushes } from "../_shared/dispatch.ts";

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const expected = Deno.env.get("APNS_DISPATCH_SECRET");
    if (!expected || auth !== `Bearer ${expected}`) {
      return json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    const sent = await dispatchPendingPushes(adminClient());
    return json({ sent });
  } catch (e) {
    return errorResponse(e);
  }
});
