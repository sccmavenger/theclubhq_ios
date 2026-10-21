// Shared HTTP helpers for ClubHQ Edge Functions.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Error with a stable machine-readable code the iOS client switches on. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return json({ error: { code: e.code, message: e.message } }, e.status);
  }
  console.error("unhandled", e);
  return json({ error: { code: "internal", message: "Something went wrong. Please try again." } }, 500);
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new ApiError("not_configured", `Server is missing ${name}`, 503);
  return v;
}

export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Caller-scoped client: every query runs under the caller's RLS. */
export function userClient(authHeader: string): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 18): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Human-friendly code without ambiguous characters (0/O, 1/I/L). */
export function shortCode(length = 8): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

export function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a JWS payload WITHOUT verifying it. Only use on data re-fetched from a trusted source. */
export function decodeJwsPayload<T>(jws: string): T {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new ApiError("bad_request", "Malformed signed payload");
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as T;
}

/** Sign an ES256 JWT with a PKCS#8 .p8 private key (APNs and App Store Server API). */
export async function signES256(header: Record<string, unknown>, claims: Record<string, unknown>, p8: string): Promise<string> {
  const pem = p8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(sig)}`;
}
