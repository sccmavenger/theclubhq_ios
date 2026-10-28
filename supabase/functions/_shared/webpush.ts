// Web Push for admin alerts (DECISIONS D-041): RFC 8291 message encryption (aes128gcm) and
// RFC 8292 VAPID, with WebCrypto only. No third-party library touches the payload.
//
// Secrets: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256 point), VAPID_PRIVATE_KEY
// (PKCS#8 PEM), VAPID_SUBJECT (mailto: or https: contact). Without them, sending is skipped.
import { base64UrlDecode, base64UrlEncode, signES256 } from "./http.ts";

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, the browser's ECDH public key
  auth: string; // base64url, 16-byte auth secret
}

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", concat(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: concat(salt), info: concat(info) }, key, length * 8);
  return new Uint8Array(bits);
}

/** Ephemeral sender key pair; tests inject a fixed one to check against RFC 8291's example. */
export interface SenderKeys {
  privateKey: CryptoKey;
  publicRaw: Uint8Array; // 65 bytes
}

export async function newSenderKeys(): Promise<SenderKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)) };
}

/** RFC 8291 §3–4: encrypt one record. Returns the full aes128gcm request body. */
export async function encryptPayload(
  plaintext: Uint8Array,
  uaPublicB64: string,
  authSecretB64: string,
  sender?: SenderKeys,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(uaPublicB64);
  const authSecret = base64UrlDecode(authSecretB64);
  const as = sender ?? await newSenderKeys();
  const uaKey = await crypto.subtle.importKey("raw", concat(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, as.publicRaw);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // Single record: plaintext || 0x02 (last-record delimiter), no padding.
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));

  // Header: salt(16) || rs(4, big-endian) || idlen(1) || keyid(as_public)
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = as.publicRaw.length;
  return concat(header, as.publicRaw, ciphertext);
}

export function webPushConfigured(): boolean {
  return Boolean(Deno.env.get("VAPID_PUBLIC_KEY") && Deno.env.get("VAPID_PRIVATE_KEY"));
}

/** Sends one notification. Returns "ok", "gone" (subscription should be deleted) or "error". */
export async function sendWebPush(sub: PushSubscriptionKeys, payload: unknown, ttlSeconds = 86_400): Promise<"ok" | "gone" | "error"> {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return "error";
  const audience = new URL(sub.endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signES256(
    { typ: "JWT", alg: "ES256" },
    { aud: audience, exp: now + 12 * 3600, sub: Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@teamclubhq.com" },
    privateKey,
  );
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "high",
    },
    body,
  });
  if (res.ok) return "ok";
  if (res.status === 404 || res.status === 410) return "gone";
  console.error("web push", res.status, await res.text().catch(() => ""));
  return "error";
}

/** Helper for tests and key generation: base64url of raw bytes. */
export const b64url = base64UrlEncode;
