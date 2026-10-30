// ClubHQ admin portal write API (DECISIONS D-041, docs/ADMIN_PORTAL.md).
//
// One POST endpoint: { "action": "<name>", ...params }. Every action:
//   1. authenticates the caller's Supabase JWT,
//   2. requires an active platform admin on an MFA-verified (AAL2) session, checked by the
//      database itself (admin_whoami under the caller's JWT), plus owner-only where noted,
//   3. applies the change with the service role,
//   4. writes an audit_logs row (actor, action, target, before/after).
// Reads don't live here: the portal calls the admin_* SQL functions directly. Nothing here
// reads chat content except the photo attached to a report.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { adminClient, ApiError, corsHeaders, errorResponse, json, shortCode, userClient } from "../_shared/http.ts";
import { deleteUserAccount } from "../_shared/accounts.ts";
import { alertAdmins } from "../_shared/adminAlerts.ts";
import { sendApns } from "../_shared/apns.ts";
import { webPushConfigured } from "../_shared/webpush.ts";

type Params = Record<string, unknown>;
interface Ctx {
  uid: string;
  email: string;
  role: "owner" | "support";
  admin: SupabaseClient; // service role
  db: SupabaseClient; // the admin's own JWT (admin_* functions)
}

const DAY_MS = 24 * 3600_000;
const DELETION_GRACE_DAYS = 7;
const SUPPORT_MAX_GRANT_DAYS = 90;
const TEAM_CODE_LIFETIME_MS = 365 * DAY_MS;
const SUSPEND_BAN = "876000h"; // ~100 years; "none" lifts it
const REPORT_EVIDENCE_BUCKET = "report-evidence";
const CHAT_PHOTOS_BUCKET = "chat-photos";
const ALERT_TYPES = ["report", "team", "subscription", "account"];
const SEGMENT_KINDS = ["all", "coaches", "head_coaches", "parents", "players", "pro_coaches", "team", "org"];

// ----- Parameter helpers -------------------------------------------------------------
function str(p: Params, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const v = p[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    throw new ApiError("invalid_input", `${key} is required.`);
  }
  if (typeof v !== "string") throw new ApiError("invalid_input", `${key} must be text.`);
  const t = v.trim();
  if (t.length < (opts.min ?? 0) || t.length > (opts.max ?? 10_000)) throw new ApiError("invalid_input", `${key} has the wrong length.`);
  return t;
}
function uuid(p: Params, key: string): string {
  const v = p[key];
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new ApiError("invalid_input", `${key} must be an id.`);
  }
  return v.toLowerCase();
}
function oneOf<T extends string>(p: Params, key: string, values: readonly T[]): T {
  const v = p[key];
  if (typeof v !== "string" || !values.includes(v as T)) throw new ApiError("invalid_input", `${key} must be one of ${values.join(", ")}.`);
  return v as T;
}
function requireOwner(ctx: Ctx) {
  if (ctx.role !== "owner") throw new ApiError("owner_only", "Only the owner can do that.", 403);
}

// ----- Shared steps ------------------------------------------------------------------
async function audit(ctx: Ctx, action: string, target: { table: string; id?: string | null; teamId?: string | null }, metadata: Record<string, unknown> = {}) {
  const { error } = await ctx.admin.from("audit_logs").insert({
    actor_user_id: ctx.uid,
    action: `admin.${action}`,
    target_table: target.table,
    target_id: target.id ?? null,
    team_id: target.teamId ?? null,
    metadata,
  });
  // An unaudited admin write is not acceptable; surface it.
  if (error) throw new ApiError("internal", `Audit log failed: ${error.message}`, 500);
}

async function getUser(ctx: Ctx, userId: string) {
  const { data, error } = await ctx.admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new ApiError("not_found", "That person no longer exists.", 404);
  return data.user;
}

async function getTeam(ctx: Ctx, teamId: string) {
  const { data } = await ctx.admin.from("teams").select("id, name, org_id, archived_at").eq("id", teamId).maybeSingle();
  if (!data) throw new ApiError("not_found", "Team not found.", 404);
  return data;
}

/** APNs to every device of these users. Reports whether push is configured at all (OQ-04). */
async function pushToUsers(ctx: Ctx, userIds: string[], title: string, body: string) {
  if (userIds.length === 0) return { configured: Boolean(Deno.env.get("APNS_PRIVATE_KEY")), devices: 0, delivered: 0 };
  const devices: Array<{ token: string; environment: "sandbox" | "production" }> = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await ctx.admin.from("device_tokens").select("token, environment").in("user_id", userIds.slice(i, i + 200));
    devices.push(...(data ?? []));
  }
  if (!Deno.env.get("APNS_PRIVATE_KEY")) return { configured: false, devices: devices.length, delivered: 0 };
  let delivered = 0;
  const gone: string[] = [];
  for (let i = 0; i < devices.length; i += 50) {
    await Promise.all(devices.slice(i, i + 50).map(async (d) => {
      const result = await sendApns(d.token, d.environment, { title, body, linkPath: "/notifications" });
      if (result === "ok") delivered++;
      if (result === "gone") gone.push(d.token);
    }));
  }
  if (gone.length > 0) await ctx.admin.from("device_tokens").delete().in("token", gone);
  return { configured: true, devices: devices.length, delivered };
}

async function setSuspended(ctx: Ctx, userId: string, reason: string | null) {
  const { data: before } = await ctx.admin.from("profiles").select("suspended_at, suspended_reason").eq("id", userId).maybeSingle();
  const suspend = reason !== null;
  const { error } = await ctx.admin.from("profiles").upsert({
    id: userId,
    suspended_at: suspend ? new Date().toISOString() : null,
    suspended_reason: reason,
  });
  if (error) throw new ApiError("internal", error.message, 500);
  // The auth ban stops token refreshes; mobile-api refuses requests from suspended accounts.
  const { error: banErr } = await ctx.admin.auth.admin.updateUserById(userId, { ban_duration: suspend ? SUSPEND_BAN : "none" });
  if (banErr) throw new ApiError("internal", banErr.message, 500);
  return before;
}

/** Runs one scheduled deletion now. Returns false if it was cancelled or already done. */
async function completeDeletion(ctx: Ctx, userId: string): Promise<boolean> {
  const { data: d } = await ctx.admin.from("account_deletions").select("*").eq("user_id", userId).maybeSingle();
  if (!d || d.completed_at || d.cancelled_at) return false;
  const outcome = await deleteUserAccount(ctx.admin, userId);
  await ctx.admin.from("account_deletions").update({ completed_at: new Date().toISOString(), email: null }).eq("user_id", userId);
  await audit(ctx, "account.deletion_completed", { table: "auth.users", id: userId }, { outcome, legal: d.legal });
  return true;
}

async function claimRole(ctx: Ctx, userId: string, role: string, teamId: string) {
  const { data } = await ctx.admin.from("user_roles").select("id").eq("user_id", userId).eq("role", role).eq("team_id", teamId).maybeSingle();
  if (!data) await ctx.admin.from("user_roles").insert({ user_id: userId, role, team_id: teamId });
}

// ----- Actions -----------------------------------------------------------------------
const actions: Record<string, (ctx: Ctx, p: Params) => Promise<unknown>> = {
  async config(ctx) {
    return {
      role: ctx.role,
      email: ctx.email,
      vapid_public_key: Deno.env.get("VAPID_PUBLIC_KEY") ?? null,
      web_push_configured: webPushConfigured(),
      apns_configured: Boolean(Deno.env.get("APNS_PRIVATE_KEY")),
    };
  },

  // ----- Teams -------------------------------------------------------------------------
  /** New clubs wait for approval (D-051). Turns on the club's director powers and tells its directors. */
  async "approve-club"(ctx, p) {
    const orgId = uuid(p, "org_id");
    const { data: org } = await ctx.admin.from("organizations").select("id, name, type, club_approved_at").eq("id", orgId).maybeSingle();
    if (!org || org.type !== "club") throw new ApiError("not_found", "That club wasn't found.", 404);
    if (org.club_approved_at) return { ok: true, already: true };
    const { error } = await ctx.admin.from("organizations").update({ club_approved_at: new Date().toISOString(), club_approved_by: ctx.uid }).eq("id", orgId);
    if (error) throw new ApiError("internal", error.message, 500);
    const { data: directors } = await ctx.admin.from("user_roles").select("user_id").eq("org_id", orgId).is("team_id", null).eq("role", "program_director");
    const push = await pushToUsers(ctx, [...new Set((directors ?? []).map((d) => d.user_id))], `${org.name} is approved`,
      "Your club is on. Open the Club tab to add teams and invite coaches.");
    await audit(ctx, "club.approve", { table: "organizations", id: orgId }, { name: org.name, push });
    return { ok: true, push };
  },

  async "update-team"(ctx, p) {
    const teamId = uuid(p, "team_id");
    const name = str(p, "name", { min: 1, max: 120 });
    const team = await getTeam(ctx, teamId);
    const { error } = await ctx.admin.from("teams").update({ name, updated_at: new Date().toISOString() }).eq("id", teamId);
    if (error) throw new ApiError("internal", error.message, 500);
    await audit(ctx, "team.rename", { table: "teams", id: teamId, teamId }, { before: { name: team.name }, after: { name } });
    return { ok: true };
  },

  async "set-team-archived"(ctx, p) {
    const teamId = uuid(p, "team_id");
    const archived = p.archived === true;
    const team = await getTeam(ctx, teamId);
    const archivedAt = archived ? new Date().toISOString() : null;
    // A team its coach or club deleted (D-046) can only come back within 30 days.
    const { data: del } = await ctx.admin.from("teams").select("deleted_at").eq("id", teamId).single();
    if (!archived && del?.deleted_at && Date.now() - new Date(del.deleted_at).getTime() > 30 * 24 * 3600_000) {
      throw new ApiError("expired", "This team was deleted more than 30 days ago and can't be restored.", 410);
    }
    const update = archived ? { archived_at: archivedAt } : { archived_at: null, deleted_at: null, deleted_by: null };
    const { error } = await ctx.admin.from("teams").update(update).eq("id", teamId);
    if (error) throw new ApiError("internal", error.message, 500);
    await audit(ctx, archived ? "team.archive" : "team.restore", { table: "teams", id: teamId, teamId },
      { before: { archived_at: team.archived_at }, after: { archived_at: archivedAt }, note: str(p, "note", { max: 500, optional: true }) || null });
    return { ok: true };
  },

  // Same effect as the head coach's Reset Code (D-036): old link and code stop working.
  async "reset-team-code"(ctx, p) {
    const teamId = uuid(p, "team_id");
    await getTeam(ctx, teamId);
    await ctx.admin.from("team_invites").update({ revoked_at: new Date().toISOString() })
      .eq("team_id", teamId).is("player_id", null).is("revoked_at", null);
    const { data, error } = await ctx.admin.from("team_invites")
      .insert({ team_id: teamId, token: shortCode(10), created_by: ctx.uid, expires_at: new Date(Date.now() + TEAM_CODE_LIFETIME_MS).toISOString() })
      .select("token, expires_at").single();
    if (error || !data) throw new ApiError("internal", error?.message ?? "Could not create a code.", 500);
    await audit(ctx, "team.reset_code", { table: "teams", id: teamId, teamId });
    return data;
  },

  // Moves a child to another team: future RSVPs on the old team are dropped, guardians (and the
  // player's own login) gain access to the new team and lose the old one if no other kid keeps it.
  async "move-player"(ctx, p) {
    const playerId = uuid(p, "player_id");
    const toTeamId = uuid(p, "to_team_id");
    const { data: player } = await ctx.admin.from("players").select("id, team_id, user_id, first_name, last_name, archived_at").eq("id", playerId).maybeSingle();
    if (!player || player.archived_at) throw new ApiError("not_found", "Player not found.", 404);
    if (player.team_id === toTeamId) throw new ApiError("invalid_input", "The player is already on that team.");
    const target = await getTeam(ctx, toTeamId);
    if (target.archived_at) throw new ApiError("invalid_input", "That team is archived.");
    const fromTeamId = player.team_id as string;

    const { error } = await ctx.admin.from("players").update({ team_id: toTeamId, updated_at: new Date().toISOString() }).eq("id", playerId);
    if (error) throw new ApiError("internal", error.message, 500);
    const { data: futureEvents } = await ctx.admin.from("events").select("id").eq("team_id", fromTeamId).gt("starts_at", new Date().toISOString());
    const eventIds = (futureEvents ?? []).map((e) => e.id);
    if (eventIds.length > 0) await ctx.admin.from("rsvps").delete().eq("player_id", playerId).in("event_id", eventIds);

    const { data: links } = await ctx.admin.from("parent_player_links").select("parent_user_id").eq("player_id", playerId);
    const people = [
      ...(links ?? []).map((l) => ({ userId: l.parent_user_id as string, role: "parent" })),
      ...(player.user_id ? [{ userId: player.user_id as string, role: "player" }] : []),
    ];
    for (const person of people) {
      await claimRole(ctx, person.userId, person.role, toTeamId);
      // Keep the old-team role only if another of their kids (or their own roster row) is still there.
      const stillThere = person.role === "parent"
        ? (await ctx.admin.from("parent_player_links").select("players!inner(id)").eq("parent_user_id", person.userId)
            .eq("players.team_id", fromTeamId).is("players.archived_at", null)).data?.length
        : 0;
      if (!stillThere) await ctx.admin.from("user_roles").delete().eq("user_id", person.userId).eq("role", person.role).eq("team_id", fromTeamId);
    }
    await audit(ctx, "player.move", { table: "players", id: playerId, teamId: fromTeamId },
      { player: `${player.first_name} ${player.last_name}`, before: { team_id: fromTeamId }, after: { team_id: toTeamId }, rsvps_dropped: eventIds.length });
    return { ok: true };
  },

  // ----- People ------------------------------------------------------------------------
  async "update-user"(ctx, p) {
    const userId = uuid(p, "user_id");
    const fullName = str(p, "full_name", { min: 1, max: 120 });
    await getUser(ctx, userId);
    const { data: before } = await ctx.admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const { error } = await ctx.admin.from("profiles").upsert({ id: userId, full_name: fullName });
    if (error) throw new ApiError("internal", error.message, 500);
    await audit(ctx, "user.rename", { table: "auth.users", id: userId }, { before, after: { full_name: fullName } });
    return { ok: true };
  },

  // Emails the person a 6-digit reset code (D-029); they finish in the app.
  async "send-password-reset"(ctx, p) {
    const userId = uuid(p, "user_id");
    const user = await getUser(ctx, userId);
    if (!user.email || user.email.endsWith(".invalid")) throw new ApiError("invalid_input", "This account has no email address.");
    const { error } = await ctx.admin.auth.resetPasswordForEmail(user.email);
    if (error) throw new ApiError("internal", error.message, 500);
    await audit(ctx, "user.password_reset_sent", { table: "auth.users", id: userId });
    return { ok: true, email: user.email };
  },

  async "suspend-user"(ctx, p) {
    const userId = uuid(p, "user_id");
    const reason = str(p, "reason", { min: 1, max: 500 });
    if (userId === ctx.uid) throw new ApiError("invalid_input", "You can't suspend yourself.");
    await getUser(ctx, userId);
    const before = await setSuspended(ctx, userId, reason);
    await audit(ctx, "user.suspend", { table: "auth.users", id: userId }, { before, after: { reason } });
    return { ok: true };
  },

  async "unsuspend-user"(ctx, p) {
    const userId = uuid(p, "user_id");
    await getUser(ctx, userId);
    const { data: pending } = await ctx.admin.from("account_deletions").select("user_id")
      .eq("user_id", userId).is("completed_at", null).is("cancelled_at", null).maybeSingle();
    if (pending) throw new ApiError("invalid_input", "Cancel the scheduled deletion first.");
    const before = await setSuspended(ctx, userId, null);
    await audit(ctx, "user.unsuspend", { table: "auth.users", id: userId }, { before, note: str(p, "note", { max: 500, optional: true }) || null });
    return { ok: true };
  },

  async "warn-user"(ctx, p) {
    const userId = uuid(p, "user_id");
    const message = str(p, "message", { min: 1, max: 300 });
    const user = await getUser(ctx, userId);
    const push = await pushToUsers(ctx, [userId], "A message from ClubHQ", message);
    await audit(ctx, "user.warn", { table: "auth.users", id: userId }, { message, push });
    return { ...push, email: user.email };
  },

  // Suspends now; the data is deleted after the grace period unless cancelled (D-041).
  async "schedule-deletion"(ctx, p) {
    const userId = uuid(p, "user_id");
    const reason = str(p, "reason", { min: 1, max: 500 });
    if (userId === ctx.uid) throw new ApiError("invalid_input", "You can't delete your own admin account here.");
    const user = await getUser(ctx, userId);
    const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * DAY_MS).toISOString();
    const { error } = await ctx.admin.from("account_deletions").upsert({
      user_id: userId, email: user.email, reason, legal: false, requested_by: ctx.uid,
      scheduled_for: scheduledFor, cancelled_at: null, completed_at: null, created_at: new Date().toISOString(),
    });
    if (error) throw new ApiError("internal", error.message, 500);
    await setSuspended(ctx, userId, `Scheduled for deletion: ${reason}`);
    await audit(ctx, "account.deletion_scheduled", { table: "auth.users", id: userId }, { reason, scheduled_for: scheduledFor });
    return { ok: true, scheduled_for: scheduledFor };
  },

  async "cancel-deletion"(ctx, p) {
    const userId = uuid(p, "user_id");
    const { data } = await ctx.admin.from("account_deletions").update({ cancelled_at: new Date().toISOString() })
      .eq("user_id", userId).is("completed_at", null).is("cancelled_at", null).select("user_id");
    if (!data?.length) throw new ApiError("not_found", "No pending deletion for this account.", 404);
    await setSuspended(ctx, userId, null);
    await audit(ctx, "account.deletion_cancelled", { table: "auth.users", id: userId });
    return { ok: true };
  },

  // Owner-only, for legal requests: no grace period.
  async "delete-user-now"(ctx, p) {
    requireOwner(ctx);
    const userId = uuid(p, "user_id");
    const reason = str(p, "reason", { min: 1, max: 500 });
    if (userId === ctx.uid) throw new ApiError("invalid_input", "You can't delete your own admin account here.");
    const user = await getUser(ctx, userId);
    await ctx.admin.from("account_deletions").upsert({
      user_id: userId, email: user.email, reason, legal: true, requested_by: ctx.uid,
      scheduled_for: new Date().toISOString(), cancelled_at: null, completed_at: null,
    });
    await audit(ctx, "account.deletion_immediate", { table: "auth.users", id: userId }, { reason });
    await completeDeletion(ctx, userId);
    return { ok: true };
  },

  async "process-deletions"(ctx) {
    const { data: due } = await ctx.admin.from("account_deletions").select("user_id")
      .is("completed_at", null).is("cancelled_at", null).lte("scheduled_for", new Date().toISOString()).limit(25);
    let completed = 0;
    for (const d of due ?? []) if (await completeDeletion(ctx, d.user_id)) completed++;
    return { completed };
  },

  // Owner-only: folds a duplicate account into the one the person keeps, then deletes the duplicate.
  async "merge-users"(ctx, p) {
    requireOwner(ctx);
    const sourceId = uuid(p, "source_id");
    const targetId = uuid(p, "target_id");
    if (sourceId === targetId) throw new ApiError("invalid_input", "Pick two different accounts.");
    const [source, target] = [await getUser(ctx, sourceId), await getUser(ctx, targetId)];
    if (target.email?.endsWith(".invalid")) throw new ApiError("invalid_input", "The account to keep has been deleted.");
    const moved: Record<string, number> = {};

    const { data: roles } = await ctx.admin.from("user_roles").select("id, role, team_id, org_id").eq("user_id", sourceId);
    const { data: targetRoles } = await ctx.admin.from("user_roles").select("role, team_id, org_id").eq("user_id", targetId);
    const key = (r: { role: string; team_id: string | null; org_id: string | null }) => `${r.role}|${r.team_id}|${r.org_id}`;
    const have = new Set((targetRoles ?? []).map(key));
    const roleIds = (roles ?? []).filter((r) => !have.has(key(r))).map((r) => r.id);
    if (roleIds.length) await ctx.admin.from("user_roles").update({ user_id: targetId }).in("id", roleIds);
    moved.roles = roleIds.length;

    const { data: links } = await ctx.admin.from("parent_player_links").select("id, player_id").eq("parent_user_id", sourceId);
    const { data: targetLinks } = await ctx.admin.from("parent_player_links").select("player_id").eq("parent_user_id", targetId);
    const kids = new Set((targetLinks ?? []).map((l) => l.player_id));
    const linkIds = (links ?? []).filter((l) => !kids.has(l.player_id)).map((l) => l.id);
    if (linkIds.length) await ctx.admin.from("parent_player_links").update({ parent_user_id: targetId }).in("id", linkIds);
    moved.children = linkIds.length;

    const { data: selfRows } = await ctx.admin.from("players").select("id, team_id").eq("user_id", sourceId);
    const { data: targetSelf } = await ctx.admin.from("players").select("team_id").eq("user_id", targetId);
    const selfTeams = new Set((targetSelf ?? []).map((r) => r.team_id));
    const selfIds = (selfRows ?? []).filter((r) => !selfTeams.has(r.team_id)).map((r) => r.id);
    if (selfIds.length) await ctx.admin.from("players").update({ user_id: targetId }).in("id", selfIds);

    const { data: parts } = await ctx.admin.from("thread_participants").select("id, thread_id").eq("user_id", sourceId);
    const { data: targetParts } = await ctx.admin.from("thread_participants").select("thread_id").eq("user_id", targetId);
    const threads = new Set((targetParts ?? []).map((t) => t.thread_id));
    const partIds = (parts ?? []).filter((t) => !threads.has(t.thread_id)).map((t) => t.id);
    if (partIds.length) await ctx.admin.from("thread_participants").update({ user_id: targetId }).in("id", partIds);

    const { count: messages } = await ctx.admin.from("messages").update({ author_id: targetId }, { count: "exact" }).eq("author_id", sourceId);
    moved.messages = messages ?? 0;
    await ctx.admin.from("app_store_subscriptions").update({ user_id: targetId }).eq("user_id", sourceId);
    await ctx.admin.from("pro_grants").update({ user_id: targetId }).eq("user_id", sourceId);
    await ctx.admin.from("content_reports").update({ reporter_id: targetId }).eq("reporter_id", sourceId);
    await ctx.admin.from("content_reports").update({ author_id: targetId }).eq("author_id", sourceId);

    const outcome = await deleteUserAccount(ctx.admin, sourceId);
    await audit(ctx, "account.merge", { table: "auth.users", id: targetId },
      { source_id: sourceId, source_email: source.email, target_email: target.email, moved, source_outcome: outcome });
    return { ok: true, moved };
  },

  // ----- Pro grants --------------------------------------------------------------------
  async "grant-pro"(ctx, p) {
    const targetType = oneOf(p, "target_type", ["user", "team", "org"] as const);
    const targetId = uuid(p, "target_id");
    const reason = str(p, "reason", { min: 1, max: 200 });
    const expiresAt = typeof p.expires_at === "string" && p.expires_at ? new Date(p.expires_at) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
      throw new ApiError("invalid_input", "The end date must be in the future.");
    }
    if (ctx.role !== "owner") {
      if (targetType === "org") throw new ApiError("owner_only", "Only the owner can grant Pro to a whole club.", 403);
      if (!expiresAt || expiresAt.getTime() > Date.now() + SUPPORT_MAX_GRANT_DAYS * DAY_MS) {
        throw new ApiError("owner_only", `Support can grant up to ${SUPPORT_MAX_GRANT_DAYS} days.`, 403);
      }
    }
    if (targetType === "user") await getUser(ctx, targetId);
    if (targetType === "team") await getTeam(ctx, targetId);
    if (targetType === "org") {
      const { data } = await ctx.admin.from("organizations").select("id").eq("id", targetId).maybeSingle();
      if (!data) throw new ApiError("not_found", "Club not found.", 404);
    }
    const { data: grant, error } = await ctx.admin.from("pro_grants").insert({
      [`${targetType}_id`]: targetId, reason, expires_at: expiresAt?.toISOString() ?? null, created_by: ctx.uid,
    }).select("*").single();
    if (error || !grant) throw new ApiError("internal", error?.message ?? "Could not create the grant.", 500);
    await audit(ctx, "pro.grant", { table: "pro_grants", id: grant.id, teamId: targetType === "team" ? targetId : null },
      { target_type: targetType, target_id: targetId, reason, expires_at: grant.expires_at });
    return { grant };
  },

  async "revoke-grant"(ctx, p) {
    const grantId = uuid(p, "grant_id");
    const { data: grant } = await ctx.admin.from("pro_grants").update({ revoked_at: new Date().toISOString() })
      .eq("id", grantId).is("revoked_at", null).select("*").maybeSingle();
    if (!grant) throw new ApiError("not_found", "That grant is already revoked or doesn't exist.", 404);
    await audit(ctx, "pro.revoke", { table: "pro_grants", id: grantId, teamId: grant.team_id }, { reason: grant.reason });
    return { ok: true };
  },

  // ----- Moderation --------------------------------------------------------------------
  async "resolve-report"(ctx, p) {
    const reportId = uuid(p, "report_id");
    const resolution = oneOf(p, "resolution", ["removed", "warned", "suspended", "dismissed"] as const);
    const note = str(p, "note", { max: 1000, optional: true }) || null;
    const { data: report } = await ctx.admin.from("content_reports").select("*").eq("id", reportId).maybeSingle();
    if (!report) throw new ApiError("not_found", "Report not found.", 404);
    if (report.status !== "open") throw new ApiError("invalid_input", "This report has already been resolved.");
    const effects: Record<string, unknown> = {};

    if ((resolution === "removed" || resolution === "suspended") && report.message_id) {
      // Remove for everyone, the same way a head coach deletes a message (D-036): photos are gone for good.
      const { data: removed } = await ctx.admin.from("messages")
        .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.uid })
        .eq("id", report.message_id).is("deleted_at", null).select("image_path");
      const paths = (removed ?? []).map((m) => m.image_path).filter(Boolean) as string[];
      if (paths.length) await ctx.admin.storage.from(CHAT_PHOTOS_BUCKET).remove(paths);
      effects.message_removed = (removed ?? []).length > 0;
    }
    if (resolution === "warned" || resolution === "removed") {
      const message = str(p, "warn_message", { max: 300, optional: true });
      if (message && report.author_id) effects.warning = await pushToUsers(ctx, [report.author_id], "A message from ClubHQ", message);
    }
    if (resolution === "suspended") {
      if (!report.author_id) throw new ApiError("invalid_input", "This report has no author to suspend.");
      await setSuspended(ctx, report.author_id, note ?? "Community guidelines violation");
      effects.suspended = report.author_id;
    }
    const { error } = await ctx.admin.from("content_reports").update({
      status: resolution === "dismissed" ? "dismissed" : "actioned",
      resolution, resolution_note: note, resolved_by: ctx.uid, resolved_at: new Date().toISOString(),
    }).eq("id", reportId);
    if (error) throw new ApiError("internal", error.message, 500);
    await audit(ctx, `report.${resolution}`, { table: "content_reports", id: reportId, teamId: report.team_id },
      { author_id: report.author_id, note, effects, age_hours: Math.round((Date.now() - Date.parse(report.created_at)) / 3600_000) });
    return { ok: true, effects };
  },

  async "report-photo"(ctx, p) {
    const reportId = uuid(p, "report_id");
    const { data: report } = await ctx.admin.from("content_reports").select("snapshot_image_path, team_id").eq("id", reportId).maybeSingle();
    if (!report?.snapshot_image_path) throw new ApiError("not_found", "This report has no photo.", 404);
    const { data, error } = await ctx.admin.storage.from(REPORT_EVIDENCE_BUCKET).createSignedUrl(report.snapshot_image_path, 300);
    if (error || !data) throw new ApiError("internal", error?.message ?? "Could not open the photo.", 500);
    await audit(ctx, "report.photo_viewed", { table: "content_reports", id: reportId, teamId: report.team_id });
    return { url: data.signedUrl };
  },

  // ----- Broadcasts --------------------------------------------------------------------
  async broadcast(ctx, p) {
    const title = str(p, "title", { min: 1, max: 80 });
    const body = str(p, "body", { min: 1, max: 300 });
    const test = p.test === true;
    const seg = (p.segment ?? {}) as Params;
    const segment: Record<string, string> = { kind: oneOf(seg, "kind", SEGMENT_KINDS) };
    if (segment.kind === "team" || segment.kind === "org") segment.id = uuid(seg, "id");
    let userIds: string[];
    if (test) {
      userIds = [ctx.uid];
    } else {
      // Resolved by the database under the admin's own JWT, so the audience rules live in one place.
      const { data, error } = await ctx.db.rpc("admin_segment_users", { _segment: segment });
      if (error) throw new ApiError("internal", error.message, 500);
      userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
    }
    const push = await pushToUsers(ctx, userIds, title, body);
    const { data: row } = await ctx.admin.from("admin_broadcasts").insert({
      title, body, segment, is_test: test, recipients: userIds.length, with_devices: push.devices, delivered: push.delivered, sent_by: ctx.uid,
    }).select("id").single();
    await audit(ctx, test ? "broadcast.test" : "broadcast.send", { table: "admin_broadcasts", id: row?.id ?? null, teamId: segment.kind === "team" ? segment.id : null },
      { title, segment, recipients: userIds.length, ...push });
    return { recipients: userIds.length, ...push };
  },

  // ----- Admins ------------------------------------------------------------------------
  async "add-admin"(ctx, p) {
    requireOwner(ctx);
    const email = str(p, "email", { min: 3, max: 200 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError("invalid_input", "That doesn't look like an email address.");
    const role = oneOf(p, "role", ["owner", "support"] as const);
    const { data, error } = await ctx.admin.from("platform_admins")
      .upsert({ email, role, added_by: ctx.uid, removed_at: null }, { onConflict: "email" }).select("id").single();
    if (error || !data) throw new ApiError("internal", error?.message ?? "Could not add the admin.", 500);
    await audit(ctx, "admins.add", { table: "platform_admins", id: data.id }, { email, role });
    return { ok: true };
  },

  async "remove-admin"(ctx, p) {
    requireOwner(ctx);
    const id = uuid(p, "id");
    const { data: target } = await ctx.admin.from("platform_admins").select("id, email, role, user_id").eq("id", id).maybeSingle();
    if (!target) throw new ApiError("not_found", "Admin not found.", 404);
    if (target.user_id === ctx.uid) throw new ApiError("invalid_input", "You can't remove yourself.");
    await ctx.admin.from("platform_admins").update({ removed_at: new Date().toISOString() }).eq("id", id);
    if (target.user_id) await ctx.admin.from("admin_push_subscriptions").delete().eq("admin_user_id", target.user_id);
    await audit(ctx, "admins.remove", { table: "platform_admins", id }, { email: target.email, role: target.role });
    return { ok: true };
  },

  // ----- This device's alerts ----------------------------------------------------------
  async "push-subscribe"(ctx, p) {
    const endpoint = str(p, "endpoint", { min: 10, max: 1000 });
    if (!endpoint.startsWith("https://")) throw new ApiError("invalid_input", "Invalid push endpoint.");
    const alerts = Array.isArray(p.alerts) ? p.alerts.filter((a): a is string => typeof a === "string" && ALERT_TYPES.includes(a)) : ALERT_TYPES;
    const { error } = await ctx.admin.from("admin_push_subscriptions").upsert({
      admin_user_id: ctx.uid, endpoint, p256dh: str(p, "p256dh", { min: 10, max: 200 }), auth: str(p, "auth", { min: 10, max: 100 }),
      alerts, user_agent: str(p, "user_agent", { max: 300, optional: true }) || null,
    }, { onConflict: "endpoint" });
    if (error) throw new ApiError("internal", error.message, 500);
    return { ok: true, alerts };
  },

  async "push-unsubscribe"(ctx, p) {
    const endpoint = str(p, "endpoint", { min: 10, max: 1000 });
    await ctx.admin.from("admin_push_subscriptions").delete().eq("endpoint", endpoint).eq("admin_user_id", ctx.uid);
    return { ok: true };
  },

  async "push-test"(ctx) {
    const sent = await alertAdmins(ctx.admin, { type: "report", title: "ClubHQ alerts are on", body: "This device will get admin alerts.", url: "#/" }, ctx.uid);
    return { sent };
  },
};

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

    // The database decides: active admin row + AAL2 claim on this very token.
    const db = userClient(authHeader);
    const { data: who, error: whoErr } = await db.rpc("admin_whoami");
    if (whoErr) throw new ApiError("internal", whoErr.message, 500);
    if (!who?.role) throw new ApiError("not_admin", "This account isn't a ClubHQ admin.", 403);
    if (who.aal !== "aal2") throw new ApiError("mfa_required", "Verify with your authenticator app first.", 403);

    const body = (await req.json().catch(() => ({}))) as Params;
    const action = typeof body.action === "string" ? body.action : "";
    const handler = actions[action];
    if (!handler) throw new ApiError("unknown_action", `Unknown action "${action}"`, 404);
    const ctx: Ctx = { uid: userData.user.id, email: userData.user.email ?? "", role: who.role, admin, db };
    return json(await handler(ctx, body));
  } catch (e) {
    return errorResponse(e);
  }
});
