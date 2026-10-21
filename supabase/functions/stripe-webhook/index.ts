// Stripe webhook: marks dues paid and keeps Connect account status fresh.
// Deploy with --no-verify-jwt (Stripe can't send a Supabase JWT); authenticity comes
// from the Stripe-Signature HMAC instead.
import { adminClient, errorResponse, json } from "../_shared/http.ts";
import { verifyStripeSignature } from "../_shared/stripe.ts";

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.text();
    if (!(await verifyStripeSignature(payload, req.headers.get("Stripe-Signature")))) {
      return json({ error: "bad signature" }, 400);
    }
    const event = JSON.parse(payload) as StripeEvent;
    const admin = adminClient();
    const obj = event.data.object;

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        if (obj.payment_status !== "paid") break;
        const itemIds = String((obj.metadata as Record<string, string>)?.item_ids ?? "").split(",").filter(Boolean);
        if (itemIds.length === 0) break;
        await admin
          .from("dues_items")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            paid_by: (obj.client_reference_id as string) ?? null,
            stripe_payment_intent_id: (obj.payment_intent as string) ?? null,
            updated_at: new Date().toISOString(),
          })
          .in("id", itemIds)
          .eq("stripe_checkout_session_id", obj.id as string);
        break;
      }
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        await admin
          .from("dues_items")
          .update({ status: "unpaid", stripe_checkout_session_id: null, updated_at: new Date().toISOString() })
          .eq("stripe_checkout_session_id", obj.id as string)
          .eq("status", "processing");
        break;
      }
      case "account.updated": {
        await admin
          .from("team_payment_accounts")
          .update({
            charges_enabled: obj.charges_enabled === true,
            payouts_enabled: obj.payouts_enabled === true,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_account_id", obj.id as string);
        break;
      }
      case "charge.refunded": {
        const pi = obj.payment_intent as string | undefined;
        if (pi && obj.refunded === true) {
          await admin.from("dues_items").update({ status: "unpaid", paid_at: null, updated_at: new Date().toISOString() }).eq("stripe_payment_intent_id", pi);
        }
        break;
      }
    }
    return json({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
});
