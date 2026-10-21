// Port of the web app's `enqueueTeamNotification` (src/lib/notifications.server.ts) so
// iOS-originated actions fan out exactly like web-originated ones. Additionally includes
// player accounts for team-wide content (players never receive parents-only content).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

export type NotificationKind =
  | "announcement"
  | "event_created"
  | "event_updated"
  | "event_reminder"
  | "rsvp_reminder"
  | "message_new"
  | "event_thread_reply";

function linkFor(kind: NotificationKind, refId?: string | null): string {
  if (!refId) return "/notifications";
  switch (kind) {
    case "event_created":
    case "event_updated":
    case "event_reminder":
    case "rsvp_reminder":
      return `/event/${refId}`;
    case "message_new":
    case "event_thread_reply":
      return `/team/messages/${refId}`;
    case "announcement":
      return `/parent`;
    default:
      return "/notifications";
  }
}

export async function enqueueTeamNotification(
  admin: SupabaseClient,
  input: {
    teamId: string;
    kind: NotificationKind;
    subject: string;
    body: string;
    refId?: string;
    senderUserId?: string;
    /** Exact recipients (direct/group threads, targeted dues reminders). */
    recipientUserIds?: string[];
    /** Include player accounts on the team (team-wide content only). */
    includePlayers?: boolean;
    /** Exclude parents (staff-only threads). */
    staffOnly?: boolean;
  },
): Promise<number> {
  const { data: notification, error } = await admin
    .from("notifications")
    .insert({
      team_id: input.teamId,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      ref_id: input.refId ?? null,
    })
    .select("id")
    .single();
  if (error || !notification) return 0;

  const recipients = new Set<string>();
  if (input.recipientUserIds) {
    input.recipientUserIds.forEach((u) => recipients.add(u));
  } else {
    if (!input.staffOnly) {
      const { data: parents } = await admin
        .from("parent_player_links")
        .select("parent_user_id, players!inner(team_id)")
        .eq("players.team_id", input.teamId);
      (parents ?? []).forEach((p: { parent_user_id: string }) => recipients.add(p.parent_user_id));
    }
    const { data: staff } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("team_id", input.teamId)
      .in("role", ["head_coach", "assistant_coach", "team_manager"]);
    (staff ?? []).forEach((s: { user_id: string }) => recipients.add(s.user_id));
    if (input.includePlayers && !input.staffOnly) {
      const { data: players } = await admin
        .from("players")
        .select("user_id")
        .eq("team_id", input.teamId)
        .is("archived_at", null)
        .not("user_id", "is", null);
      (players ?? []).forEach((p: { user_id: string }) => recipients.add(p.user_id));
    }
  }
  if (input.senderUserId) recipients.delete(input.senderUserId);

  if ((input.kind === "message_new" || input.kind === "event_thread_reply") && input.refId) {
    const { data: mutes } = await admin.from("thread_mutes").select("user_id").eq("thread_id", input.refId);
    (mutes ?? []).forEach((m: { user_id: string }) => recipients.delete(m.user_id));
  }
  if (recipients.size === 0) return 0;

  const link = linkFor(input.kind, input.refId);
  const sends = [];
  for (const uid of recipients) {
    let email = "";
    try {
      const { data } = await admin.auth.admin.getUserById(uid);
      email = data.user?.email ?? "";
    } catch {
      /* email is best-effort, the in-app inbox is the source of truth */
    }
    sends.push({
      notification_id: notification.id,
      recipient_user_id: uid,
      recipient_email: email,
      status: "pending",
      link_path: link,
    });
  }
  await admin.from("notification_sends").insert(sends);
  return sends.length;
}
