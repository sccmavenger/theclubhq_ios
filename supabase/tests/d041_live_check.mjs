// Live check for D-041 (admin portal backend). Throwaway users, team and admin; all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d041_live_check.mjs
import { createHmac } from "node:crypto";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
})).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const ANON = keys.find((k) => k.name === "anon").api_key;
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
}).then((r) => r.json());
let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  ok ? passed++ : failures.push(`${name} ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const stamp = Date.now();
const users = {};
async function makeUser(role) {
  const email = `qa+d041-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const created = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: created.id, email, jwt: s.access_token };
}
const call = async (fn, jwt, action, params = {}) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }),
  });
  return { status: res.status, body: await res.json() };
};
const api = (role, action, params) => call("mobile-api", users[role].jwt, action, params);
const adminApi = (jwt, action, params) => call("admin-api", jwt, action, params);
const rpc = async (jwt, fn, args = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json() };
};

// RFC 6238 TOTP, as an authenticator app computes it.
function totp(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function mfa(jwt) {
  const auth = { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  const factor = await (await fetch(`${SUPABASE_URL}/auth/v1/factors`, { method: "POST", headers: auth, body: JSON.stringify({ factor_type: "totp", friendly_name: `qa ${stamp}` }) })).json();
  const challenge = await (await fetch(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/challenge`, { method: "POST", headers: auth, body: "{}" })).json();
  const verified = await (await fetch(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/verify`, { method: "POST", headers: auth, body: JSON.stringify({ challenge_id: challenge.id, code: totp(factor.totp.secret) }) })).json();
  return verified.access_token;
}

let team;
try {
  await Promise.all(["coach", "family", "admin", "support"].map(makeUser));

  // ----- App side ------------------------------------------------------------------------
  team = (await api("coach", "create-team", { team_name: `QA D041 ${stamp}`, heard_from: "friend_or_coach" })).body;
  const coachProfile = (await sql(`select acquisition_source, signup_via from profiles where id='${users.coach.id}'`))[0];
  check("create-team records how the coach heard about ClubHQ", coachProfile?.acquisition_source === "friend_or_coach" && coachProfile?.signup_via === "created_team", JSON.stringify(coachProfile));
  const token = (await api("coach", "create-invite", { team_id: team.team_id })).body.token;
  await api("family", "claim-invite", { token, child: { first_name: "Avery", last_name: `Q${stamp}`, parent_relationship: "mother", contacts: [{ relationship: "mother", phone: "5555550123" }] } });
  const familyVia = (await sql(`select signup_via from profiles where id='${users.family.id}'`))[0]?.signup_via;
  check("joining with the team code records signup_via", familyVia === "team_code", familyVia);
  await api("coach", "context", { app_version: "1.0.1 (99)" });
  const seen = (await sql(`select last_seen_at is not null seen, app_version from profiles where id='${users.coach.id}'`))[0];
  check("context records last seen and app version", seen?.seen && seen?.app_version === "1.0.1 (99)", JSON.stringify(seen));
  const days = (await sql(`select count(*)::int n from user_activity_days where user_id='${users.coach.id}'`))[0].n;
  check("an activity day is recorded", days === 1, `${days}`);
  const serverEvents = (await sql(`select count(*)::int n from usage_events where user_id='${users.coach.id}' and name='api.create-team' and source='server'`))[0].n;
  check("mutating actions are logged as server usage events", serverEvents === 1, `${serverEvents}`);

  const thread = (await api("coach", "team-chat", { team_id: team.team_id })).body.thread_id;
  const posted = (await api("coach", "post-message", { thread_id: thread, body: "QA message that will be reported" })).body;
  const report = await api("family", "report-content", { message_id: posted.id, reason: "harassment", note: "QA note" });
  check("a family can report a message", report.status === 200 && !!report.body.report_id, JSON.stringify(report.body));
  const dup = await api("family", "report-content", { message_id: posted.id, reason: "harassment" });
  check("reporting it again is a no-op", dup.body.duplicate === true && dup.body.report_id === report.body.report_id, JSON.stringify(dup.body));
  const snap = (await sql(`select snapshot_body, author_id, status from content_reports where id='${report.body.report_id}'`))[0];
  check("the report snapshots the message", snap?.snapshot_body === "QA message that will be reported" && snap?.author_id === users.coach.id && snap?.status === "open", JSON.stringify(snap));
  const own = await api("coach", "report-content", { message_id: posted.id });
  check("you can't report your own message", own.status === 400, JSON.stringify(own.body));
  const convo = await api("family", "report-content", { thread_id: thread, reason: "other", note: "Something in this chat" });
  check("a whole conversation can be reported", convo.status === 200, JSON.stringify(convo.body));

  const blocked = await api("family", "block-user", { user_id: users.coach.id });
  check("block returns the server-side block list", blocked.body.blocked_user_ids?.includes(users.coach.id), JSON.stringify(blocked.body));
  const visible = (await api("family", "list-messages", { thread_id: thread })).body.messages ?? [];
  check("blocked authors are hidden server-side", !visible.some((m) => m.author_id === users.coach.id), `${visible.length} visible`);
  const ctxBlocks = (await api("family", "context")).body.blocked_user_ids;
  check("context returns blocks so they follow the user to new devices", ctxBlocks?.includes(users.coach.id), JSON.stringify(ctxBlocks));
  await api("family", "unblock-user", {});
  const visibleAgain = (await api("family", "list-messages", { thread_id: thread })).body.messages ?? [];
  check("unblock-all restores their messages", visibleAgain.some((m) => m.author_id === users.coach.id));

  const tracked = await api("coach", "track", { app_version: "1.0.1 (99)", events: [
    { name: "paywall.viewed", team_id: team.team_id, props: { source: "team_color" } },
    { name: "Bad Name!", props: {} },
    { name: "tour.completed", props: { role: "coach", "bad key": "x", note: "y".repeat(500) } },
  ] });
  check("track keeps valid events and drops malformed ones", tracked.body.accepted === 2, JSON.stringify(tracked.body));
  const cleaned = (await sql(`select props from usage_events where user_id='${users.coach.id}' and name='tour.completed'`))[0]?.props;
  check("event props are trimmed and filtered", cleaned && !("bad key" in cleaned) && cleaned.note.length === 64, JSON.stringify(cleaned));

  // ----- Admin access -------------------------------------------------------------------
  await sql(`insert into platform_admins (email, role) values ('${users.admin.email}', 'owner'), ('${users.support.email}', 'support')`);
  const who = await rpc(users.admin.jwt, "admin_whoami");
  check("whoami claims the admin row by confirmed email", who.body?.role === "owner" && who.body?.aal === "aal1", JSON.stringify(who.body));
  const noMfa = await rpc(users.admin.jwt, "admin_teams");
  check("admin reads require MFA", noMfa.status === 403 && noMfa.body.message === "mfa_required", JSON.stringify(noMfa.body));
  const noMfaWrite = await adminApi(users.admin.jwt, "config");
  check("admin writes require MFA", noMfaWrite.status === 403 && noMfaWrite.body.error?.code === "mfa_required", JSON.stringify(noMfaWrite.body));
  const outsider = await rpc(users.family.jwt, "admin_overview");
  check("non-admins are refused by the database", outsider.status === 403 && outsider.body.message === "not_admin", JSON.stringify(outsider.body));
  const outsiderWrite = await adminApi(users.family.jwt, "config");
  check("non-admins are refused by admin-api", outsiderWrite.body.error?.code === "not_admin", JSON.stringify(outsiderWrite.body));

  const owner = await mfa(users.admin.jwt);
  const support = await mfa(users.support.jwt);
  check("TOTP verification yields an AAL2 session", (await rpc(owner, "admin_whoami")).body?.aal === "aal2");
  const config = await adminApi(owner, "config");
  check("admin-api config works and web push is configured", config.status === 200 && config.body.web_push_configured === true && !!config.body.vapid_public_key, JSON.stringify(config.body));

  const overview = await rpc(owner, "admin_overview");
  check("overview loads", overview.status === 200 && Array.isArray(overview.body.weekly) && overview.body.weekly.length === 12, JSON.stringify(overview.body).slice(0, 200));
  const teams = (await rpc(owner, "admin_teams")).body;
  const row = teams.find((t) => t.id === team.team_id);
  check("teams list includes the new team with counts", row && row.families === 1 && row.messages_7d >= 1 && row.internal === true, JSON.stringify(row));
  const detail = (await rpc(owner, "admin_team", { _team_id: team.team_id })).body;
  const text = JSON.stringify(detail);
  check("team detail never contains message bodies", detail.threads?.length >= 1 && !text.includes("QA message that will be reported"), text.slice(0, 200));
  const person = (await rpc(owner, "admin_user", { _user_id: users.family.id })).body;
  check("person detail shows memberships and children", person.memberships?.length === 1 && person.children?.length === 1 && person.profile?.signup_via === "team_code");
  const viewAs = (await rpc(owner, "admin_view_as", { _user_id: users.family.id })).body;
  check("view-as returns their teams, without chats", viewAs.teams?.length === 1 && !JSON.stringify(viewAs).includes("QA message"), JSON.stringify(viewAs).slice(0, 200));
  const reports = (await rpc(owner, "admin_reports", { _status: "open" })).body;
  check("moderation queue shows the report snapshot", reports.some((r) => r.id === report.body.report_id && r.snapshot_body === "QA message that will be reported"));
  const found = (await rpc(owner, "admin_search_users", { _q: `d041-family-${stamp}` })).body;
  check("search by email finds the person", found.length === 1 && found[0].id === users.family.id, JSON.stringify(found).slice(0, 200));

  // ----- Admin actions ------------------------------------------------------------------
  const grant = await adminApi(owner, "grant-pro", { target_type: "team", target_id: team.team_id, reason: "QA pilot", expires_at: new Date(Date.now() + 86400000).toISOString() });
  check("owner can grant Pro to a team", grant.status === 200, JSON.stringify(grant.body));
  const ctxPro = (await api("coach", "context")).body.teams.find((t) => t.id === team.team_id);
  check("the app sees the team as Pro immediately", ctxPro?.is_pro === true, JSON.stringify(ctxPro));
  await adminApi(owner, "revoke-grant", { grant_id: grant.body.grant.id });
  const ctxFree = (await api("coach", "context")).body.teams.find((t) => t.id === team.team_id);
  check("revoking the grant turns Pro off", ctxFree?.is_pro === false);
  const longGrant = await adminApi(support, "grant-pro", { target_type: "team", target_id: team.team_id, reason: "QA", expires_at: new Date(Date.now() + 200 * 86400000).toISOString() });
  check("support can't grant more than 90 days", longGrant.status === 403 && longGrant.body.error?.code === "owner_only", JSON.stringify(longGrant.body));
  const supportMerge = await adminApi(support, "merge-users", { source_id: users.family.id, target_id: users.coach.id });
  check("support can't merge accounts", supportMerge.body.error?.code === "owner_only");

  const resolved = await adminApi(owner, "resolve-report", { report_id: report.body.report_id, resolution: "removed", note: "QA removal" });
  check("resolving a report removes the message", resolved.status === 200 && resolved.body.effects?.message_removed === true, JSON.stringify(resolved.body));
  const gone = (await sql(`select deleted_at is not null d from messages where id='${posted.id}'`))[0]?.d;
  check("the message is deleted for everyone", gone === true);
  const again = await adminApi(owner, "resolve-report", { report_id: report.body.report_id, resolution: "dismissed" });
  check("a resolved report can't be resolved twice", again.status === 400);

  const suspended = await adminApi(owner, "suspend-user", { user_id: users.family.id, reason: "QA suspension" });
  check("owner can suspend a user", suspended.status === 200, JSON.stringify(suspended.body));
  const blockedCall = await api("family", "context");
  check("a suspended user's requests are refused with a clear code", blockedCall.status === 403 && blockedCall.body.error?.code === "account_suspended", JSON.stringify(blockedCall.body));
  const selfClear = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${users.family.id}`, {
    method: "PATCH", headers: { apikey: ANON, Authorization: `Bearer ${users.family.jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ suspended_at: null }),
  });
  const stillSuspended = (await sql(`select suspended_at is not null s from profiles where id='${users.family.id}'`))[0]?.s;
  check("a user can't clear their own suspension through PostgREST", stillSuspended === true, `PATCH ${selfClear.status}`);
  await adminApi(owner, "unsuspend-user", { user_id: users.family.id });
  // The ban was lifted; sign in again for a fresh token.
  const fresh = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ type: "magiclink", email: users.family.email }) })).json();
  check("unsuspending lifts the ban", fresh?.properties?.hashed_token || fresh?.action_link, JSON.stringify(fresh).slice(0, 120));

  const preview = (await rpc(owner, "admin_broadcast_preview", { _segment: { kind: "team", id: team.team_id } })).body;
  check("broadcast preview counts the team's people", preview.recipients === 2, JSON.stringify(preview).slice(0, 200));
  const testSend = await adminApi(owner, "broadcast", { title: "QA", body: "QA test broadcast", segment: { kind: "team", id: team.team_id }, test: true });
  check("test broadcast goes only to the admin", testSend.status === 200 && testSend.body.recipients === 1, JSON.stringify(testSend.body));

  const audit = (await rpc(owner, "admin_audit", { _limit: 50 })).body;
  const actions = new Set(audit.filter((a) => a.actor_email === users.admin.email).map((a) => a.action));
  check("every admin write was audited", ["admin.pro.grant", "admin.pro.revoke", "admin.report.removed", "admin.user.suspend", "admin.user.unsuspend", "admin.view_as", "admin.broadcast.test"].every((a) => actions.has(a)), [...actions].join(","));

  const sched = await adminApi(owner, "schedule-deletion", { user_id: users.family.id, reason: "QA grace period" });
  check("scheduling a deletion suspends now and deletes later", sched.status === 200 && (await api("family", "context")).status === 403);
  await adminApi(owner, "cancel-deletion", { user_id: users.family.id });
  const cancelled = (await sql(`select cancelled_at is not null c from account_deletions where user_id='${users.family.id}'`))[0]?.c;
  check("a scheduled deletion can be cancelled", cancelled === true);
} finally {
  if (team?.team_id) {
    await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id='${team.team_id}');
      delete from notifications where team_id='${team.team_id}'; delete from content_reports where team_id='${team.team_id}';
      delete from teams where id='${team.team_id}'; delete from organizations where id='${team.org_id}';`);
  }
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from audit_logs where actor_user_id in (${ids}) or target_id in (${ids});
    delete from admin_broadcasts where sent_by in (${ids}); delete from account_deletions where user_id in (${ids});
    delete from platform_admins where email like 'qa+d041-%';`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
