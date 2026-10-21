// App Store Server API helpers (Coach Pro entitlement).
//
// Trust model: we never trust a JWS the client (or a webhook caller) hands us. We only
// read its transaction id, then re-fetch the transaction and subscription status from
// Apple's App Store Server API over TLS using our own API key. Those responses are
// authoritative, so decoding their JWS payloads without x5c chain validation is safe.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { ApiError, decodeJwsPayload, env, signES256 } from "./http.ts";

export const COACH_PRO_PRODUCT_IDS = ["com.teamclubhq.pro.monthly", "com.teamclubhq.pro.yearly"];

interface TransactionPayload {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  appAccountToken?: string;
  expiresDate?: number;
  revocationDate?: number;
  environment: "Sandbox" | "Production";
}

interface StatusResponse {
  data: Array<{
    lastTransactions: Array<{
      originalTransactionId: string;
      status: number; // 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked
      signedTransactionInfo: string;
      signedRenewalInfo: string;
    }>;
  }>;
}

const STATUS_MAP: Record<number, string> = {
  1: "active",
  2: "expired",
  3: "billing_retry",
  4: "grace_period",
  5: "revoked",
};

async function apiToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await signES256(
    { alg: "ES256", kid: env("APPSTORE_KEY_ID"), typ: "JWT" },
    {
      iss: env("APPSTORE_ISSUER_ID"),
      iat: now,
      exp: now + 600,
      aud: "appstoreconnect-v1",
      bid: env("APPSTORE_BUNDLE_ID"),
    },
    env("APPSTORE_PRIVATE_KEY"),
  );
}

async function appStoreGet<T>(path: string): Promise<T> {
  const token = await apiToken();
  // Try production first, fall back to sandbox (TestFlight / Xcode StoreKit testing).
  for (const host of ["https://api.storekit.itunes.apple.com", "https://api.storekit-sandbox.itunes.apple.com"]) {
    const res = await fetch(`${host}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 404) {
      console.error("app store api", host, res.status, await res.text());
    }
  }
  throw new ApiError("not_found", "Apple could not find this purchase.", 404);
}

/**
 * Refresh the subscription row for `originalTransactionId` from Apple.
 * `expectedUserId` binds the purchase to the caller (via appAccountToken) when provided.
 */
export async function refreshSubscription(
  admin: SupabaseClient,
  originalTransactionId: string,
  expectedUserId?: string,
): Promise<{ status: string; productId: string; expiresAt: string | null }> {
  const status = await appStoreGet<StatusResponse>(
    `/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`,
  );
  const last = status.data.flatMap((g) => g.lastTransactions).find(
    (t) => t.originalTransactionId === originalTransactionId,
  ) ?? status.data[0]?.lastTransactions[0];
  if (!last) throw new ApiError("not_found", "No subscription found.", 404);

  const tx = decodeJwsPayload<TransactionPayload>(last.signedTransactionInfo);
  const renewal = decodeJwsPayload<{ autoRenewStatus?: number }>(last.signedRenewalInfo);
  if (!COACH_PRO_PRODUCT_IDS.includes(tx.productId)) {
    throw new ApiError("bad_request", "Unknown product.");
  }

  // The app sets appAccountToken = Supabase user id at purchase time.
  const ownerId = tx.appAccountToken?.toLowerCase();
  if (expectedUserId && ownerId && ownerId !== expectedUserId.toLowerCase()) {
    throw new ApiError("forbidden", "This purchase belongs to a different ClubHQ account.", 403);
  }
  const userId = ownerId ?? expectedUserId;
  if (!userId) throw new ApiError("bad_request", "Purchase is not linked to an account.");

  const row = {
    original_transaction_id: tx.originalTransactionId,
    user_id: userId,
    product_id: tx.productId,
    status: STATUS_MAP[last.status] ?? "expired",
    expires_at: tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null,
    environment: tx.environment,
    auto_renew: renewal.autoRenewStatus === 1,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("app_store_subscriptions").upsert(row);
  if (error) throw new ApiError("internal", error.message, 500);
  return { status: row.status, productId: row.product_id, expiresAt: row.expires_at };
}

/** Extract the original transaction id from a client-supplied JWS (untrusted; only used as a lookup key). */
export function originalTransactionIdFromJws(jws: string): string {
  const payload = decodeJwsPayload<TransactionPayload>(jws);
  if (!payload.originalTransactionId) throw new ApiError("bad_request", "Missing transaction id.");
  return payload.originalTransactionId;
}
