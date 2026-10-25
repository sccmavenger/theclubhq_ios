// Supabase auth (emailed code + TOTP), admin_* reads and admin-api writes, with no SDK.
// DECISIONS D-041: every read and write requires an admin on an AAL2 (MFA-verified) session;
// the database and admin-api enforce it, this file only drives the flow.

export const SUPABASE_URL = "https://qpchhtakmxcfqtbjjpvi.supabase.co";
// Publishable key: designed to ship in clients; access is decided by RLS and the admin checks.
const PUBLISHABLE_KEY = "sb_publishable_zH1AESb-lq1S8bIyeaPeyw_TN-YYD5o";
const SESSION_KEY = "clubhq-admin-session";
const MAX_SESSION_MS = 12 * 3600_000; // sign out after 12 hours, MFA again

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ----- Session ------------------------------------------------------------------------
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (!s || Date.now() - s.signed_in_at > MAX_SESSION_MS) return null;
    return s;
  } catch {
    return null;
  }
}
let session = loadSession();

function saveSession(tokens, signedInAt = session?.signed_in_at ?? Date.now()) {
  session = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    signed_in_at: signedInAt,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function hasSession() {
  return Boolean(session);
}

export function signOutLocal() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

export async function signOut() {
  if (session) await authFetch("/logout", { method: "POST" }).catch(() => {});
  signOutLocal();
}

/** Decoded claims of the current access token (aal, email, sub). Display only; never trusted. */
export function claims() {
  if (!session) return null;
  try {
    const part = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

let refreshing = null;
async function accessToken() {
  if (!session) throw new ApiError("signed_out", "Please sign in.", 401);
  if (Date.now() - session.signed_in_at > MAX_SESSION_MS) {
    signOutLocal();
    throw new ApiError("signed_out", "Your session ended. Please sign in again.", 401);
  }
  if (session.expires_at - Date.now() < 60_000) {
    refreshing ??= (async () => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) {
        signOutLocal();
        throw new ApiError("signed_out", "Your session ended. Please sign in again.", 401);
      }
      saveSession(await res.json());
    })().finally(() => (refreshing = null));
    await refreshing;
  }
  return session.access_token;
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    // GoTrue: {error_code, msg} · PostgREST: {message} · admin-api: {error: {code, message}}
    const code = body?.error?.code ?? body?.error_code ?? body?.message ?? "error";
    const message = body?.error?.message ?? body?.msg ?? body?.error_description ?? body?.message ?? `Request failed (${res.status})`;
    if (res.status === 401) signOutLocal();
    throw new ApiError(code, friendly(code, message), res.status);
  }
  return body;
}

function friendly(code, message) {
  switch (code) {
    case "not_admin": return "This account isn't a ClubHQ admin.";
    case "mfa_required": return "Verify with your authenticator app first.";
    case "owner_only": return message && message !== "owner_only" ? message : "Only the owner can do that.";
    case "otp_expired": return "That code has expired or is wrong. Request a new one.";
    case "over_email_send_rate_limit": return "Too many codes requested. Wait a minute and try again.";
    default: return message;
  }
}

async function authFetch(path, init = {}) {
  const token = await accessToken();
  return parse(await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }));
}

// ----- Sign-in: emailed 6-digit code (D-029), then TOTP ----------------------------------
export async function sendCode(email) {
  await parse(await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    // create_user: an invited admin may not have an app account yet. A new account grants
    // nothing by itself; access comes only from platform_admins.
    body: JSON.stringify({ email, create_user: true }),
  }));
}

export async function verifyCode(email, code) {
  const tokens = await parse(await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email, token: code }),
  }));
  saveSession(tokens, Date.now());
}

/** Verified TOTP factors, plus a cleanup of half-finished enrollments. */
export async function totpFactors() {
  const user = await authFetch("/user");
  const factors = (user.factors ?? []).filter((f) => f.factor_type === "totp");
  for (const f of factors.filter((f) => f.status !== "verified")) {
    await authFetch(`/factors/${f.id}`, { method: "DELETE" }).catch(() => {});
  }
  return factors.filter((f) => f.status === "verified");
}

export async function enrollTotp() {
  const factor = await authFetch("/factors", {
    method: "POST",
    body: JSON.stringify({ factor_type: "totp", friendly_name: `ClubHQ Admin ${new Date().toISOString().slice(0, 10)}`, issuer: "ClubHQ Admin" }),
  });
  return { id: factor.id, qr: factor.totp.qr_code, secret: factor.totp.secret };
}

export async function verifyTotp(factorId, code) {
  const challenge = await authFetch(`/factors/${factorId}/challenge`, { method: "POST", body: "{}" });
  const tokens = await authFetch(`/factors/${factorId}/verify`, {
    method: "POST",
    body: JSON.stringify({ challenge_id: challenge.id, code }),
  });
  saveSession(tokens);
}

// ----- Data ---------------------------------------------------------------------------
/** admin_* SQL function under the admin's JWT. */
export async function rpc(name, args = {}) {
  const token = await accessToken();
  return parse(await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }));
}

/** Audited write through the admin-api Edge Function. */
export async function act(action, params = {}) {
  const token = await accessToken();
  return parse(await fetch(`${SUPABASE_URL}/functions/v1/admin-api`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  }));
}
