// Pushes every not-yet-dispatched notification_sends row to the recipient's iOS devices
// (DECISIONS D-021). Safe to run concurrently: rows are claimed by stamping apns_sent_at first.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { sendApns } from "./apns.ts";

export async function dispatchPendingPushes(admin: SupabaseClient, limit = 200): Promise<number> {
  if (!Deno.env.get("APNS_PRIVATE_KEY")) return 0; // push not configured yet — inbox still works

  const since = new Date(Date.now() - 6 * 3600_000).toISOString(); // never push stale items
  const { data: pending } = await admin
    .from("notification_sends")
    .select("id, recipient_user_id, link_path, notification_id, notifications(subject, body, ref_id)")
    .is("apns_sent_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (!pending || pending.length === 0) return 0;

  // Claim the batch so an overlapping cron run doesn't double-send.
  const ids = pending.map((p) => p.id);
  const { data: claimed } = await admin
    .from("notification_sends")
    .update({ apns_sent_at: new Date().toISOString() })
    .in("id", ids)
    .is("apns_sent_at", null)
    .select("id");
  const claimedIds = new Set((claimed ?? []).map((c) => c.id));

  const userIds = [...new Set(pending.map((p) => p.recipient_user_id))];
  const { data: tokens } = await admin
    .from("device_tokens")
    .select("token, environment, user_id")
    .in("user_id", userIds);
  const byUser = new Map<string, Array<{ token: string; environment: "sandbox" | "production" }>>();
  for (const t of tokens ?? []) {
    const list = byUser.get(t.user_id) ?? [];
    list.push({ token: t.token, environment: t.environment });
    byUser.set(t.user_id, list);
  }

  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    pending
      .filter((p) => claimedIds.has(p.id))
      .flatMap((p) => {
        const n = (p as unknown as { notifications: { subject: string; body: string; ref_id: string | null } })
          .notifications;
        return (byUser.get(p.recipient_user_id) ?? []).map(async (device) => {
          const result = await sendApns(device.token, device.environment, {
            title: n?.subject ?? "ClubHQ",
            body: n?.body ?? "",
            linkPath: p.link_path ?? "/notifications",
            threadId: n?.ref_id ?? undefined,
          });
          if (result === "ok") sent++;
          if (result === "gone") gone.push(device.token);
        });
      }),
  );
  if (gone.length > 0) await admin.from("device_tokens").delete().in("token", gone);
  return sent;
}
