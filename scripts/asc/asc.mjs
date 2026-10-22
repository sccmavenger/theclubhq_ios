// Minimal App Store Connect API client. Reads the key from the-hub-ios/.secrets; never prints it.
import fs from "fs"; import crypto from "crypto";
const S = "/Users/dannyjr/GitHub/the-hub-ios/.secrets";
const keyId = fs.readFileSync(`${S}/asc-key-id`, "utf8").trim();
const issuer = fs.readFileSync(`${S}/asc-issuer-id`, "utf8").trim();
const pkey = crypto.createPrivateKey(fs.readFileSync(`${S}/asc-key.p8`, "utf8"));
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function token() {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({ iss: issuer, iat: now, exp: now + 1100, aud: "appstoreconnect-v1" })}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: pkey, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}
export async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
export const errs = (r) => (r.json?.errors ?? []).map(e => `${e.code}: ${e.detail ?? e.title}`).join(" | ");
