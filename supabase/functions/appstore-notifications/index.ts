// App Store Server Notifications v2 endpoint (Coach Pro renewals, expirations, refunds).
// Deploy with --no-verify-jwt. We don't trust the posted payload: we read the original
// transaction id from it and re-fetch the authoritative status from the App Store
// Server API (see _shared/appstore.ts for the trust model).
import { adminClient, ApiError, decodeJwsPayload, errorResponse, json } from "../_shared/http.ts";
import { refreshSubscription } from "../_shared/appstore.ts";

Deno.serve(async (req) => {
  try {
    const { signedPayload } = (await req.json()) as { signedPayload?: string };
    if (!signedPayload) return json({ error: "missing payload" }, 400);
    const notification = decodeJwsPayload<{ notificationType: string; data?: { signedTransactionInfo?: string } }>(signedPayload);
    const signedTx = notification.data?.signedTransactionInfo;
    if (!signedTx) return json({ ignored: notification.notificationType });
    const tx = decodeJwsPayload<{ originalTransactionId: string }>(signedTx);
    // No expected user: the owner comes from appAccountToken in Apple's own response.
    await refreshSubscription(adminClient(), tx.originalTransactionId);
    return json({ ok: true });
  } catch (e) {
    console.error("appstore notification", e);
    // Permanent "not ours" outcomes get a 200 so Apple doesn't retry forever;
    // transient failures return 5xx so Apple retries (it does, for up to 3 days).
    if (e instanceof ApiError && e.status < 500) return json({ ignored: e.code });
    return errorResponse(e);
  }
});
