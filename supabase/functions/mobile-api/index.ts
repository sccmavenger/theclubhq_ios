// ClubHQ mobile API (DECISIONS D-005).
//
// One POST endpoint: { "action": "<name>", ...params }. Every action:
//   1. authenticates the caller from their Supabase JWT,
//   2. authorizes with the same rules as the web app's server functions,
//   3. uses the caller-scoped client wherever RLS already expresses the rule, and the
//      service-role client only for the privileged steps the web app also does with it.
// Responses are snake_case JSON; errors are { error: { code, message } }.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import {
  adminClient,
  ApiError,
  corsHeaders,
  errorResponse,
  json,
  randomToken,
  shortCode,
  userClient,
} from "../_shared/http.ts";
import { enqueueTeamNotification } from "../_shared/notify.ts";
import { dispatchPendingPushes } from "../_shared/dispatch.ts";
import { syncFromDevice } from "../_shared/appstore.ts";
import { checkoutFeeCents, stripe } from "../_shared/stripe.ts";
import { addLocalDays, formatEventTime, validTimeZone } from "../_shared/time.ts";

type Params = Record<string, unknown>;
interface Ctx {
  uid: string;
  email: string;
  admin: SupabaseClient;
  db: SupabaseClient; // caller-scoped (RLS)
}

const STAFF_ROLES = ["head_coach", "assistant_coach", "team_manager"];
const SPORTS = ["basketball", "soccer", "baseball", "softball", "volleyball", "football", "hockey", "lacrosse", "other"];
const RELATIONSHIPS = ["mother", "father", "guardian", "other"];
const FREE_TEAM_LIMIT = 1;
const PRO_TEAM_LIMIT = 3;
const MIN_PLAYER_ACCOUNT_AGE = 13;
const DEFAULT_CUTOFF_LEAD_MS = 4 * 3600_000;
const DAY_MS = 24 * 3600_000;
/** Team codes last a season (D-036); co-parent invites keep the 30-day column default. */
const TEAM_CODE_LIFETIME_MS = 365 * DAY_MS;
const CHAT_PHOTOS_BUCKET = "chat-photos";
const PHOTO_URL_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function str(p: Params, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const v = p[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    throw new ApiError("invalid_input", `${key} is required`);
  }
  if (typeof v !== "string") throw new ApiError("invalid_input", `${key} must be text`);
  const t = v.trim();
  if (opts.min !== undefined && t.length < opts.min) throw new ApiError("invalid_input", `${key} is too short`);
  if (opts.max !== undefined && t.length > opts.max) throw new ApiError("invalid_input", `${key} is too long`);
  return t;
}
/// Accepts "@name", "$name", or a pasted venmo.com / cash.app link and returns the bare handle
/// (or null to clear). Venmo usernames: 5-30 letters, digits, - or _; $Cashtags: 1-20 letters/digits.
function paymentHandle(p: Params, key: "venmo_username" | "cashapp_cashtag"): string | null {
  let v = str(p, key, { max: 200, optional: true });
  if (!v) return null;
  v = v.replace(/^https?:\/\//i, "").replace(/^(www\.)?(venmo\.com\/(u\/)?|cash\.app\/)/i, "");
  v = v.split(/[/?#]/)[0].replace(/^[@$]/, "");
  const ok = key === "venmo_username" ? /^[A-Za-z0-9_-]{5,30}$/.test(v) : /^(?=.*[A-Za-z])[A-Za-z0-9]{1,20}$/.test(v);
  if (!ok) {
    throw new ApiError("invalid_input", key === "venmo_username"
      ? "That doesn't look like a Venmo username (5–30 letters, numbers, - or _)."
      : "That doesn't look like a $Cashtag (up to 20 letters and numbers).");
  }
  return v;
}
function uuid(p: Params, key: string): string {
  const v = str(p, key);
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new ApiError("invalid_input", `${key} is not a valid id`);
  return v;
}
function int(p: Params, key: string, min: number, max: number, optional = false): number | null {
  const v = p[key];
  if (v === undefined || v === null) {
    if (optional) return null;
    throw new ApiError("invalid_input", `${key} is required`);
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new ApiError("invalid_input", `${key} is out of range`);
  }
  return v;
}
function oneOf<T extends string>(p: Params, key: string, values: readonly T[], fallback?: T): T {
  const v = (p[key] ?? fallback) as T;
  if (!values.includes(v)) throw new ApiError("invalid_input", `${key} is not valid`);
  return v;
}
function isoDate(p: Params, key: string, optional = false): string | null {
  const v = p[key];
  if (v === undefined || v === null || v === "") {
    if (optional) return null;
    throw new ApiError("invalid_input", `${key} is required`);
  }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new ApiError("invalid_input", `${key} is not a valid date`);
  return d.toISOString();
}
/** Invite codes are 10 uppercase characters (typed by parents); older tokens pass through. */
function inviteToken(p: Params): string {
  const raw = str(p, "token", { min: 8, max: 64 }).replace(/[\s-]/g, "");
  return raw.length <= 12 ? raw.toUpperCase() : raw;
}
function ageOn(birthdate: string, now = new Date()): number {
  const b = new Date(`${birthdate}T00:00:00Z`);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

// ---------------------------------------------------------------------------
// Authorization helpers (mirror private.* SQL helpers, evaluated with service role)
// ---------------------------------------------------------------------------
async function teamOrg(ctx: Ctx, teamId: string): Promise<string | null> {
  const { data } = await ctx.admin.from("teams").select("org_id").eq("id", teamId).maybeSingle();
  return data?.org_id ?? null;
}
async function rolesOnTeam(ctx: Ctx, teamId: string): Promise<string[]> {
  const orgId = await teamOrg(ctx, teamId);
  const { data } = await ctx.admin
    .from("user_roles")
    .select("role, team_id, org_id")
    .eq("user_id", ctx.uid)
    .or(`team_id.eq.${teamId}${orgId ? `,and(org_id.eq.${orgId},team_id.is.null)` : ""}`);
  return (data ?? []).map((r) => r.role);
}
async function isParentOnTeam(ctx: Ctx, teamId: string): Promise<boolean> {
  const { data } = await ctx.admin
    .from("parent_player_links")
    .select("player_id, players!inner(team_id)")
    .eq("parent_user_id", ctx.uid)
    .eq("players.team_id", teamId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
async function requireMember(ctx: Ctx, teamId: string): Promise<{ roles: string[]; isParent: boolean }> {
  const roles = await rolesOnTeam(ctx, teamId);
  const isParent = await isParentOnTeam(ctx, teamId);
  if (roles.length === 0 && !isParent) throw new ApiError("forbidden", "You're not a member of this team.", 403);
  return { roles, isParent };
}
async function requireStaff(ctx: Ctx, teamId: string): Promise<string[]> {
  const roles = await rolesOnTeam(ctx, teamId);
  if (!roles.some((r) => STAFF_ROLES.includes(r) || r === "program_director")) {
    throw new ApiError("forbidden", "Only team staff can do that.", 403);
  }
  return roles;
}
async function requireHeadCoach(ctx: Ctx, teamId: string): Promise<void> {
  const roles = await rolesOnTeam(ctx, teamId);
  if (!roles.includes("head_coach")) throw new ApiError("forbidden", "Only the head coach can do that.", 403);
}
async function isCoachPro(ctx: Ctx, userId = ctx.uid): Promise<boolean> {
  const { data } = await ctx.admin.rpc("user_has_coach_pro", { _user_id: userId });
  return data === true;
}
async function teamIsPro(ctx: Ctx, teamId: string): Promise<boolean> {
  const { data } = await ctx.admin.rpc("team_is_pro", { _team_id: teamId });
  return data === true;
}
async function profileNames(ctx: Ctx, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await ctx.admin.from("profiles").select("id, full_name").in("id", ids);
  return Object.fromEntries((data ?? []).map((p) => [p.id, (p.full_name ?? "").trim() || "Member"]));
}
/** Case-insensitive exact match for `ilike`: escapes the `%` and `_` wildcards. */
function likeExact(value: string): string {
  return value.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Links the caller to an existing child as an additional guardian (co-parent invite, D-035). */
async function claimGuardianInvite(ctx: Ctx, teamId: string, playerId: string, p: Params) {
  const relationship = oneOf(p, "parent_relationship", RELATIONSHIPS);
  const { data: player } = await ctx.admin
    .from("players")
    .select("id, first_name, last_name, archived_at")
    .eq("id", playerId)
    .maybeSingle();
  if (!player || player.archived_at) throw new ApiError("expired", "This invite is no longer valid. Ask for a new one.", 410);
  const { data: already } = await ctx.admin
    .from("parent_player_links")
    .select("id")
    .eq("player_id", playerId)
    .eq("parent_user_id", ctx.uid)
    .maybeSingle();
  if (!already) {
    const { error: linkErr } = await ctx.admin
      .from("parent_player_links")
      .insert({ player_id: playerId, parent_user_id: ctx.uid, relationship });
    if (linkErr) throw new ApiError("internal", linkErr.message, 500);
  }
  const { data: existingRole } = await ctx.admin
    .from("user_roles")
    .select("id")
    .eq("user_id", ctx.uid)
    .eq("team_id", teamId)
    .eq("role", "parent")
    .maybeSingle();
  if (!existingRole) await ctx.admin.from("user_roles").insert({ user_id: ctx.uid, role: "parent", team_id: teamId });
  if (!already) await notifyFamilyJoined(ctx, teamId, playerId, `${player.first_name} ${player.last_name}`, true);
  return { team_id: teamId, player_id: playerId };
}

/** Tells the team's staff that a family joined, so coaches see the roster fill up (D-035). */
async function notifyFamilyJoined(ctx: Ctx, teamId: string, playerId: string, childName: string, coParent: boolean) {
  const [{ data: profile }, { data: staff }] = await Promise.all([
    ctx.admin.from("profiles").select("full_name").eq("id", ctx.uid).maybeSingle(),
    ctx.admin.from("user_roles").select("user_id").eq("team_id", teamId).in("role", ["head_coach", "assistant_coach", "team_manager"]),
  ]);
  const recipients = [...new Set((staff ?? []).map((s: { user_id: string }) => s.user_id))].filter((u) => u !== ctx.uid);
  if (recipients.length === 0) return;
  const who = profile?.full_name?.trim() || "A parent";
  await notify(ctx, {
    teamId,
    kind: "family_joined",
    subject: coParent ? `${who} joined as ${childName}'s guardian` : `${who} added ${childName} to the team`,
    body: coParent ? "They'll get the schedule, announcements, and RSVPs." : "Tap to see your roster.",
    refId: playerId,
    recipientUserIds: recipients,
  });
}

async function newTeamCode(ctx: Ctx, teamId: string, expiresAt: string) {
  const { data, error } = await ctx.admin
    .from("team_invites")
    .insert({ team_id: teamId, token: shortCode(10), created_by: ctx.uid, expires_at: expiresAt })
    .select("token, expires_at")
    .single();
  if (error || !data) throw new ApiError("internal", error?.message ?? "Could not create invite", 500);
  return data;
}

/** Reads the thread under the caller's RLS and applies the two-adult rule (D-009). */
async function requirePostableThread(ctx: Ctx, threadId: string) {
  const { data: thread } = await ctx.db
    .from("message_threads")
    .select("id, team_id, kind, title, audience")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) throw new ApiError("not_found", "Conversation not found.", 404);
  const roles = await rolesOnTeam(ctx, thread.team_id);
  const isOnlyPlayer = roles.length > 0 && roles.every((r) => r === "player");
  if (isOnlyPlayer && (thread.kind === "direct" || thread.kind === "group")) {
    throw new ApiError("forbidden", "Players can post in team chat only.", 403);
  }
  return thread;
}

/** Chat photos live at `<team>/<thread>/<author>/<random>.jpg` in the private bucket (D-036). */
function photoFolder(teamId: string, threadId: string, userId: string): string {
  return `${teamId}/${threadId}/${userId}`;
}

/**
 * The zone to schedule in (D-037): the caller's phone zone when sent, else the team's last
 * known zone. A head coach's valid zone is remembered on the team for older app builds.
 */
async function eventTimeZone(ctx: Ctx, teamId: string, p: Params): Promise<string | null> {
  const sent = validTimeZone(p.time_zone);
  const { data: team } = await ctx.admin.from("teams").select("time_zone").eq("id", teamId).maybeSingle();
  if (sent && sent !== team?.time_zone && (await rolesOnTeam(ctx, teamId)).includes("head_coach")) {
    await ctx.admin.from("teams").update({ time_zone: sent }).eq("id", teamId);
  }
  return sent ?? validTimeZone(team?.time_zone);
}

/** Calendar feed URL for the caller, creating the secret token on first use (D-036). */
async function calendarFeedURL(ctx: Ctx, rotate: boolean): Promise<{ url: string }> {
  let token: string | null = null;
  if (!rotate) {
    const { data } = await ctx.admin.from("calendar_feeds").select("token").eq("user_id", ctx.uid).maybeSingle();
    token = data?.token ?? null;
  }
  if (!token) {
    token = randomToken(24);
    const { error } = await ctx.admin
      .from("calendar_feeds")
      .upsert({ user_id: ctx.uid, token, created_at: new Date().toISOString(), last_fetched_at: null }, { onConflict: "user_id" });
    if (error) throw new ApiError("internal", error.message, 500);
  }
  return { url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/calendar-feed/${token}.ics` };
}

/** Fan out, then push to iOS immediately (cron catches anything missed). */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Fan-out runs in the background (EdgeRuntime.waitUntil) so the user's action returns
// immediately; recipients' inbox rows and pushes follow a moment later.
function notify(ctx: Ctx, input: Parameters<typeof enqueueTeamNotification>[1]): Promise<void> {
  const work = (async () => {
    try {
      await enqueueTeamNotification(ctx.admin, { senderUserId: ctx.uid, ...input });
      await dispatchPendingPushes(ctx.admin, 100);
    } catch (e) {
      console.error("notify failed", e); // never fail the user's action because of fan-out
    }
  })();
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(work);
    return Promise.resolve();
  }
  return work;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const actions: Record<string, (ctx: Ctx, p: Params) => Promise<unknown>> = {
  // ----- Context ------------------------------------------------------------
  async context(ctx) {
    const [{ data: roles }, { data: links }, { data: selfPlayers }, { data: profile }] = await Promise.all([
      ctx.admin.from("user_roles").select("team_id, org_id, role").eq("user_id", ctx.uid),
      ctx.admin
        .from("parent_player_links")
        .select("relationship, players!inner(id, team_id, first_name, last_name, jersey_number, birthdate, position, user_id, archived_at)")
        .eq("parent_user_id", ctx.uid),
      ctx.admin
        .from("players")
        .select("id, team_id, first_name, last_name, jersey_number, birthdate, position, user_id, archived_at")
        .eq("user_id", ctx.uid)
        .is("archived_at", null),
      ctx.admin.from("profiles").select("full_name").eq("id", ctx.uid).maybeSingle(),
    ]);

    const orgIds = (roles ?? []).filter((r) => !r.team_id && r.org_id).map((r) => r.org_id as string);
    const teamIds = new Set<string>();
    (roles ?? []).forEach((r) => r.team_id && teamIds.add(r.team_id));
    (links ?? []).forEach((l) => teamIds.add((l.players as unknown as { team_id: string }).team_id));
    (selfPlayers ?? []).forEach((p) => teamIds.add(p.team_id));

    let teamQuery = ctx.admin
      .from("teams")
      .select("id, name, age_group, season, sport, brand_color, org_id, logo_url, venmo_username, cashapp_cashtag")
      .is("archived_at", null);
    if (orgIds.length > 0) {
      teamQuery = teamQuery.or(`id.in.(${[...teamIds].join(",") || "00000000-0000-0000-0000-000000000000"}),org_id.in.(${orgIds.join(",")})`);
    } else {
      teamQuery = teamQuery.in("id", [...teamIds].length ? [...teamIds] : ["00000000-0000-0000-0000-000000000000"]);
    }
    const { data: teams } = await teamQuery.order("created_at", { ascending: true });

    const result = await Promise.all(
      (teams ?? []).map(async (t) => {
        const teamRoles = (roles ?? [])
          .filter((r) => r.team_id === t.id || (!r.team_id && r.org_id === t.org_id))
          .map((r) => r.role);
        const linked = (links ?? [])
          .map((l) => ({ ...(l.players as unknown as Record<string, unknown>), relationship: l.relationship }))
          .filter((pl) => pl.team_id === t.id && !pl.archived_at);
        if (linked.length > 0 && !teamRoles.includes("parent")) teamRoles.push("parent");
        const self = (selfPlayers ?? []).find((sp) => sp.team_id === t.id) ?? null;
        return {
          ...t,
          roles: [...new Set(teamRoles)],
          linked_players: linked,
          player_self: self,
          is_pro: await teamIsPro(ctx, t.id),
        };
      }),
    );

    return {
      user_id: ctx.uid,
      email: ctx.email,
      full_name: profile?.full_name ?? null,
      is_coach_pro: await isCoachPro(ctx),
      teams: result,
    };
  },

  async "update-profile"(ctx, p) {
    const fullName = str(p, "full_name", { min: 1, max: 120 });
    const { error } = await ctx.admin.from("profiles").upsert({ id: ctx.uid, full_name: fullName });
    if (error) throw new ApiError("internal", error.message, 500);
    return { ok: true };
  },

  // ----- Teams & invites ------------------------------------------------------
  async "create-team"(ctx, p) {
    const orgType = oneOf(p, "org_type", ["club", "independent"] as const, "independent");
    const teamName = str(p, "team_name", { min: 1, max: 120 });
    const orgName = str(p, "org_name", { max: 120, optional: true }) || teamName;
    const sport = oneOf(p, "sport", SPORTS, "basketball");
    const ageGroup = str(p, "age_group", { max: 40, optional: true }) || null;
    const season = str(p, "season", { max: 40, optional: true }) || null;

    // Free plan = 1 team as head coach; Coach Pro = up to 3 (DECISIONS D-011).
    const { count } = await ctx.admin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.uid)
      .eq("role", "head_coach");
    const owned = count ?? 0;
    const pro = await isCoachPro(ctx);
    if (owned >= PRO_TEAM_LIMIT) {
      throw new ApiError("team_limit", `You can be head coach of up to ${PRO_TEAM_LIMIT} teams.`, 402);
    }
    if (owned >= FREE_TEAM_LIMIT && !pro) {
      throw new ApiError("upgrade_required", "Coach Pro lets you run up to 3 teams.", 402);
    }

    const { data: org, error: orgErr } = await ctx.admin
      .from("organizations")
      .insert({ name: orgName, type: orgType, created_by: ctx.uid })
      .select("id")
      .single();
    if (orgErr || !org) throw new ApiError("internal", orgErr?.message ?? "Could not create organization", 500);

    const { data: team, error: teamErr } = await ctx.admin
      .from("teams")
      .insert({ org_id: org.id, name: teamName, age_group: ageGroup, season, sport, created_by: ctx.uid })
      .select("id")
      .single();
    if (teamErr || !team) throw new ApiError("internal", teamErr?.message ?? "Could not create team", 500);

    const roles = [{ user_id: ctx.uid, role: "head_coach", team_id: team.id, org_id: org.id }];
    if (orgType === "club") roles.push({ user_id: ctx.uid, role: "program_director", team_id: null as unknown as string, org_id: org.id });
    const { error: roleErr } = await ctx.admin.from("user_roles").insert(roles);
    if (roleErr) throw new ApiError("internal", roleErr.message, 500);
    return { team_id: team.id, org_id: org.id };
  },

  async "update-team"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireHeadCoach(ctx, teamId);
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = str(p, "name", { min: 1, max: 120 });
    if (p.age_group !== undefined) patch.age_group = str(p, "age_group", { max: 40, optional: true }) || null;
    if (p.season !== undefined) patch.season = str(p, "season", { max: 40, optional: true }) || null;
    if (p.sport !== undefined) patch.sport = oneOf(p, "sport", SPORTS);
    if (p.brand_color !== undefined) {
      const color = str(p, "brand_color", { optional: true });
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new ApiError("invalid_input", "Color must look like #1F6FEB");
      if (color && !(await teamIsPro(ctx, teamId))) throw new ApiError("upgrade_required", "Team colors are a Coach Pro feature.", 402);
      patch.brand_color = color || null;
    }
    // Venmo / Cash App handles for paying dues outside the app (D-033). Free on every plan.
    if (p.venmo_username !== undefined) patch.venmo_username = paymentHandle(p, "venmo_username");
    if (p.cashapp_cashtag !== undefined) patch.cashapp_cashtag = paymentHandle(p, "cashapp_cashtag");
    const { error } = await ctx.db.from("teams").update(patch).eq("id", teamId);
    if (error) throw new ApiError("internal", error.message, 500);
    return { ok: true };
  },

  async "create-invite"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireHeadCoach(ctx, teamId);
    // Reuse a live invite so the coach always shares the same link, and keep it good for a
    // season from today: the link gets pinned in group chats (D-036).
    const seasonEnd = new Date(Date.now() + TEAM_CODE_LIFETIME_MS).toISOString();
    const { data: existing } = await ctx.admin
      .from("team_invites")
      .select("id, token, expires_at")
      .eq("team_id", teamId)
      .is("player_id", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      if (new Date(existing.expires_at).getTime() < Date.now() + TEAM_CODE_LIFETIME_MS - 7 * DAY_MS) {
        await ctx.admin.from("team_invites").update({ expires_at: seasonEnd }).eq("id", existing.id);
        return { token: existing.token, expires_at: seasonEnd };
      }
      return { token: existing.token, expires_at: existing.expires_at };
    }
    return await newTeamCode(ctx, teamId, seasonEnd);
  },

  // A long-lived code can leak beyond the team; the head coach replaces it (D-036).
  // Families who already joined are unaffected; co-parent invites stay valid.
  async "reset-invite"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireHeadCoach(ctx, teamId);
    const { error } = await ctx.admin
      .from("team_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("team_id", teamId)
      .is("player_id", null)
      .is("revoked_at", null);
    if (error) throw new ApiError("internal", error.message, 500);
    return await newTeamCode(ctx, teamId, new Date(Date.now() + TEAM_CODE_LIFETIME_MS).toISOString());
  },

  async "lookup-invite"(ctx, p) {
    const token = inviteToken(p);
    const { data: invite } = await ctx.admin
      .from("team_invites")
      .select("team_id, player_id, expires_at, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (!invite || invite.revoked_at || new Date(invite.expires_at) < new Date()) return { valid: false };
    let player: { id: string; first_name: string } | null = null;
    if (invite.player_id) {
      const { data } = await ctx.admin.from("players").select("id, first_name, archived_at").eq("id", invite.player_id).maybeSingle();
      if (!data || data.archived_at) return { valid: false };
      player = { id: data.id, first_name: data.first_name };
    }
    const { data: team } = await ctx.admin
      .from("teams")
      .select("id, name, age_group, season, sport")
      .eq("id", invite.team_id)
      .single();
    const { roles, isParent } = await requireMember(ctx, invite.team_id).catch(() => ({ roles: [], isParent: false }));
    return { valid: true, team, player, already_on_team: roles.length > 0 || isParent };
  },

  // Port of claimInviteWithNewPlayer: creates player + emergency contacts + parent link + role.
  // A co-parent invite (player_id set) links to that existing child instead (D-035).
  async "claim-invite"(ctx, p) {
    const token = inviteToken(p);
    const { data: invite } = await ctx.admin
      .from("team_invites")
      .select("team_id, player_id, expires_at, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (!invite) throw new ApiError("not_found", "Invite not found.", 404);
    if (invite.revoked_at || new Date(invite.expires_at) < new Date()) {
      throw new ApiError("expired", "This invite link has expired. Ask your coach for a new one.", 410);
    }
    const teamId = invite.team_id;
    if (invite.player_id) return await claimGuardianInvite(ctx, teamId, invite.player_id, p);

    const child = (p.child ?? {}) as Params;
    const firstName = str(child, "first_name", { min: 1, max: 80 });
    const lastName = str(child, "last_name", { min: 1, max: 80 });
    const position = str(child, "position", { max: 40, optional: true }) || null;
    const jersey = str(child, "jersey_number", { max: 8, optional: true }) || null;
    const birthdate = str(child, "birthdate", { optional: true }) || null;
    if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) throw new ApiError("invalid_input", "Birthdate must be YYYY-MM-DD");
    const relationship = oneOf(child, "parent_relationship", RELATIONSHIPS);
    const contacts = Array.isArray(child.contacts) ? (child.contacts as Params[]) : [];
    if (contacts.length === 0) throw new ApiError("invalid_input", "At least one emergency contact is required");
    const contactRows = contacts.slice(0, 4).map((c) => ({
      relationship: oneOf(c, "relationship", RELATIONSHIPS),
      phone: str(c, "phone", { min: 4, max: 40 }),
      name: str(c, "name", { max: 120, optional: true }) || null,
      email: str(c, "email", { max: 200, optional: true }) || null,
    }));

    // Co-parents using the team code would otherwise create a second "Jordan Smith".
    // Ask first; the client re-sends with allow_duplicate when it really is another child.
    if (p.allow_duplicate !== true) {
      const { data: sameName } = await ctx.admin
        .from("players")
        .select("id")
        .eq("team_id", teamId)
        .is("archived_at", null)
        .ilike("first_name", likeExact(firstName))
        .ilike("last_name", likeExact(lastName))
        .limit(1);
      if (sameName && sameName.length > 0) {
        throw new ApiError("possible_duplicate", `${firstName.trim()} ${lastName.trim()} is already on this team.`, 409);
      }
    }

    const { data: player, error: pErr } = await ctx.admin
      .from("players")
      .insert({ team_id: teamId, first_name: firstName, last_name: lastName, position, jersey_number: jersey, birthdate, created_by: ctx.uid })
      .select("id")
      .single();
    if (pErr || !player) throw new ApiError("internal", pErr?.message ?? "Could not add player", 500);

    const { error: cErr } = await ctx.admin
      .from("player_emergency_contacts")
      .insert(contactRows.map((c) => ({ ...c, player_id: player.id, created_by: ctx.uid })));
    if (cErr) throw new ApiError("internal", cErr.message, 500);

    const { data: existingRole } = await ctx.admin
      .from("user_roles")
      .select("id")
      .eq("user_id", ctx.uid)
      .eq("team_id", teamId)
      .eq("role", "parent")
      .maybeSingle();
    if (!existingRole) await ctx.admin.from("user_roles").insert({ user_id: ctx.uid, role: "parent", team_id: teamId });

    const { error: linkErr } = await ctx.admin
      .from("parent_player_links")
      .upsert({ player_id: player.id, parent_user_id: ctx.uid, relationship }, { onConflict: "player_id,parent_user_id", ignoreDuplicates: true });
    if (linkErr) throw new ApiError("internal", linkErr.message, 500);
    await notifyFamilyJoined(ctx, teamId, player.id, `${firstName.trim()} ${lastName.trim()}`, false);
    return { team_id: teamId, player_id: player.id };
  },

  // A guardian of the child, or the head coach, invites a second guardian (D-035).
  // Reuses a live invite so re-opening the screen shows the same link.
  async "create-guardian-invite"(ctx, p) {
    const playerId = uuid(p, "player_id");
    const { data: player } = await ctx.admin
      .from("players")
      .select("id, team_id, archived_at")
      .eq("id", playerId)
      .maybeSingle();
    if (!player || player.archived_at) throw new ApiError("not_found", "Player not found.", 404);
    const roles = await rolesOnTeam(ctx, player.team_id);
    const { data: link } = await ctx.admin
      .from("parent_player_links")
      .select("id")
      .eq("player_id", playerId)
      .eq("parent_user_id", ctx.uid)
      .maybeSingle();
    if (!roles.includes("head_coach") && !link) {
      throw new ApiError("forbidden", "Only a guardian or the head coach can invite a co-parent.", 403);
    }
    const { data: existing } = await ctx.admin
      .from("team_invites")
      .select("token, expires_at")
      .eq("player_id", playerId)
      .is("revoked_at", null)
      .gt("expires_at", new Date(Date.now() + 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;
    const { data, error } = await ctx.admin
      .from("team_invites")
      .insert({ team_id: player.team_id, player_id: playerId, token: shortCode(10), created_by: ctx.uid })
      .select("token, expires_at")
      .single();
    if (error || !data) throw new ApiError("internal", error?.message ?? "Could not create invite", 500);
    return data;
  },

  // ----- Player accounts (13+) — DECISIONS D-008 --------------------------------
  async "create-player-invite"(ctx, p) {
    const playerId = uuid(p, "player_id");
    const { data: player } = await ctx.admin
      .from("players")
      .select("id, team_id, birthdate, user_id, first_name")
      .eq("id", playerId)
      .maybeSingle();
    if (!player) throw new ApiError("not_found", "Player not found.", 404);
    const roles = await rolesOnTeam(ctx, player.team_id);
    const { data: link } = await ctx.admin
      .from("parent_player_links")
      .select("id")
      .eq("player_id", playerId)
      .eq("parent_user_id", ctx.uid)
      .maybeSingle();
    if (!roles.includes("head_coach") && !link) {
      throw new ApiError("forbidden", "Only a guardian or the head coach can invite this player.", 403);
    }
    if (player.user_id) throw new ApiError("already_claimed", `${player.first_name} already has a player account.`, 409);
    if (!player.birthdate) throw new ApiError("birthdate_required", "Add a birthdate first — player accounts are for ages 13+.", 422);
    if (ageOn(player.birthdate) < MIN_PLAYER_ACCOUNT_AGE) {
      throw new ApiError("too_young", "Player accounts are available from age 13. Younger players stay on a guardian's account.", 422);
    }
    const { data, error } = await ctx.admin
      .from("player_invites")
      .insert({ player_id: playerId, code: shortCode(8), created_by: ctx.uid })
      .select("code, expires_at")
      .single();
    if (error || !data) throw new ApiError("internal", error?.message ?? "Could not create code", 500);
    return data;
  },

  async "claim-player-invite"(ctx, p) {
    const code = str(p, "code", { min: 6, max: 12 }).toUpperCase();
    const { data: invite } = await ctx.admin
      .from("player_invites")
      .select("id, player_id, expires_at, claimed_at")
      .eq("code", code)
      .maybeSingle();
    if (!invite || invite.claimed_at || new Date(invite.expires_at) < new Date()) {
      throw new ApiError("expired", "That code isn't valid anymore. Ask your parent or coach for a new one.", 410);
    }
    const { data: player } = await ctx.admin
      .from("players")
      .select("id, team_id, birthdate, user_id")
      .eq("id", invite.player_id)
      .single();
    if (!player || player.user_id) throw new ApiError("already_claimed", "This player already has an account.", 409);
    if (!player.birthdate || ageOn(player.birthdate) < MIN_PLAYER_ACCOUNT_AGE) {
      throw new ApiError("too_young", "Player accounts are available from age 13.", 422);
    }
    const { data: guardianOf } = await ctx.admin
      .from("parent_player_links")
      .select("id")
      .eq("player_id", player.id)
      .eq("parent_user_id", ctx.uid)
      .maybeSingle();
    if (guardianOf) throw new ApiError("forbidden", "Sign in with the player's own account to use this code.", 403);

    await ctx.admin.from("players").update({ user_id: ctx.uid }).eq("id", player.id);
    const { data: existingRole } = await ctx.admin
      .from("user_roles")
      .select("id")
      .eq("user_id", ctx.uid)
      .eq("team_id", player.team_id)
      .eq("role", "player")
      .maybeSingle();
    if (!existingRole) await ctx.admin.from("user_roles").insert({ user_id: ctx.uid, role: "player", team_id: player.team_id });
    await ctx.admin.from("player_invites").update({ claimed_at: new Date().toISOString(), claimed_by: ctx.uid }).eq("id", invite.id);
    return { team_id: player.team_id, player_id: player.id };
  },

  // Guardian (linked parent) or head coach records a birthdate — required before a 13+
  // player login can be created (D-008). Guardians can't edit other roster fields.
  async "set-player-birthdate"(ctx, p) {
    const playerId = uuid(p, "player_id");
    const birthdate = str(p, "birthdate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(birthdate))) {
      throw new ApiError("invalid_input", "Birthdate must be YYYY-MM-DD");
    }
    if (new Date(birthdate) > new Date()) throw new ApiError("invalid_input", "Birthdate can't be in the future.");
    const { data: player } = await ctx.admin.from("players").select("id, team_id").eq("id", playerId).maybeSingle();
    if (!player) throw new ApiError("not_found", "Player not found.", 404);
    const roles = await rolesOnTeam(ctx, player.team_id);
    const { data: link } = await ctx.admin.from("parent_player_links").select("id")
      .eq("player_id", playerId).eq("parent_user_id", ctx.uid).maybeSingle();
    if (!roles.includes("head_coach") && !link) {
      throw new ApiError("forbidden", "Only a guardian or the head coach can update this player.", 403);
    }
    await ctx.admin.from("players").update({ birthdate }).eq("id", playerId);
    return { ok: true };
  },

  // ----- Members -------------------------------------------------------------
  async "team-members"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireMember(ctx, teamId);
    const [{ data: staff }, { data: links }, { data: players }] = await Promise.all([
      ctx.admin.from("user_roles").select("user_id, role").eq("team_id", teamId).in("role", [...STAFF_ROLES]),
      ctx.admin
        .from("parent_player_links")
        .select("parent_user_id, relationship, players!inner(id, team_id, first_name, last_name)")
        .eq("players.team_id", teamId),
      ctx.admin.from("players").select("id, user_id, first_name, last_name").eq("team_id", teamId).is("archived_at", null).not("user_id", "is", null),
    ]);
    const members = new Map<string, { user_id: string; roles: Set<string>; children: string[] }>();
    const touch = (id: string) => {
      if (!members.has(id)) members.set(id, { user_id: id, roles: new Set(), children: [] });
      return members.get(id)!;
    };
    (staff ?? []).forEach((s) => touch(s.user_id).roles.add(s.role));
    (links ?? []).forEach((l) => {
      const m = touch(l.parent_user_id);
      m.roles.add("parent");
      const pl = l.players as unknown as { first_name: string };
      m.children.push(pl.first_name);
    });
    (players ?? []).forEach((pl) => touch(pl.user_id as string).roles.add("player"));
    const names = await profileNames(ctx, [...members.keys()]);
    const playerNames = Object.fromEntries((players ?? []).map((pl) => [pl.user_id, `${pl.first_name} ${pl.last_name}`]));
    return {
      members: [...members.values()].map((m) => ({
        user_id: m.user_id,
        name: names[m.user_id] && names[m.user_id] !== "Member" ? names[m.user_id] : (playerNames[m.user_id] ?? "Member"),
        roles: [...m.roles],
        children: m.children,
      })),
    };
  },

  // ----- Messaging -----------------------------------------------------------
  async "list-threads"(ctx, p) {
    const teamId = uuid(p, "team_id");
    const { data: threads, error } = await ctx.db
      .from("message_threads")
      .select("id, team_id, kind, event_id, audience, title, pinned, created_by, updated_at")
      .eq("team_id", teamId)
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new ApiError("internal", error.message, 500);
    const ids = (threads ?? []).map((t) => t.id);
    const [{ data: reads }, { data: mutes }] = await Promise.all([
      ctx.db.from("message_reads").select("thread_id, last_read_at").in("thread_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      ctx.db.from("thread_mutes").select("thread_id").in("thread_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const readMap = Object.fromEntries((reads ?? []).map((r) => [r.thread_id, r.last_read_at]));
    const muted = new Set((mutes ?? []).map((m) => m.thread_id));
    const withPreview = await Promise.all(
      (threads ?? []).map(async (t) => {
        const { data: last } = await ctx.db
          .from("messages")
          .select("body, image_path, author_id, created_at, deleted_at")
          .eq("thread_id", t.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return {
          ...t,
          last_message: last ? (last.deleted_at ? "[deleted]" : messagePreview(last.body, last.image_path, 140)) : null,
          last_message_at: last?.created_at ?? null,
          last_author_id: last?.author_id ?? null,
          unread: !!last && last.author_id !== ctx.uid && (!readMap[t.id] || new Date(readMap[t.id]) < new Date(last.created_at)),
          muted: muted.has(t.id),
        };
      }),
    );
    const names = await profileNames(ctx, [...new Set(withPreview.map((t) => t.last_author_id).filter(Boolean) as string[])]);
    return { threads: withPreview.map((t) => ({ ...t, last_author_name: t.last_author_id ? names[t.last_author_id] ?? "Member" : null })) };
  },

  async "team-chat"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireMember(ctx, teamId);
    const find = () =>
      ctx.admin
        .from("message_threads")
        .select("id")
        .eq("team_id", teamId)
        .eq("kind", "team")
        .eq("audience", "both")
        .eq("title", "Team chat")
        .is("event_id", null)
        .is("deleted_at", null)
        .maybeSingle();
    const { data: existing } = await find();
    if (existing) return { thread_id: existing.id };
    const { data: created, error } = await ctx.admin
      .from("message_threads")
      .insert({ team_id: teamId, kind: "team", audience: "both", title: "Team chat", pinned: true, created_by: ctx.uid })
      .select("id")
      .single();
    if (error) {
      const { data: again } = await find(); // lost the race to the unique index
      if (again) return { thread_id: again.id };
      throw new ApiError("internal", error.message, 500);
    }
    return { thread_id: created.id };
  },

  async "create-thread"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireStaff(ctx, teamId);
    const audience = oneOf(p, "audience", ["parents", "staff", "both"] as const);
    const title = str(p, "title", { max: 120, optional: true }) || null;
    const body = str(p, "body", { min: 1, max: 4000 });
    const { data: thread, error } = await ctx.db
      .from("message_threads")
      .insert({ team_id: teamId, kind: "team", audience, title, pinned: false, created_by: ctx.uid })
      .select("id")
      .single();
    if (error || !thread) throw new ApiError("internal", error?.message ?? "Could not create thread", 500);
    const { error: mErr } = await ctx.db.from("messages").insert({ thread_id: thread.id, author_id: ctx.uid, body });
    if (mErr) throw new ApiError("internal", mErr.message, 500);
    await notify(ctx, {
      teamId,
      kind: "message_new",
      subject: title ?? "New team message",
      body: body.slice(0, 240),
      refId: thread.id,
      staffOnly: audience === "staff",
      includePlayers: audience === "both",
    });
    return { thread_id: thread.id };
  },

  async "list-messages"(ctx, p) {
    const threadId = uuid(p, "thread_id");
    const { data: thread } = await ctx.db
      .from("message_threads")
      .select("id, team_id, kind, event_id, audience, title, pinned, created_by")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread) throw new ApiError("not_found", "Conversation not found.", 404);
    const roles = await rolesOnTeam(ctx, thread.team_id);
    const canModerate = roles.includes("head_coach");
    const since = typeof p.since === "string" ? isoDate(p, "since") : null;
    let q = ctx.db
      .from("messages")
      .select("id, author_id, body, image_path, image_width, image_height, edited_at, deleted_at, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (since) q = q.gt("created_at", since);
    const { data: msgs, error } = await q;
    if (error) throw new ApiError("internal", error.message, 500);
    const names = await profileNames(ctx, [...new Set((msgs ?? []).map((m) => m.author_id))]);
    // Photos are private; the caller can read this thread (RLS above), so sign short-lived URLs.
    const photoPaths = (msgs ?? []).filter((m) => m.image_path && !m.deleted_at).map((m) => m.image_path as string);
    const photoURLs: Record<string, string> = {};
    if (photoPaths.length > 0) {
      const { data: signed } = await ctx.admin.storage.from(CHAT_PHOTOS_BUCKET).createSignedUrls(photoPaths, PHOTO_URL_TTL_SECONDS);
      (signed ?? []).forEach((s) => {
        if (s.path && s.signedUrl) photoURLs[s.path] = s.signedUrl;
      });
    }
    await ctx.db.from("message_reads").upsert({ user_id: ctx.uid, thread_id: threadId, last_read_at: new Date().toISOString() });
    return {
      thread: { ...thread, can_moderate: canModerate, can_post: !(roles.includes("player") && roles.length === 1 && thread.kind !== "team") },
      messages: (msgs ?? []).map((m) => {
        const imageURL = !m.deleted_at && m.image_path ? photoURLs[m.image_path] ?? null : null;
        return {
          id: m.id,
          author_id: m.author_id,
          author_name: names[m.author_id] ?? "Member",
          body: m.deleted_at ? "[deleted]" : m.body,
          image_url: imageURL,
          image_width: imageURL ? m.image_width : null,
          image_height: imageURL ? m.image_height : null,
          created_at: m.created_at,
          edited_at: m.edited_at,
          is_deleted: !!m.deleted_at,
          is_mine: m.author_id === ctx.uid,
        };
      }),
    };
  },

  // Step 1 of a photo message (D-036): a signed upload URL in the caller's folder for this
  // thread. The app PUTs the JPEG there, then calls post-message with the returned path.
  async "create-photo-upload"(ctx, p) {
    const threadId = uuid(p, "thread_id");
    const thread = await requirePostableThread(ctx, threadId);
    const path = `${photoFolder(thread.team_id, threadId, ctx.uid)}/${randomToken(12)}.jpg`;
    const { data, error } = await ctx.admin.storage.from(CHAT_PHOTOS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError("internal", error?.message ?? "Could not start the upload", 500);
    return { upload_url: data.signedUrl, path };
  },

  async "post-message"(ctx, p) {
    const threadId = uuid(p, "thread_id");
    const imagePath = str(p, "image_path", { max: 300, optional: true }) || null;
    const body = str(p, "body", { min: imagePath ? 0 : 1, max: 4000, optional: !!imagePath });
    // Two-adult rule (D-009): players only post in team-wide threads.
    const thread = await requirePostableThread(ctx, threadId);
    let image: { image_path: string; image_width: number | null; image_height: number | null } | null = null;
    if (imagePath) {
      // Only a photo this caller uploaded for this thread, and only once it really exists.
      const folder = photoFolder(thread.team_id, threadId, ctx.uid);
      const fileName = imagePath.slice(folder.length + 1);
      if (!imagePath.startsWith(`${folder}/`) || !/^[A-Za-z0-9_-]+\.jpg$/.test(fileName)) {
        throw new ApiError("invalid_input", "That photo can't be posted here.");
      }
      const { data: found } = await ctx.admin.storage.from(CHAT_PHOTOS_BUCKET).list(folder, { search: fileName, limit: 1 });
      if (!found?.some((f) => f.name === fileName)) throw new ApiError("invalid_input", "The photo didn't finish uploading. Try again.");
      image = { image_path: imagePath, image_width: int(p, "image_width", 1, 20000, true), image_height: int(p, "image_height", 1, 20000, true) };
    }
    const { data: msg, error } = await ctx.db
      .from("messages")
      .insert({ thread_id: threadId, author_id: ctx.uid, body, ...(image ?? {}) })
      .select("id, created_at")
      .single();
    if (error || !msg) throw new ApiError("forbidden", "You can't post in this conversation.", 403);
    await ctx.admin.from("message_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

    let recipientUserIds: string[] | undefined;
    if (thread.kind === "direct" || thread.kind === "group") {
      const { data: parts } = await ctx.admin.from("thread_participants").select("user_id").eq("thread_id", threadId);
      recipientUserIds = (parts ?? []).map((x) => x.user_id);
    }
    await notify(ctx, {
      teamId: thread.team_id,
      kind: thread.kind === "event" ? "event_thread_reply" : "message_new",
      subject: thread.title ?? "New reply",
      body: messagePreview(body, image?.image_path ?? null, 240),
      refId: threadId,
      recipientUserIds,
      staffOnly: thread.audience === "staff",
      includePlayers: thread.audience === "both",
    });
    return { id: msg.id, created_at: msg.created_at };
  },

  async "delete-message"(ctx, p) {
    const messageId = uuid(p, "message_id");
    const { data: deleted, error } = await ctx.db
      .from("messages")
      .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.uid })
      .eq("id", messageId)
      .select("image_path");
    if (error) throw new ApiError("forbidden", "You can't delete this message.", 403);
    // A deleted photo is gone for good, not just hidden (D-036).
    const paths = (deleted ?? []).map((m) => m.image_path).filter(Boolean) as string[];
    if (paths.length > 0) await ctx.admin.storage.from(CHAT_PHOTOS_BUCKET).remove(paths);
    return { ok: true };
  },

  // ----- Calendar feed (D-036) ---------------------------------------------------
  async "calendar-feed"(ctx) {
    return await calendarFeedURL(ctx, false);
  },

  async "reset-calendar-feed"(ctx) {
    return await calendarFeedURL(ctx, true);
  },

  async "set-mute"(ctx, p) {
    const threadId = uuid(p, "thread_id");
    if (p.muted === true) {
      await ctx.db.from("thread_mutes").upsert({ thread_id: threadId, user_id: ctx.uid }, { onConflict: "thread_id,user_id" });
    } else {
      await ctx.db.from("thread_mutes").delete().eq("thread_id", threadId).eq("user_id", ctx.uid);
    }
    return { ok: true };
  },

  // ----- Announcements ---------------------------------------------------------
  async "create-announcement"(ctx, p) {
    const teamId = uuid(p, "team_id");
    const title = str(p, "title", { min: 1, max: 140 });
    const body = str(p, "body", { min: 1, max: 4000 });
    const { data, error } = await ctx.db
      .from("announcements")
      .insert({ team_id: teamId, title, body, created_by: ctx.uid })
      .select("id")
      .single();
    if (error || !data) throw new ApiError("forbidden", "Only the head coach can post announcements.", 403);
    await notify(ctx, { teamId, kind: "announcement", subject: title, body: body.slice(0, 240), refId: data.id, includePlayers: true });
    return { id: data.id };
  },

  // ----- Events ----------------------------------------------------------------
  async "save-event"(ctx, p) {
    const teamId = uuid(p, "team_id");
    const eventId = p.event_id ? uuid(p, "event_id") : null;
    const startsAt = isoDate(p, "starts_at")!;
    const endsAt = isoDate(p, "ends_at", true);
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) throw new ApiError("invalid_input", "End time must be after the start.");
    const eventType = oneOf(p, "event_type", ["practice", "game", "other"] as const, "practice");
    const homeAway = p.home_away ? oneOf(p, "home_away", ["home", "away"] as const) : null;
    const row = {
      team_id: teamId,
      title: str(p, "title", { min: 1, max: 140 }),
      event_type: eventType,
      starts_at: startsAt,
      ends_at: endsAt,
      location: str(p, "location", { max: 200, optional: true }) || null,
      location_address: str(p, "location_address", { max: 300, optional: true }) || null,
      notes: str(p, "notes", { max: 2000, optional: true }) || null,
      opponent: eventType === "game" ? str(p, "opponent", { max: 120, optional: true }) || null : null,
      home_away: eventType === "game" ? homeAway : null,
    };

    const tz = await eventTimeZone(ctx, teamId, p);

    if (eventId) {
      const { error } = await ctx.db.from("events").update(row).eq("id", eventId);
      if (error) throw new ApiError("forbidden", "Only the head coach can edit events.", 403);
      await notify(ctx, { teamId, kind: "event_updated", subject: `Updated: ${row.title}`, body: summarizeEvent(row, tz), refId: eventId, includePlayers: true });
      return { event_ids: [eventId] };
    }

    // Weekly repeats keep the same local start time across Daylight Saving (D-037).
    const repeatWeeks = int(p, "repeat_weeks", 0, 26, true) ?? 0;
    const startMs = new Date(startsAt).getTime();
    const durationMs = endsAt ? new Date(endsAt).getTime() - startMs : null;
    const rows = Array.from({ length: repeatWeeks + 1 }, (_, i) => {
      const s = new Date(addLocalDays(startMs, i * 7, tz));
      return {
        ...row,
        starts_at: s.toISOString(),
        ends_at: durationMs !== null ? new Date(s.getTime() + durationMs).toISOString() : null,
        rsvp_cutoff_at: new Date(s.getTime() - DEFAULT_CUTOFF_LEAD_MS).toISOString(),
        created_by: ctx.uid,
      };
    });
    const { data, error } = await ctx.db.from("events").insert(rows).select("id");
    if (error || !data) throw new ApiError("forbidden", "Only the head coach can create events.", 403);
    await notify(ctx, {
      teamId,
      kind: "event_created",
      subject: repeatWeeks > 0 ? `New: ${row.title} (weekly ×${repeatWeeks + 1})` : `New: ${row.title}`,
      body: summarizeEvent(row, tz),
      refId: data[0].id,
      includePlayers: true,
    });
    return { event_ids: data.map((d) => d.id) };
  },

  async "cancel-event"(ctx, p) {
    const eventId = uuid(p, "event_id");
    const { data: ev, error } = await ctx.db
      .from("events")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", eventId)
      .select("team_id, title, starts_at")
      .single();
    if (error || !ev) throw new ApiError("forbidden", "Only the head coach can cancel events.", 403);
    const tz = await eventTimeZone(ctx, ev.team_id, p);
    await notify(ctx, {
      teamId: ev.team_id,
      kind: "event_updated",
      subject: `Cancelled: ${ev.title}`,
      body: `${ev.title} on ${formatEventTime(ev.starts_at, tz)} has been cancelled.`,
      refId: eventId,
      includePlayers: true,
    });
    return { ok: true };
  },

  // Port of setRsvp — enforces the cutoff server-side.
  async "set-rsvp"(ctx, p) {
    const eventId = uuid(p, "event_id");
    const playerId = uuid(p, "player_id");
    const status = oneOf(p, "status", ["yes", "no", "maybe"] as const);
    const note = str(p, "note", { max: 280, optional: true }) || null;
    const { data: ev } = await ctx.db.from("events").select("starts_at, rsvp_cutoff_at, cancelled_at").eq("id", eventId).single();
    if (!ev) throw new ApiError("not_found", "Event not found.", 404);
    if (ev.cancelled_at) throw new ApiError("cancelled", "This event was cancelled.", 409);
    const cutoff = ev.rsvp_cutoff_at ? new Date(ev.rsvp_cutoff_at) : new Date(new Date(ev.starts_at).getTime() - DEFAULT_CUTOFF_LEAD_MS);
    if (cutoff < new Date()) throw new ApiError("rsvp_locked", "RSVPs are closed for this event. Message your coach instead.", 409);
    const { error } = await ctx.db
      .from("rsvps")
      .upsert({ event_id: eventId, player_id: playerId, status, note, responded_by: ctx.uid }, { onConflict: "event_id,player_id" });
    if (error) throw new ApiError("forbidden", "You can't RSVP for this player.", 403);
    return { ok: true };
  },

  // ----- Inbox (D-020) ----------------------------------------------------------
  async inbox(ctx) {
    const { data, error } = await ctx.admin
      .from("notification_sends")
      .select("id, link_path, read_at, created_at, notifications(kind, subject, body, team_id, ref_id)")
      .eq("recipient_user_id", ctx.uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new ApiError("internal", error.message, 500);
    return {
      items: (data ?? []).map((s) => {
        const n = s.notifications as unknown as { kind: string; subject: string; body: string; team_id: string; ref_id: string | null };
        return { id: s.id, link_path: s.link_path, read_at: s.read_at, created_at: s.created_at, ...n };
      }),
    };
  },

  async "mark-read"(ctx, p) {
    let q = ctx.admin.from("notification_sends").update({ read_at: new Date().toISOString() }).eq("recipient_user_id", ctx.uid).is("read_at", null);
    if (p.all !== true) q = q.eq("id", uuid(p, "id"));
    await q;
    return { ok: true };
  },

  // ----- Devices (D-012) ---------------------------------------------------------
  async "register-device"(ctx, p) {
    const token = str(p, "token", { min: 32, max: 200 });
    if (!/^[0-9a-f]+$/i.test(token)) throw new ApiError("invalid_input", "Bad device token");
    const environment = oneOf(p, "environment", ["sandbox", "production"] as const, "production");
    await ctx.admin
      .from("device_tokens")
      .upsert({ token, user_id: ctx.uid, environment, platform: "ios", updated_at: new Date().toISOString() }, { onConflict: "token" });
    return { ok: true };
  },

  async "unregister-device"(ctx, p) {
    await ctx.admin.from("device_tokens").delete().eq("token", str(p, "token")).eq("user_id", ctx.uid);
    return { ok: true };
  },

  // ----- Coach Pro (D-010) ----------------------------------------------------------
  async "sync-subscription"(ctx, p) {
    const jws = str(p, "signed_transaction", { min: 20, max: 20000 });
    const result = await syncFromDevice(ctx.admin, jws, ctx.uid);
    return { ...result, is_coach_pro: await isCoachPro(ctx) };
  },

  // ----- Dues (D-010, D-011) -----------------------------------------------------------
  async "list-dues"(ctx, p) {
    const teamId = uuid(p, "team_id");
    const { roles, isParent } = await requireMember(ctx, teamId);
    const isStaff = roles.some((r) => STAFF_ROLES.includes(r));
    const { data: requests } = await ctx.admin
      .from("dues_requests")
      .select("id, title, description, amount_cents, due_date, created_at, dues_items(id, player_id, amount_cents, status, paid_at)")
      .eq("team_id", teamId)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    let myPlayerIds = new Set<string>();
    if (!isStaff && isParent) {
      const { data: links } = await ctx.admin.from("parent_player_links").select("player_id").eq("parent_user_id", ctx.uid);
      myPlayerIds = new Set((links ?? []).map((l) => l.player_id));
    }
    const { data: players } = await ctx.admin.from("players").select("id, first_name, last_name").eq("team_id", teamId);
    const nameOf = Object.fromEntries((players ?? []).map((pl) => [pl.id, `${pl.first_name} ${pl.last_name}`]));
    const { data: account } = await ctx.admin.from("team_payment_accounts").select("charges_enabled").eq("team_id", teamId).maybeSingle();
    return {
      payments_enabled: account?.charges_enabled === true,
      payments_connected: !!account,
      fee: { percent_bps: 290, flat_cents: 79 },
      requests: (requests ?? [])
        .map((r) => ({
          ...r,
          items: ((r.dues_items as Array<Record<string, unknown>>) ?? [])
            .filter((i) => isStaff || myPlayerIds.has(i.player_id as string))
            .map((i) => ({ ...i, player_name: nameOf[i.player_id as string] ?? "Player" })),
          dues_items: undefined,
        }))
        .filter((r) => isStaff || r.items.length > 0),
    };
  },

  async "create-dues"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireHeadCoach(ctx, teamId);
    const title = str(p, "title", { min: 1, max: 120 });
    const description = str(p, "description", { max: 1000, optional: true }) || null;
    const amount = int(p, "amount_cents", 100, 500000)!;
    const dueDate = str(p, "due_date", { optional: true }) || null;
    const playerIds = Array.isArray(p.player_ids) ? (p.player_ids as string[]) : null;

    let q = ctx.admin.from("players").select("id").eq("team_id", teamId).is("archived_at", null);
    if (playerIds && playerIds.length > 0) q = q.in("id", playerIds);
    const { data: players } = await q;
    if (!players || players.length === 0) throw new ApiError("invalid_input", "Add players to the roster first.");

    const { data: request, error } = await ctx.admin
      .from("dues_requests")
      .insert({ team_id: teamId, title, description, amount_cents: amount, due_date: dueDate, created_by: ctx.uid })
      .select("id")
      .single();
    if (error || !request) throw new ApiError("internal", error?.message ?? "Could not create request", 500);
    await ctx.admin.from("dues_items").insert(players.map((pl) => ({ request_id: request.id, player_id: pl.id, amount_cents: amount })));

    const { data: parents } = await ctx.admin
      .from("parent_player_links")
      .select("parent_user_id")
      .in("player_id", players.map((pl) => pl.id));
    await notify(ctx, {
      teamId,
      kind: "announcement",
      subject: `Payment request: ${title}`,
      body: `$${(amount / 100).toFixed(2)} per player${dueDate ? ` · due ${dueDate}` : ""}. Pay in ClubHQ.`,
      refId: request.id,
      recipientUserIds: [...new Set((parents ?? []).map((x) => x.parent_user_id))],
    });
    return { request_id: request.id };
  },

  // Coach records a cash/Venmo payment or waives — keeps the ledger complete.
  async "set-dues-status"(ctx, p) {
    const itemId = uuid(p, "item_id");
    const status = oneOf(p, "status", ["unpaid", "paid", "waived"] as const);
    const { data: item } = await ctx.admin.from("dues_items").select("id, status, dues_requests!inner(team_id)").eq("id", itemId).single();
    if (!item) throw new ApiError("not_found", "Not found.", 404);
    await requireHeadCoach(ctx, (item.dues_requests as unknown as { team_id: string }).team_id);
    if (item.status === "processing") throw new ApiError("conflict", "A card payment is in progress for this item.", 409);
    await ctx.admin
      .from("dues_items")
      .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null, paid_by: status === "paid" ? ctx.uid : null, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    return { ok: true };
  },

  async "remind-unpaid"(ctx, p) {
    const requestId = uuid(p, "request_id");
    const { data: req } = await ctx.admin.from("dues_requests").select("id, team_id, title").eq("id", requestId).single();
    if (!req) throw new ApiError("not_found", "Not found.", 404);
    await requireHeadCoach(ctx, req.team_id);
    if (!(await teamIsPro(ctx, req.team_id))) throw new ApiError("upgrade_required", "Payment reminders are a Coach Pro feature.", 402);
    const { data: unpaid } = await ctx.admin.from("dues_items").select("player_id").eq("request_id", requestId).eq("status", "unpaid");
    if (!unpaid || unpaid.length === 0) return { reminded: 0 };
    const { data: parents } = await ctx.admin.from("parent_player_links").select("parent_user_id").in("player_id", unpaid.map((u) => u.player_id));
    const recipients = [...new Set((parents ?? []).map((x) => x.parent_user_id))];
    await notify(ctx, { teamId: req.team_id, kind: "announcement", subject: `Reminder: ${req.title}`, body: "You have an unpaid team payment. Tap to pay in ClubHQ.", refId: requestId, recipientUserIds: recipients });
    return { reminded: recipients.length };
  },

  async "connect-payments"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireHeadCoach(ctx, teamId);
    const returnUrl = Deno.env.get("PAYMENTS_RETURN_URL") ?? "https://teamclubhq.com/payments/return";
    let { data: account } = await ctx.admin.from("team_payment_accounts").select("stripe_account_id").eq("team_id", teamId).maybeSingle();
    if (!account) {
      const created = await stripe<{ id: string }>("POST", "/accounts", {
        type: "express",
        country: "US",
        email: ctx.email,
        "capabilities[card_payments][requested]": true,
        "capabilities[transfers][requested]": true,
        "business_profile[product_description]": "Youth sports team dues collected via ClubHQ",
        "metadata[team_id]": teamId,
      });
      await ctx.admin.from("team_payment_accounts").insert({ team_id: teamId, stripe_account_id: created.id, created_by: ctx.uid });
      account = { stripe_account_id: created.id };
    }
    const link = await stripe<{ url: string }>("POST", "/account_links", {
      account: account.stripe_account_id,
      refresh_url: `${returnUrl}?refresh=1`,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url };
  },

  async "refresh-payments"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await requireStaff(ctx, teamId);
    const { data: account } = await ctx.admin.from("team_payment_accounts").select("stripe_account_id").eq("team_id", teamId).maybeSingle();
    if (!account) return { payments_enabled: false, payments_connected: false };
    const acct = await stripe<{ charges_enabled: boolean; payouts_enabled: boolean }>("GET", `/accounts/${account.stripe_account_id}`);
    await ctx.admin.from("team_payment_accounts").update({ charges_enabled: acct.charges_enabled, payouts_enabled: acct.payouts_enabled, updated_at: new Date().toISOString() }).eq("team_id", teamId);
    return { payments_enabled: acct.charges_enabled, payments_connected: true };
  },

  async checkout(ctx, p) {
    const itemIds = Array.isArray(p.item_ids) ? (p.item_ids as string[]).slice(0, 20) : [];
    if (itemIds.length === 0) throw new ApiError("invalid_input", "Choose something to pay.");
    const { data: items } = await ctx.admin
      .from("dues_items")
      .select("id, player_id, amount_cents, status, dues_requests!inner(team_id, title), players!inner(first_name)")
      .in("id", itemIds);
    if (!items || items.length !== itemIds.length) throw new ApiError("not_found", "Some items were not found.", 404);
    const teamIds = new Set(items.map((i) => (i.dues_requests as unknown as { team_id: string }).team_id));
    if (teamIds.size !== 1) throw new ApiError("invalid_input", "Pay one team at a time.");
    const teamId = [...teamIds][0];
    const { data: links } = await ctx.admin.from("parent_player_links").select("player_id").eq("parent_user_id", ctx.uid);
    const mine = new Set((links ?? []).map((l) => l.player_id));
    if (!items.every((i) => mine.has(i.player_id))) throw new ApiError("forbidden", "You can only pay for your own players.", 403);
    if (!items.every((i) => i.status === "unpaid")) throw new ApiError("conflict", "Some of these are already paid or in progress.", 409);

    const { data: account } = await ctx.admin.from("team_payment_accounts").select("stripe_account_id, charges_enabled").eq("team_id", teamId).maybeSingle();
    if (!account?.charges_enabled) throw new ApiError("payments_disabled", "Your coach hasn't turned on card payments yet.", 409);

    const subtotal = items.reduce((s, i) => s + i.amount_cents, 0);
    const fee = checkoutFeeCents(subtotal);
    const returnUrl = Deno.env.get("PAYMENTS_RETURN_URL") ?? "https://teamclubhq.com/payments/return";
    const params: Record<string, string | number> = {
      mode: "payment",
      client_reference_id: ctx.uid,
      customer_email: ctx.email,
      success_url: `${returnUrl}?status=success`,
      cancel_url: `${returnUrl}?status=cancelled`,
      "metadata[item_ids]": itemIds.join(","),
      "metadata[team_id]": teamId,
      "payment_intent_data[application_fee_amount]": fee,
      "payment_intent_data[transfer_data][destination]": account.stripe_account_id,
      "payment_intent_data[metadata][item_ids]": itemIds.join(","),
    };
    items.forEach((i, idx) => {
      const req = i.dues_requests as unknown as { title: string };
      const pl = i.players as unknown as { first_name: string };
      params[`line_items[${idx}][quantity]`] = 1;
      params[`line_items[${idx}][price_data][currency]`] = "usd";
      params[`line_items[${idx}][price_data][unit_amount]`] = i.amount_cents;
      params[`line_items[${idx}][price_data][product_data][name]`] = `${req.title} — ${pl.first_name}`;
    });
    // Fee shown as its own line so families see exactly what it is (research §5 #5).
    params[`line_items[${items.length}][quantity]`] = 1;
    params[`line_items[${items.length}][price_data][currency]`] = "usd";
    params[`line_items[${items.length}][price_data][unit_amount]`] = fee;
    params[`line_items[${items.length}][price_data][product_data][name]`] = "ClubHQ service fee (2.9% + $0.79)";

    const session = await stripe<{ id: string; url: string }>("POST", "/checkout/sessions", params);
    await ctx.admin.from("dues_items").update({ status: "processing", stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).in("id", itemIds);
    return { url: session.url, subtotal_cents: subtotal, fee_cents: fee, total_cents: subtotal + fee };
  },

  // ----- Account deletion (D-014) ---------------------------------------------------------
  async "delete-account"(ctx) {
    // Teams where this user is the ONLY head coach get archived (not deleted) so other
    // families keep their history; staff can be re-assigned by support.
    const { data: hc } = await ctx.admin.from("user_roles").select("team_id").eq("user_id", ctx.uid).eq("role", "head_coach");
    for (const r of hc ?? []) {
      const { count } = await ctx.admin.from("user_roles").select("id", { count: "exact", head: true }).eq("team_id", r.team_id).eq("role", "head_coach");
      if ((count ?? 0) <= 1) await ctx.admin.from("teams").update({ archived_at: new Date().toISOString() }).eq("id", r.team_id);
    }
    await Promise.all([
      ctx.admin.from("device_tokens").delete().eq("user_id", ctx.uid),
      ctx.admin.from("user_roles").delete().eq("user_id", ctx.uid),
      ctx.admin.from("parent_player_links").delete().eq("parent_user_id", ctx.uid),
      ctx.admin.from("players").update({ user_id: null }).eq("user_id", ctx.uid),
      ctx.admin.from("thread_participants").delete().eq("user_id", ctx.uid),
      ctx.admin.from("thread_mutes").delete().eq("user_id", ctx.uid),
      ctx.admin.from("message_reads").delete().eq("user_id", ctx.uid),
      ctx.admin.from("calendar_feeds").delete().eq("user_id", ctx.uid),
    ]);
    const { error } = await ctx.admin.auth.admin.deleteUser(ctx.uid);
    if (error) {
      // Foreign keys (e.g. authored messages) can block a hard delete. Scrub instead:
      // no email, no name, banned — personal data is gone, history shows "Deleted user".
      await ctx.admin.auth.admin.updateUserById(ctx.uid, {
        email: `deleted+${ctx.uid}@users.clubhq.invalid`,
        user_metadata: {},
        ban_duration: "876000h",
      });
      await ctx.admin.from("profiles").update({ full_name: "Deleted user", phone: null, avatar_url: null }).eq("id", ctx.uid);
    }
    return { ok: true };
  },
};

/** Thread list / push text for a message; photo-only messages read "📷 Photo". */
function messagePreview(body: string, imagePath: string | null, max: number): string {
  const text = body.trim();
  if (!imagePath) return text.slice(0, max);
  return text ? `📷 ${text}`.slice(0, max) : "📷 Photo";
}

function summarizeEvent(row: { starts_at: string; location: string | null; opponent?: string | null }, tz: string | null): string {
  return [row.opponent ? `vs ${row.opponent}` : null, formatEventTime(row.starts_at, tz), row.location].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: { code: "method_not_allowed", message: "POST only" } }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) throw new ApiError("unauthorized", "Please sign in again.", 401);
    const admin = adminClient();
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) throw new ApiError("unauthorized", "Please sign in again.", 401);

    const body = (await req.json().catch(() => ({}))) as Params;
    const action = typeof body.action === "string" ? body.action : "";
    const handler = actions[action];
    if (!handler) throw new ApiError("unknown_action", `Unknown action "${action}"`, 404);

    const ctx: Ctx = { uid: userData.user.id, email: userData.user.email ?? "", admin, db: userClient(authHeader) };
    return json(await handler(ctx, body));
  } catch (e) {
    return errorResponse(e);
  }
});
