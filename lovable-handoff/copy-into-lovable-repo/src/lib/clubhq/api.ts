// ClubHQ backend client for the web app.
//
// Every function here is a one-to-one port of the iOS app's `SupabaseBackend`
// (ClubHQ/Core/Backend/SupabaseBackend.swift), which is verified against production.
// Use these functions from the UI (via TanStack Query). Do NOT call Supabase tables
// or Edge Functions any other way, and do NOT add tables, migrations, or functions.
//
// Two transports:
//   1. PostgREST (supabase.from(...)) for plain reads/writes that Row Level Security allows.
//   2. The `mobile-api` Edge Function for everything privileged or aggregated:
//      POST {SUPABASE_URL}/functions/v1/mobile-api  body: { action, ...params }
//      Errors come back as { error: { code, message } } with an HTTP status.

import { createClient, type PostgrestError } from "@supabase/supabase-js";
import type {
  Announcement,
  AttendanceRecord,
  AttendanceStatus,
  CheckoutSession,
  DateOnly,
  DuesOverview,
  DuesStatus,
  EmergencyContact,
  EventDetail,
  EventDraft,
  InboxItem,
  InviteLink,
  InvitePreview,
  MessageAudience,
  MessageThread,
  NewChildRequest,
  NewTeamRequest,
  Player,
  PlayerDraft,
  PlayerInviteCode,
  RSVP,
  RSVPStatus,
  SignUpOutcome,
  TeamEvent,
  TeamMember,
  TeamSponsor,
  ThreadDetail,
  UserContext,
  UUID,
} from "./types";
import { formatDateOnly, resolvedEventTitle, resultFromScore } from "./rules";

// ---------------------------------------------------------------------------
// Configuration — production "TeamClubHQ" Supabase project.
// The publishable key is designed to ship in clients; Row Level Security protects data.
// ---------------------------------------------------------------------------

export const SUPABASE_URL = "https://qpchhtakmxcfqtbjjpvi.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_zH1AESb-lq1S8bIyeaPeyw_TN-YYD5o";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Sign-up and password reset use 6-digit emailed codes, never links.
    detectSessionInUrl: false,
    storageKey: "clubhq-auth",
  },
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Error with a stable machine-readable `code` (see docs/clubhq/API.md → Error codes). */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Plain-English text for the auth errors people actually hit (same copy as iOS). */
const FRIENDLY_MESSAGES: Record<string, string> = {
  unauthorized: "Your session ended. Please sign in again.",
  network: "You appear to be offline. Check your connection and try again.",
  not_configured: "This feature isn't set up on the server yet.",
  invalid_credentials: "That email and password don't match.",
  email_not_confirmed: "Please confirm your email first. We just sent you a new code.",
  otp_expired: "That code is wrong or has expired. Check the latest email or tap Resend.",
  over_email_send_rate_limit: "Too many emails were sent just now. Please wait a minute and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  weak_password: "Choose a stronger password — at least 8 characters.",
  user_already_exists: "An account with this email already exists. Try signing in.",
  email_address_invalid: "That email address doesn't look right.",
  signup_disabled: "New sign-ups are paused right now. Please try again later.",
};

function friendly(code: string, fallback: string): string {
  return FRIENDLY_MESSAGES[code] ?? fallback;
}

/** Called whenever the server says the session is gone. The app should route to sign-in. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function authError(error: { code?: string; message: string; status?: number }): ApiError {
  const code = error.code ?? "auth_error";
  return new ApiError(code, friendly(code, error.message), error.status ?? 400);
}

function restError(error: PostgrestError): ApiError {
  // 42501 = insufficient privilege (RLS said no).
  if (error.code === "42501") return new ApiError("forbidden", "You don't have permission to do that.", 403);
  return new ApiError(error.code || "rest_error", error.message, 400);
}

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, fallback: T): T {
  if (result.error) throw restError(result.error);
  return result.data ?? fallback;
}

async function currentUserId(): Promise<UUID> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) {
    onUnauthorized?.();
    throw new ApiError("unauthorized", FRIENDLY_MESSAGES.unauthorized, 401);
  }
  return id;
}

/** Calls `mobile-api` with `{ action, ...params }`. */
async function callApi<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession(); // refreshes an expired access token
  const token = data.session?.access_token;
  if (!token) {
    onUnauthorized?.();
    throw new ApiError("unauthorized", FRIENDLY_MESSAGES.unauthorized, 401);
  }
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...params, action }),
    });
  } catch {
    throw new ApiError("network", FRIENDLY_MESSAGES.network, 0);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const code = body.error?.code ?? `http_${response.status}`;
    if (response.status === 401) {
      onUnauthorized?.();
      throw new ApiError("unauthorized", FRIENDLY_MESSAGES.unauthorized, 401);
    }
    throw new ApiError(code, friendly(code, body.error?.message ?? "Something went wrong. Please try again."), response.status);
  }
  return body as T;
}

const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

// ---------------------------------------------------------------------------
// Auth (Supabase GoTrue). Registration uses 6-digit email codes (DECISIONS D-029).
// ---------------------------------------------------------------------------

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw authError(error);
}

/** Returns "confirm_email" when the user must enter the emailed 6-digit code next. */
export async function signUp(fullName: string, email: string, password: string): Promise<SignUpOutcome> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw authError(error);
  if (data.session) {
    await updateProfile(fullName).catch(() => undefined);
    return "signed_in";
  }
  return "confirm_email";
}

/** Verifies a 6-digit code and signs the user in. `isRecovery` = password reset. */
export async function verifyEmailCode(email: string, code: string, isRecovery: boolean): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: isRecovery ? "recovery" : "email" });
  if (error) throw authError(error);
}

export async function resendSignupCode(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) throw authError(error);
}

/** Emails a 6-digit password-reset code (the email template shows a code, not a link). */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw authError(error);
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw authError(error);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Deletes the account (D-014). Teams where the user is the only head coach are archived. */
export async function deleteAccount(): Promise<void> {
  await callApi("delete-account");
  await supabase.auth.signOut({ scope: "local" });
}

// ---------------------------------------------------------------------------
// Context, profile & teams
// ---------------------------------------------------------------------------

/** Who the user is and every team they belong to (with roles, linked children, Pro status). */
export function loadContext(): Promise<UserContext> {
  return callApi<UserContext>("context");
}

export async function updateProfile(fullName: string): Promise<void> {
  await callApi("update-profile", { full_name: fullName });
}

/** Free plan: 1 team as head coach. Errors: "upgrade_required" (402), "team_limit" (402). */
export async function createTeam(request: NewTeamRequest): Promise<UUID> {
  const created = await callApi<{ team_id: UUID; org_id: UUID }>("create-team", {
    team_name: request.team_name.trim(),
    sport: request.sport,
    age_group: emptyToNull(request.age_group),
    season: emptyToNull(request.season),
    org_type: request.is_club ? "club" : "independent",
    org_name: request.is_club ? emptyToNull(request.club_name) : request.team_name.trim(),
  });
  return created.team_id;
}

/** Head coach, Coach Pro only. `hex` = "#RRGGBB" or null for the default color. */
export async function updateTeamColor(teamId: UUID, hex: string | null): Promise<void> {
  await callApi("update-team", { team_id: teamId, brand_color: hex });
}

/** Head coach. Returns the live team code (reused while it has > 24 h left). */
export function createInvite(teamId: UUID): Promise<InviteLink> {
  return callApi<InviteLink>("create-invite", { team_id: teamId });
}

/** Requires a signed-in user. Returns { valid:false } for unknown/expired codes. */
export function lookupInvite(token: string): Promise<InvitePreview> {
  return callApi<InvitePreview>("lookup-invite", { token });
}

/** Guardian joins a team by adding their child. Returns the team id. */
export async function claimInvite(token: string, child: NewChildRequest): Promise<UUID> {
  const claimed = await callApi<{ team_id: UUID; player_id: UUID }>("claim-invite", {
    token,
    child: {
      first_name: child.first_name.trim(),
      last_name: child.last_name.trim(),
      jersey_number: emptyToNull(child.jersey_number),
      position: emptyToNull(child.position),
      birthdate: child.birthdate,
      parent_relationship: child.relationship,
      contacts: [
        {
          relationship: child.contact_relationship,
          name: emptyToNull(child.contact_name),
          phone: child.contact_phone.trim(),
          email: emptyToNull(child.contact_email),
        },
      ],
    },
  });
  return claimed.team_id;
}

/** Guardian or head coach creates an 8-character code for a 13+ player's own login. */
export function createPlayerInvite(playerId: UUID): Promise<PlayerInviteCode> {
  return callApi<PlayerInviteCode>("create-player-invite", { player_id: playerId });
}

/** A 13+ player (signed in with their OWN account) claims their roster entry. Returns the team id. */
export async function claimPlayerInvite(code: string): Promise<UUID> {
  const claimed = await callApi<{ team_id: UUID; player_id: UUID }>("claim-player-invite", { code: code.trim() });
  return claimed.team_id;
}

/** Guardian or head coach records a birthdate (required before a 13+ player login). */
export async function setPlayerBirthdate(playerId: UUID, birthdate: DateOnly): Promise<void> {
  await callApi("set-player-birthdate", { player_id: playerId, birthdate });
}

/** Staff, guardians, and player accounts on the team, sorted by name. */
export async function teamMembers(teamId: UUID): Promise<TeamMember[]> {
  const response = await callApi<{ members: TeamMember[] }>("team-members", { team_id: teamId });
  return response.members.sort((a, b) => a.name.localeCompare(b.name));
}

/** Active sponsors. Optional feature — never throws. */
export async function sponsors(teamId: UUID): Promise<TeamSponsor[]> {
  const today = formatDateOnly(new Date());
  const { data, error } = await supabase
    .from("team_sponsors")
    .select("*")
    .eq("team_id", teamId)
    .lte("starts_on", today)
    .or(`ends_on.is.null,ends_on.gte.${today}`);
  return error ? [] : ((data ?? []) as TeamSponsor[]);
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export async function roster(teamId: UUID): Promise<Player[]> {
  const result = await supabase
    .from("players")
    .select("*")
    .eq("team_id", teamId)
    .is("archived_at", null)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  return unwrap(result, []) as Player[];
}

/** Head coach. Creates when `draft.id` is missing, otherwise updates. */
export async function savePlayer(draft: PlayerDraft): Promise<void> {
  const row = {
    first_name: draft.first_name.trim(),
    last_name: draft.last_name.trim(),
    jersey_number: emptyToNull(draft.jersey_number),
    position: emptyToNull(draft.position),
    birthdate: draft.birthdate,
    notes: emptyToNull(draft.notes),
  };
  if (draft.id) {
    const { error } = await supabase.from("players").update(row).eq("id", draft.id);
    if (error) throw restError(error);
  } else {
    const { error } = await supabase
      .from("players")
      .insert({ ...row, team_id: draft.team_id, created_by: await currentUserId() });
    if (error) throw restError(error);
  }
}

/** Head coach. "Remove from roster" — history (attendance, payments) is kept. */
export async function archivePlayer(playerId: UUID): Promise<void> {
  const { error } = await supabase.from("players").update({ archived_at: new Date().toISOString() }).eq("id", playerId);
  if (error) throw restError(error);
}

/** Visible to staff and the child's guardians (RLS). */
export async function emergencyContacts(playerId: UUID): Promise<EmergencyContact[]> {
  const result = await supabase
    .from("player_emergency_contacts")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: true });
  return unwrap(result, []) as EmergencyContact[];
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Events for the given teams starting at or after `from` (and before `to`, if given). Max 200. */
export async function events(teamIds: UUID[], from: Date, to?: Date): Promise<TeamEvent[]> {
  if (teamIds.length === 0) return [];
  let query = supabase
    .from("events")
    .select("*")
    .in("team_id", teamIds)
    .gte("starts_at", from.toISOString())
    .order("starts_at", { ascending: true })
    .limit(200);
  if (to) query = query.lt("starts_at", to.toISOString());
  return unwrap(await query, []) as TeamEvent[];
}

export async function eventDetail(eventId: UUID): Promise<EventDetail> {
  const rows = unwrap(await supabase.from("events").select("*").eq("id", eventId), []) as TeamEvent[];
  const event = rows[0];
  if (!event) throw new ApiError("not_found", "This event is no longer available.", 404);
  const [rsvpResult, attendanceResult, players] = await Promise.all([
    supabase.from("rsvps").select("*").eq("event_id", eventId),
    supabase.from("attendance").select("*").eq("event_id", eventId),
    roster(event.team_id),
  ]);
  return {
    event,
    rsvps: unwrap(rsvpResult, []) as RSVP[],
    attendance: unwrap(attendanceResult, []) as AttendanceRecord[],
    roster: players,
  };
}

/** RSVPs the user can see for these events (staff: everyone's; families: their own kids'). */
export async function myRSVPs(eventIds: UUID[]): Promise<RSVP[]> {
  if (eventIds.length === 0) return [];
  return unwrap(await supabase.from("rsvps").select("*").in("event_id", eventIds), []) as RSVP[];
}

/** Head coach. Creates (optionally weekly-repeating) or updates an event; notifies the team. */
export async function saveEvent(draft: EventDraft): Promise<UUID[]> {
  const params: Record<string, unknown> = {
    team_id: draft.team_id,
    title: resolvedEventTitle(draft),
    event_type: draft.event_type,
    starts_at: draft.starts_at.toISOString(),
    ends_at: draft.ends_at.toISOString(),
    location: emptyToNull(draft.location),
    location_address: emptyToNull(draft.location_address),
    notes: emptyToNull(draft.notes),
  };
  if (draft.event_type === "game") {
    params.opponent = emptyToNull(draft.opponent);
    params.home_away = draft.is_home ? "home" : "away";
  }
  if (draft.id) {
    params.event_id = draft.id;
  } else if (draft.repeat_weeks > 0) {
    params.repeat_weeks = draft.repeat_weeks;
  }
  const saved = await callApi<{ event_ids: UUID[] }>("save-event", params);
  return saved.event_ids;
}

/** Head coach. Everyone on the team is notified. */
export async function cancelEvent(eventId: UUID): Promise<void> {
  await callApi("cancel-event", { event_id: eventId });
}

/** Errors: "rsvp_locked" (409) after the cutoff, "cancelled" (409), "forbidden" (403). */
export async function setRSVP(eventId: UUID, playerId: UUID, status: RSVPStatus, note?: string | null): Promise<void> {
  await callApi("set-rsvp", { event_id: eventId, player_id: playerId, status, note: emptyToNull(note) });
}

/** Head coach. Upserts one attendance row per player. */
export async function setAttendance(eventId: UUID, entries: Record<UUID, AttendanceStatus>): Promise<void> {
  const playerIds = Object.keys(entries);
  if (playerIds.length === 0) return;
  const marker = await currentUserId();
  const rows = playerIds.map((playerId) => ({
    event_id: eventId,
    player_id: playerId,
    status: entries[playerId],
    marked_by: marker,
  }));
  const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "event_id,player_id" });
  if (error) throw restError(error);
}

/** Head coach. Scores are stored home/away; `result` is from this team's perspective. */
export async function setScore(eventId: UUID, homeScore: number, awayScore: number): Promise<void> {
  const rows = unwrap(await supabase.from("events").select("home_away").eq("id", eventId), []) as Array<{ home_away: string | null }>;
  const result = resultFromScore(rows[0]?.home_away ?? null, homeScore, awayScore);
  const { error } = await supabase
    .from("events")
    .update({ home_score: homeScore, away_score: awayScore, result })
    .eq("id", eventId);
  if (error) throw restError(error);
}

/** Every attendance row for the team (season report). */
export async function teamAttendance(teamId: UUID): Promise<AttendanceRecord[]> {
  const result = await supabase
    .from("attendance")
    .select("id,event_id,player_id,status,events!inner(team_id)")
    .eq("events.team_id", teamId)
    .limit(5000);
  const rows = unwrap(result, []) as Array<AttendanceRecord & { events?: unknown }>;
  return rows.map(({ id, event_id, player_id, status }) => ({ id, event_id, player_id, status }));
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

/** Threads the user can see on the team, pinned first, newest first (max 50). */
export async function threads(teamId: UUID): Promise<MessageThread[]> {
  const response = await callApi<{ threads: MessageThread[] }>("list-threads", { team_id: teamId });
  return response.threads;
}

/** The team-wide chat thread id (created on first use). */
export async function teamChatThreadId(teamId: UUID): Promise<UUID> {
  const response = await callApi<{ thread_id: UUID }>("team-chat", { team_id: teamId });
  return response.thread_id;
}

/** Thread info + up to 500 messages, oldest first. Also marks the thread read. */
export function threadDetail(threadId: UUID): Promise<ThreadDetail> {
  return callApi<ThreadDetail>("list-messages", { thread_id: threadId });
}

/** 1–4000 characters. Players can post only in team-wide threads (two-adult rule). */
export async function postMessage(threadId: UUID, body: string): Promise<void> {
  await callApi("post-message", { thread_id: threadId, body });
}

/** Staff only. Starts a thread with a first message. Returns the thread id. */
export async function createThread(teamId: UUID, title: string, audience: MessageAudience, body: string): Promise<UUID> {
  const created = await callApi<{ thread_id: UUID }>("create-thread", {
    team_id: teamId,
    title: emptyToNull(title),
    audience,
    body,
  });
  return created.thread_id;
}

/** Your own message, or any message if you're the head coach. */
export async function deleteMessage(messageId: UUID): Promise<void> {
  await callApi("delete-message", { message_id: messageId });
}

export async function setMute(threadId: UUID, muted: boolean): Promise<void> {
  await callApi("set-mute", { thread_id: threadId, muted });
}

/** Newest first, max 50. */
export async function announcements(teamId: UUID): Promise<Announcement[]> {
  const result = await supabase
    .from("announcements")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(50);
  return unwrap(result, []) as Announcement[];
}

/** Head coach. Everyone on the team (including players) is notified. */
export async function createAnnouncement(teamId: UUID, title: string, body: string): Promise<void> {
  await callApi("create-announcement", { team_id: teamId, title, body });
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/** Newest first, max 100. */
export async function inbox(): Promise<InboxItem[]> {
  const response = await callApi<{ items: InboxItem[] }>("inbox");
  return response.items;
}

/** Marks one item read, or all items when `id` is null. */
export async function markRead(id: UUID | null): Promise<void> {
  await callApi("mark-read", id ? { id } : { all: true });
}

// ---------------------------------------------------------------------------
// Money (team dues)
// ---------------------------------------------------------------------------

export function dues(teamId: UUID): Promise<DuesOverview> {
  return callApi<DuesOverview>("list-dues", { team_id: teamId });
}

/** Head coach. One item per active player; guardians are notified. Amount 100–500000 cents. */
export async function createDues(
  teamId: UUID,
  title: string,
  description: string | null,
  amountCents: number,
  dueDate: DateOnly | null,
): Promise<void> {
  await callApi("create-dues", {
    team_id: teamId,
    title,
    description: emptyToNull(description),
    amount_cents: amountCents,
    due_date: dueDate,
  });
}

/** Head coach records a cash/Venmo payment, waives, or reverts. Fails with "conflict" while "processing". */
export async function setDuesStatus(itemId: UUID, status: Exclude<DuesStatus, "processing">): Promise<void> {
  await callApi("set-dues-status", { item_id: itemId, status });
}

/** Head coach, Coach Pro. Returns how many families were reminded. */
export async function remindUnpaid(requestId: UUID): Promise<number> {
  const response = await callApi<{ reminded: number }>("remind-unpaid", { request_id: requestId });
  return response.reminded;
}

/** Head coach. Stripe Connect onboarding URL (only when CARD_PAYMENTS_ENABLED). */
export async function connectPayments(teamId: UUID): Promise<string> {
  const response = await callApi<{ url: string }>("connect-payments", { team_id: teamId });
  return response.url;
}

export async function refreshPayments(teamId: UUID): Promise<void> {
  await callApi("refresh-payments", { team_id: teamId });
}

/** Guardian. Stripe Checkout for up to 20 unpaid items on one team (only when CARD_PAYMENTS_ENABLED). */
export function checkout(itemIds: UUID[]): Promise<CheckoutSession> {
  return callApi<CheckoutSession>("checkout", { item_ids: itemIds });
}
