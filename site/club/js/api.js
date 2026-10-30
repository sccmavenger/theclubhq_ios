// Club portal (D-053): Supabase auth with the same ClubHQ login as the app (password, or an
// emailed 6-digit code for people who use Sign in with Apple), and the app's own mobile-api club
// actions. No SDK. Every permission is decided by mobile-api and the database, not this file.

export const SUPABASE_URL = "https://qpchhtakmxcfqtbjjpvi.supabase.co";
// Publishable key: designed to ship in clients; access is decided by RLS and mobile-api.
const PUBLISHABLE_KEY = "sb_publishable_zH1AESb-lq1S8bIyeaPeyw_TN-YYD5o";
const SESSION_KEY = "clubhq-club-session";
const MAX_SESSION_MS = 12 * 3600_000; // sign in again after 12 hours

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

export const hasSession = () => Boolean(session);

export function signOutLocal() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

export async function signOut() {
  if (session) {
    const token = session.access_token;
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  signOutLocal();
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
    // GoTrue: {error_code, msg} · mobile-api: {error: {code, message}}
    const code = body?.error?.code ?? body?.error_code ?? "error";
    const message = body?.error?.message ?? body?.msg ?? body?.error_description ?? body?.message ?? `Request failed (${res.status})`;
    if (res.status === 401) signOutLocal();
    throw new ApiError(code, friendly(code, message), res.status);
  }
  return body;
}

function friendly(code, message) {
  switch (code) {
    case "invalid_credentials": return "That email and password don't match. Use the same login as the ClubHQ app, or get an emailed code.";
    case "email_not_confirmed": return "Confirm your email in the ClubHQ app first, or sign in with an emailed code.";
    case "otp_expired": return "That code has expired or is wrong. Request a new one.";
    case "otp_disabled":
    case "user_not_found": return "There's no ClubHQ account with that email. Create one in the app first.";
    case "over_email_send_rate_limit": return "Too many codes requested. Wait a minute and try again.";
    default: return message;
  }
}

const authHeaders = { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" };

// ----- Sign-in --------------------------------------------------------------------------
export async function signInWithPassword(email, password) {
  const tokens = await parse(await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: authHeaders, body: JSON.stringify({ email, password }),
  }));
  saveSession(tokens, Date.now());
}

/** Emailed 6-digit code. Never creates an account: directors sign up in the app. */
export async function sendCode(email) {
  await parse(await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST", headers: authHeaders, body: JSON.stringify({ email, create_user: false }),
  }));
}

export async function verifyCode(email, code) {
  const tokens = await parse(await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST", headers: authHeaders, body: JSON.stringify({ type: "email", email, token: code }),
  }));
  saveSession(tokens, Date.now());
}

// ----- Data -----------------------------------------------------------------------------
/** A mobile-api action, the same ones the iPhone app calls. */
export async function act(action, params = {}) {
  const token = await accessToken();
  return parse(await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  }));
}
