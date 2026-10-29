// Permanent deletion of teams deleted more than 30 days ago (DECISIONS D-046). Run by
// scheduled-jobs. Deleting the team row cascades to its roster, guardians' links, events, RSVPs,
// attendance, chats, announcements, dues, invites and imports; its files are removed here first.
// Moderation reports and usage stats keep their rows with the team pointer cleared.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

export const RESTORE_WINDOW_MS = 30 * 24 * 3600_000;
const TEAM_BUCKETS = ["chat-photos", "event-media"];

/** Every file path under `prefix` (storage lists one folder level at a time). */
async function listAll(admin: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  const out: string[] = [];
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    // Folders come back without an id.
    if (item.id === null) out.push(...(await listAll(admin, bucket, path, depth + 1)));
    else out.push(path);
  }
  return out;
}

export async function purgeDeletedTeams(admin: SupabaseClient, now = Date.now()): Promise<number> {
  const { data: teams } = await admin
    .from("teams")
    .select("id, name, org_id, organizations(type)")
    .not("deleted_at", "is", null)
    .lt("deleted_at", new Date(now - RESTORE_WINDOW_MS).toISOString())
    .limit(20);
  let purged = 0;
  for (const t of teams ?? []) {
    try {
      for (const bucket of TEAM_BUCKETS) {
        const files = await listAll(admin, bucket, t.id);
        for (let i = 0; i < files.length; i += 100) await admin.storage.from(bucket).remove(files.slice(i, i + 100));
      }
      const { error } = await admin.from("teams").delete().eq("id", t.id);
      if (error) throw error;
      // An independent team's own organization has nothing left in it.
      if ((t.organizations as unknown as { type: string } | null)?.type !== "club") {
        const { count } = await admin.from("teams").select("id", { count: "exact", head: true }).eq("org_id", t.org_id);
        if ((count ?? 0) === 0) await admin.from("organizations").delete().eq("id", t.org_id);
      }
      await admin.from("audit_logs").insert({ actor_user_id: null, action: "team.purged", target_table: "teams", target_id: t.id, team_id: null, metadata: {} });
      purged++;
    } catch (e) {
      console.error("team purge failed", t.id, e);
    }
  }
  return purged;
}
