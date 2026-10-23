// Run: deno test --allow-read --allow-env --allow-net supabase/tests/appstore_verify_test.ts
// Uses a locally generated chain shaped like Apple's (P-384 root/intermediate, P-256 leaf,
// Apple OIDs) because real Apple-signed sandbox data only exists after a purchase.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import * as x509 from "npm:@peculiar/x509@1.12.3";
import { statusFrom, verifyAppleJws } from "../functions/_shared/appstore.ts";

const dir = Deno.env.get("JWS_TEST_DIR") ?? new URL("./fixtures/jws", import.meta.url).pathname;
const b64 = (name: string) => Deno.readTextFileSync(`${dir}/${name}.b64`).trim();
const der = (name: string) => Uint8Array.from(atob(b64(name)), (c) => c.charCodeAt(0));
const testRoot = new x509.X509Certificate(der("root"));
const b64url = (bytes: Uint8Array | string) =>
  btoa(String.fromCharCode(...(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function leafKey(): Promise<CryptoKey> {
  const pem = Deno.readTextFileSync(`${dir}/leaf.p8.pem`).replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function sign(payload: Record<string, unknown>, chain = ["leaf", "inter", "root"]): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "ES256", x5c: chain.map(b64) }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await leafKey(), new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${b64url(sig)}`;
}

const tx = {
  transactionId: "2000000999", originalTransactionId: "2000000111", productId: "com.teamclubhq.pro.yearly",
  bundleId: "com.teamclubhq.app", appAccountToken: "aa2367a6-8a2b-48bc-99b7-d2cae867a675",
  expiresDate: Date.now() + 86_400_000, signedDate: Date.now(), environment: "Sandbox",
};

Deno.test("accepts a correctly signed chain", async () => {
  const out = await verifyAppleJws<typeof tx>(await sign(tx), testRoot);
  assertEquals(out.originalTransactionId, "2000000111");
});

Deno.test("rejects the same data when Apple's real root is required", async () => {
  await assertRejects(async () => await verifyAppleJws(await sign(tx)));
});

Deno.test("rejects a tampered payload", async () => {
  const jws = await sign(tx);
  const [h, , s] = jws.split(".");
  const forged = b64url(JSON.stringify({ ...tx, expiresDate: Date.now() + 9e12 }));
  await assertRejects(async () => await verifyAppleJws(`${h}.${forged}.${s}`, testRoot));
});

Deno.test("rejects a chain whose root is a look-alike", async () => {
  await assertRejects(async () => await verifyAppleJws(await sign(tx, ["leaf", "inter", "evilroot"]), testRoot));
});

Deno.test("rejects a leaf without Apple's receipt-signing OID", async () => {
  await assertRejects(async () => await verifyAppleJws(await sign(tx, ["leafnooid", "inter", "root"]), testRoot));
});

Deno.test("rejects data signed after the leaf expired", async () => {
  await assertRejects(async () => await verifyAppleJws(await sign({ ...tx, signedDate: Date.now() + 2000 * 86_400_000 }), testRoot));
});

Deno.test("rejects garbage as bad input, not a server error", async () => {
  const err = await assertRejects(async () => await verifyAppleJws("aaaa.bbbb.cccc", testRoot));
  assertEquals((err as { status?: number }).status, 400);
});

Deno.test("status mapping", () => {
  const now = Date.now();
  assertEquals(statusFrom({ ...tx, expiresDate: now + 1000 } as never), "active");
  assertEquals(statusFrom({ ...tx, expiresDate: now - 1000 } as never), "expired");
  assertEquals(statusFrom({ ...tx, expiresDate: now - 1000, revocationDate: now } as never), "revoked");
  assertEquals(statusFrom({ ...tx, expiresDate: now - 1000 } as never, { gracePeriodExpiresDate: now + 1000 }), "grace_period");
  assertEquals(statusFrom({ ...tx, expiresDate: now - 1000 } as never, { isInBillingRetryPeriod: true }), "billing_retry");
  assert(true);
});
