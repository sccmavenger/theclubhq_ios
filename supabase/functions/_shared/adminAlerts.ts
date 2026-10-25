// Web-push alerts to admins' devices (DECISIONS D-041). Best effort: an alert failure must
// never fail the user's request that triggered it.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { sendWebPush, webPushConfigured } from "./webpush.ts";

export type AlertType = "report" | "team" | "subscription" | "account";

export interface AdminAlert {
  type: AlertType;
  title: string;
  body: string;
  /** Portal route, e.g. "#/moderation". */
  url: string;
}

export async function alertAdmins(admin: SupabaseClient, alert: AdminAlert, onlyUserId?: string): Promise<number> {
  if (!webPushConfigured()) return 0;
  try {
    let q = admin.from("admin_push_subscriptions").select("id, endpoint, p256dh, auth, admin_user_id").contains("alerts", [alert.type]);
    if (onlyUserId) q = q.eq("admin_user_id", onlyUserId);
    const { data: subs } = await q;
    // Only deliver to people who are still admins.
    const { data: admins } = await admin.from("platform_admins").select("user_id").is("removed_at", null).not("user_id", "is", null);
    const allowed = new Set((admins ?? []).map((a) => a.user_id));
    let sent = 0;
    const gone: string[] = [];
    await Promise.all((subs ?? []).filter((s) => allowed.has(s.admin_user_id)).map(async (s) => {
      const result = await sendWebPush(s, { title: alert.title, body: alert.body, url: alert.url, tag: alert.type });
      if (result === "ok") {
        sent++;
        await admin.from("admin_push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
      }
      if (result === "gone") gone.push(s.id);
    }));
    if (gone.length > 0) await admin.from("admin_push_subscriptions").delete().in("id", gone);
    return sent;
  } catch (e) {
    console.error("admin alert failed", e);
    return 0;
  }
}
