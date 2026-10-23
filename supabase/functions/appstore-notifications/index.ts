// App Store Server Notifications V2 endpoint (Coach Pro renewals, expirations, refunds).
// Deployed with verify_jwt = false: Apple can't send a Supabase token, so the payload is
// trusted only after its Apple signature chain verifies (see _shared/appstore.ts).
import { adminClient, ApiError, errorResponse, json } from "../_shared/http.ts";
import { handleNotification } from "../_shared/appstore.ts";

Deno.serve(async (req) => {
  try {
    const { signedPayload } = (await req.json()) as { signedPayload?: string };
    if (!signedPayload) return json({ error: "missing payload" }, 400);
    const handled = await handleNotification(adminClient(), signedPayload);
    console.log("appstore notification", handled);
    return json({ ok: true, handled });
  } catch (e) {
    console.error("appstore notification", e);
    // Permanent "not ours" outcomes get a 200 so Apple doesn't retry forever;
    // transient failures return 5xx so Apple retries (it does, for up to 3 days).
    if (e instanceof ApiError && e.status < 500) return json({ ignored: e.code });
    return errorResponse(e);
  }
});
