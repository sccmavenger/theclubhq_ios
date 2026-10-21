// Token-based (.p8) APNs sender (DECISIONS D-012). No Firebase, no third-party SDK.
import { env, signES256 } from "./http.ts";

let cachedJwt: { token: string; issuedAt: number } | null = null;

async function providerToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // APNs accepts a provider token for up to 60 minutes; refresh every 50.
  if (cachedJwt && now - cachedJwt.issuedAt < 50 * 60) return cachedJwt.token;
  const token = await signES256(
    { alg: "ES256", kid: env("APNS_KEY_ID") },
    { iss: env("APNS_TEAM_ID"), iat: now },
    env("APNS_PRIVATE_KEY"),
  );
  cachedJwt = { token, issuedAt: now };
  return token;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Web-style link path; the app maps it to a native destination. */
  linkPath: string;
  threadId?: string;
  badge?: number;
}

/** Returns "ok", "gone" (token should be deleted), or "error". */
export async function sendApns(
  deviceToken: string,
  environment: "sandbox" | "production",
  payload: PushPayload,
): Promise<"ok" | "gone" | "error"> {
  const host = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const res = await fetch(`${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken()}`,
      "apns-topic": env("APNS_BUNDLE_ID"),
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
        ...(payload.threadId ? { "thread-id": payload.threadId } : {}),
      },
      link_path: payload.linkPath,
    }),
  });
  if (res.ok) return "ok";
  if (res.status === 410 || res.status === 400) {
    const reason = (await res.json().catch(() => ({})))?.reason;
    if (res.status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") return "gone";
  }
  console.error("apns", res.status, await res.text().catch(() => ""));
  return "error";
}
