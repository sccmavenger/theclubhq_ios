// Account deletion, shared by the in-app Delete Account (D-014) and the admin portal (D-041).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

export async function deleteUserAccount(admin: SupabaseClient, userId: string): Promise<"deleted" | "scrubbed"> {
  // Teams where this user is the ONLY head coach get archived (not deleted) so other
  // families keep their history; staff can be re-assigned by support.
  const { data: hc } = await admin.from("user_roles").select("team_id").eq("user_id", userId).eq("role", "head_coach");
  for (const r of hc ?? []) {
    const { count } = await admin.from("user_roles").select("id", { count: "exact", head: true }).eq("team_id", r.team_id).eq("role", "head_coach");
    if ((count ?? 0) <= 1) await admin.from("teams").update({ archived_at: new Date().toISOString() }).eq("id", r.team_id);
  }
  await Promise.all([
    admin.from("device_tokens").delete().eq("user_id", userId),
    admin.from("user_roles").delete().eq("user_id", userId),
    admin.from("parent_player_links").delete().eq("parent_user_id", userId),
    admin.from("players").update({ user_id: null }).eq("user_id", userId),
    admin.from("thread_participants").delete().eq("user_id", userId),
    admin.from("thread_mutes").delete().eq("user_id", userId),
    admin.from("message_reads").delete().eq("user_id", userId),
    admin.from("calendar_feeds").delete().eq("user_id", userId),
    // Analytics and blocks go with the account (D-041), even when the auth row is only scrubbed.
    admin.from("usage_events").delete().eq("user_id", userId),
    admin.from("user_activity_days").delete().eq("user_id", userId),
    admin.from("user_blocks").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
    admin.from("pro_grants").delete().eq("user_id", userId),
    admin.from("admin_push_subscriptions").delete().eq("admin_user_id", userId),
  ]);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (!error) return "deleted";
  // Foreign keys (e.g. authored messages) can block a hard delete. Scrub instead:
  // no email, no name, banned — personal data is gone, history shows "Deleted user".
  await admin.auth.admin.updateUserById(userId, {
    email: `deleted+${userId}@users.clubhq.invalid`,
    user_metadata: {},
    ban_duration: "876000h",
  });
  await admin.from("profiles").update({
    full_name: "Deleted user", phone: null, avatar_url: null, acquisition_source: null, app_version: null,
  }).eq("id", userId);
  return "scrubbed";
}
