// Coach Pro entitlement: verifying Apple's signed transactions (DECISIONS D-010, D-034).
//
// Trust model: every JWS we act on is verified locally the way Apple's App Store Server
// Library does it (SignedDataVerifier): the x5c chain must end in the pinned Apple Root CA - G3,
// the intermediate and leaf must carry Apple's OIDs, each certificate must be valid at the
// payload's signedDate, the ES256 signature must check out with the leaf key, and the payload
// must name our bundle id (and, in Production, our App Apple ID). This needs no App Store
// Server API key. If APPSTORE_PRIVATE_KEY is configured we additionally re-fetch the latest
// status from the App Store Server API, which also covers renewals the device never saw.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import * as x509 from "npm:@peculiar/x509@1.12.3";
import { ApiError, base64UrlDecode, signES256 } from "./http.ts";

export const COACH_PRO_PRODUCT_IDS = ["com.teamclubhq.pro.monthly", "com.teamclubhq.pro.yearly"];
const BUNDLE_ID = Deno.env.get("APPSTORE_BUNDLE_ID") ?? "com.teamclubhq.app";
const APP_APPLE_ID = Number(Deno.env.get("APPSTORE_APP_APPLE_ID") ?? "6822555956");

/// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
/// SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
const APPLE_ROOT_CA_G3 = "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";
const OID_LEAF = "1.2.840.113635.100.6.11.1";
const OID_INTERMEDIATE = "1.2.840.113635.100.6.2.1";

x509.cryptoProvider.set(crypto);
const rootCert = new x509.X509Certificate(Uint8Array.from(atob(APPLE_ROOT_CA_G3), (c) => c.charCodeAt(0)));

export interface TransactionPayload {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  appAccountToken?: string;
  expiresDate?: number;
  revocationDate?: number;
  signedDate?: number;
  environment: "Sandbox" | "Production" | "Xcode" | "LocalTesting";
}

export interface RenewalPayload {
  signedDate?: number;
  autoRenewStatus?: number;
  isInBillingRetryPeriod?: boolean;
  gracePeriodExpiresDate?: number;
}

export interface NotificationPayload {
  notificationType: string;
  subtype?: string;
  signedDate?: number;
  data?: {
    bundleId?: string;
    appAppleId?: number;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Verify an Apple-signed JWS (transaction, renewal info, or notification) and return its payload. */
export async function verifyAppleJws<T extends { signedDate?: number }>(
  jws: string,
  trustedRoot: x509.X509Certificate = rootCert, // tests pass their own root; production never does
): Promise<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new ApiError("bad_request", "Malformed signed data.");
  const [h, p, s] = parts;
  let header: { alg?: string; x5c?: string[] };
  let leaf: x509.X509Certificate, intermediate: x509.X509Certificate, root: x509.X509Certificate;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h)));
    if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new Error("format");
    [leaf, intermediate, root] = header.x5c.map((c) => new x509.X509Certificate(Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0))));
  } catch {
    throw new ApiError("bad_request", "Malformed signed data.");
  }
  if (!sameBytes(root.rawData, trustedRoot.rawData)) throw new ApiError("forbidden", "Not signed by Apple.", 403);

  let payload: T;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as T;
  } catch {
    throw new ApiError("bad_request", "Malformed signed data.");
  }
  // Like Apple's library in offline mode: certificates must be valid when Apple signed the data.
  const date = new Date(payload.signedDate ?? Date.now());
  const chainOK = await intermediate.verify({ publicKey: trustedRoot, date }) &&
    await leaf.verify({ publicKey: intermediate, date }) &&
    intermediate.getExtension(OID_INTERMEDIATE) !== null &&
    leaf.getExtension(OID_LEAF) !== null;
  if (!chainOK) throw new ApiError("forbidden", "Not signed by Apple.", 403);

  const key = await leaf.publicKey.export({ name: "ECDSA", namedCurve: "P-256" }, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64UrlDecode(s) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new ApiError("forbidden", "Invalid Apple signature.", 403);
  return payload;
}

/** Map a verified transaction (+ optional renewal info) to our subscription status. */
export function statusFrom(tx: TransactionPayload, renewal?: RenewalPayload): string {
  const now = Date.now();
  if (tx.revocationDate) return "revoked";
  if (!tx.expiresDate || tx.expiresDate > now) return "active";
  if (renewal?.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now) return "grace_period";
  if (renewal?.isInBillingRetryPeriod) return "billing_retry";
  return "expired";
}

/**
 * Record a verified Coach Pro transaction. `expectedUserId` (the caller, for in-app syncs) must
 * match the purchase's appAccountToken when one is present. Out-of-order updates are ignored.
 */
export async function recordTransaction(
  admin: SupabaseClient,
  tx: TransactionPayload,
  renewal: RenewalPayload | undefined,
  expectedUserId?: string,
): Promise<{ status: string; productId: string; expiresAt: string | null }> {
  if (tx.bundleId !== BUNDLE_ID) throw new ApiError("bad_request", "Purchase is for a different app.");
  if (!COACH_PRO_PRODUCT_IDS.includes(tx.productId)) throw new ApiError("bad_request", "Unknown product.");

  // The app sets appAccountToken = Supabase user id at purchase time.
  const ownerId = tx.appAccountToken?.toLowerCase();
  if (expectedUserId && ownerId && ownerId !== expectedUserId.toLowerCase()) {
    throw new ApiError("forbidden", "This purchase belongs to a different ClubHQ account.", 403);
  }
  const { data: existing } = await admin.from("app_store_subscriptions")
    .select("user_id, expires_at, status").eq("original_transaction_id", tx.originalTransactionId).maybeSingle();
  const userId = ownerId ?? existing?.user_id ?? expectedUserId;
  if (!userId) throw new ApiError("bad_request", "Purchase is not linked to an account.");

  const expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
  const status = statusFrom(tx, renewal);
  // A late-arriving older transaction must not overwrite a newer renewal (refunds always apply).
  if (existing?.expires_at && expiresAt && status !== "revoked" && Date.parse(existing.expires_at) > Date.parse(expiresAt)) {
    return { status: existing.status, productId: tx.productId, expiresAt: existing.expires_at };
  }
  const row: Record<string, unknown> = {
    original_transaction_id: tx.originalTransactionId,
    user_id: userId,
    product_id: tx.productId,
    status,
    expires_at: expiresAt,
    environment: tx.environment,
    updated_at: new Date().toISOString(),
  };
  if (renewal?.autoRenewStatus !== undefined) row.auto_renew = renewal.autoRenewStatus === 1;
  const { error } = await admin.from("app_store_subscriptions").upsert(row);
  if (error) throw new ApiError("internal", error.message, 500);
  return { status, productId: tx.productId, expiresAt };
}

// ---------------------------------------------------------------------------------------------
// Optional: App Store Server API (only when an In-App Purchase key is configured).
// ---------------------------------------------------------------------------------------------

const SERVER_API_CONFIGURED = Boolean(Deno.env.get("APPSTORE_PRIVATE_KEY") && Deno.env.get("APPSTORE_KEY_ID") && Deno.env.get("APPSTORE_ISSUER_ID"));

async function latestFromServerApi(originalTransactionId: string): Promise<{ tx: TransactionPayload; renewal: RenewalPayload } | null> {
  if (!SERVER_API_CONFIGURED) return null;
  const now = Math.floor(Date.now() / 1000);
  const token = await signES256(
    { alg: "ES256", kid: Deno.env.get("APPSTORE_KEY_ID")!, typ: "JWT" },
    { iss: Deno.env.get("APPSTORE_ISSUER_ID")!, iat: now, exp: now + 600, aud: "appstoreconnect-v1", bid: BUNDLE_ID },
    Deno.env.get("APPSTORE_PRIVATE_KEY")!,
  );
  for (const host of ["https://api.storekit.itunes.apple.com", "https://api.storekit-sandbox.itunes.apple.com"]) {
    const res = await fetch(`${host}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status !== 404) console.error("app store server api", host, res.status, await res.text());
      continue;
    }
    const body = await res.json() as { data: Array<{ lastTransactions: Array<{ originalTransactionId: string; signedTransactionInfo: string; signedRenewalInfo: string }> }> };
    const last = body.data.flatMap((g) => g.lastTransactions).find((t) => t.originalTransactionId === originalTransactionId);
    if (!last) return null;
    // Verified the same way as everything else, even though it came from Apple over TLS.
    return { tx: await verifyAppleJws<TransactionPayload>(last.signedTransactionInfo), renewal: await verifyAppleJws<RenewalPayload>(last.signedRenewalInfo) };
  }
  return null;
}

/** In-app sync: the device sends a StoreKit 2 transaction JWS right after purchase and on launch. */
export async function syncFromDevice(admin: SupabaseClient, jws: string, userId: string) {
  const tx = await verifyAppleJws<TransactionPayload>(jws);
  const latest = await latestFromServerApi(tx.originalTransactionId).catch((e) => {
    console.error("server api lookup failed", e);
    return null;
  });
  return await recordTransaction(admin, latest?.tx ?? tx, latest?.renewal, userId);
}

/** App Store Server Notifications V2 (renewals, expirations, refunds, billing issues). */
export async function handleNotification(admin: SupabaseClient, signedPayload: string): Promise<string> {
  const note = await verifyAppleJws<NotificationPayload>(signedPayload);
  if (note.data?.bundleId !== BUNDLE_ID) throw new ApiError("bad_request", "Notification is for a different app.");
  if (note.data?.environment === "Production" && note.data?.appAppleId !== APP_APPLE_ID) {
    throw new ApiError("bad_request", "Notification is for a different app.");
  }
  if (!note.data?.signedTransactionInfo) return `ignored ${note.notificationType}`;
  const tx = await verifyAppleJws<TransactionPayload>(note.data.signedTransactionInfo);
  const renewal = note.data.signedRenewalInfo ? await verifyAppleJws<RenewalPayload>(note.data.signedRenewalInfo) : undefined;
  await recordTransaction(admin, tx, renewal);
  return `${note.notificationType}${note.subtype ? "/" + note.subtype : ""}`;
}
