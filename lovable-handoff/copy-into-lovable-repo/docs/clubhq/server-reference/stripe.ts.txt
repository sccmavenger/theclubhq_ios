// Minimal Stripe REST client (no SDK) for Connect Express + Checkout.
// Dues are real-world services → App Store guideline 3.1.3(e): never IAP (DECISIONS D-010).
import { ApiError, env } from "./http.ts";

/** ClubHQ all-in fee charged to the family per checkout (DECISIONS D-011). */
export const FEE_PERCENT_BPS = 290; // 2.90%
export const FEE_FLAT_CENTS = 79; // $0.79

/** Total fee for a checkout of `subtotalCents`. Pure; mirrored by `DuesFee` in the iOS app. */
export function checkoutFeeCents(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * FEE_PERCENT_BPS) / 10_000) + FEE_FLAT_CENTS;
}

function form(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export async function stripe<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      // No Stripe-Version header: the account's pinned API version applies. Pin it in
      // the Stripe dashboard before go-live so webhook payload shapes stay stable.
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? form(params) : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("stripe", path, body);
    throw new ApiError("payment_error", body?.error?.message ?? "Payment provider error", 502);
  }
  return body as T;
}

/** Verify a Stripe webhook signature (v1 scheme, HMAC-SHA256, 5-minute tolerance). */
export async function verifyStripeSignature(payload: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = parts["t"];
  const signatures = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("STRIPE_WEBHOOK_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)),
  );
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
