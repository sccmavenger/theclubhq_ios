// Live check for D-046 (deleting a team): who may delete, confirmation, families told, the team
// disappears and frees the coach's slot, admin-only restore within 30 days, permanent purge after.
// Throwaway accounts, all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d046_live_check.mjs
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
const DISPATCH = readFileSync(new URL("../../.secrets/apns-dispatch-secret", import.meta.url), "utf8").trim();
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const stamp = Date.now(), users = {};
async function makeUser(role) {
  const email = `qa+d046-${role}-${stamp}@teamclubhq.com`, password = `Qa!${randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, email, jwt: s.access_token };
}
const call = async (fn, jwt, action, params = {}) => {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
  return { status: r.status, body: await r.json() };
};
const api = (role, action, params) => call("mobile-api", users[role].jwt, action, params);
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

const orgs = [];
try {
  for (const r of ["coach", "assistant", "parent", "director", "clubcoach", "admin"]) await makeUser(r);

  // ----- Independent team ------------------------------------------------------
  const team = (await api("coach", "create-team", { team_name: "QA Disband Team", heard_from: "friend_or_coach" })).body;
  orgs.push(team.org_id);
  const kid = (await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${team.team_id}', 'Ava', 'QA', '${users.coach.id}') returning id`))[0].id;
  await sql(`insert into parent_player_links (player_id, parent_user_id, relationship) values ('${kid}', '${users.parent.id}', 'mother');
    insert into user_roles (user_id, role, team_id, org_id) values ('${users.parent.id}', 'parent', '${team.team_id}', null), ('${users.assistant.id}', 'assistant_coach', '${team.team_id}', '${team.org_id}');`);
  await api("coach", "save-event", { team_id: team.team_id, title: "Practice", event_type: "practice", starts_at: new Date(Date.now() + 3 * 864e5).toISOString(), time_zone: "America/Chicago" });
  const ctxTeam = (await api("coach", "context")).body.teams.find((t) => t.id === team.team_id);
  check("context marks an independent team as not a club team", ctxTeam?.is_club_team === false, JSON.stringify(ctxTeam?.is_club_team));

  const full = await api("coach", "create-team", { team_name: "Second team", heard_from: "friend_or_coach" });
  check("a free coach can't start a second team while the first exists", full.status === 402, String(full.status));
  check("an assistant coach can't delete the team", (await api("assistant", "delete-team", { team_id: team.team_id, confirm_name: "QA Disband Team" })).status === 403);
  check("a parent can't delete the team", (await api("parent", "delete-team", { team_id: team.team_id, confirm_name: "QA Disband Team" })).status === 403);
  const wrong = await api("coach", "delete-team", { team_id: team.team_id, confirm_name: "QA Disband" });
  check("the exact team name is required", wrong.status === 400 && /exactly/.test(wrong.body.error?.message ?? ""), JSON.stringify(wrong.body));

  const del = await api("coach", "delete-team", { team_id: team.team_id, confirm_name: "qa disband team", notify_families: true });
  check("the head coach deletes it (name is case-insensitive)", del.status === 200 && del.body.ok, JSON.stringify(del.body));
  const told = await sql(`select n.subject, s.recipient_user_id from notifications n join notification_sends s on s.notification_id=n.id where n.team_id='${team.team_id}' and n.subject like '%was closed'`);
  check("families and staff are told once; the coach isn't", told.some((t) => t.recipient_user_id === users.parent.id) && told.some((t) => t.recipient_user_id === users.assistant.id) && !told.some((t) => t.recipient_user_id === users.coach.id), JSON.stringify(told));
  for (const role of ["coach", "parent", "assistant"]) {
    const has = (await api(role, "context")).body.teams.some((t) => t.id === team.team_id);
    check(`it's gone from the ${role}'s app`, !has);
  }
  const readAs = async (role, table) => (await (await fetch(`${SUPABASE_URL}/rest/v1/${table}?team_id=eq.${team.team_id}&select=id`, { headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}` } })).json());
  const leaks = { parentEvents: await readAs("parent", "events"), parentPlayers: await readAs("parent", "players"), coachEvents: await readAs("coach", "events"), assistantPlayers: await readAs("assistant", "players") };
  check("members can't read any of its data through the API either", Object.values(leaks).every((r) => Array.isArray(r) && r.length === 0), JSON.stringify(leaks));
  const again = await api("coach", "delete-team", { team_id: team.team_id, confirm_name: "QA Disband Team" });
  check("deleting twice says it's already gone", again.status === 404, String(again.status));
  const freed = await api("coach", "create-team", { team_name: "New season team", heard_from: "friend_or_coach" });
  check("the coach's free team slot is freed", freed.status === 200, JSON.stringify(freed.body));
  if (freed.body.org_id) orgs.push(freed.body.org_id);

  // ----- Restore: admin only, within 30 days -----------------------------------
  await sql(`insert into platform_admins (email, role) values ('${users.admin.email}', 'owner')`);
  const admin = await mfa(users.admin.jwt);
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_whoami`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${admin}`, "Content-Type": "application/json" }, body: "{}" });
  const adminView = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_team`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${admin}`, "Content-Type": "application/json" }, body: JSON.stringify({ _team_id: team.team_id }) }).then((r) => r.json());
  check("the admin portal sees who deleted it and when", adminView.team?.deleted_at && adminView.team?.archived_at, JSON.stringify(adminView.team ?? adminView).slice(0, 200));
  const restored = await call("admin-api", admin, "set-team-archived", { team_id: team.team_id, archived: false, note: "QA restore" });
  const back = (await api("parent", "context")).body.teams.some((t) => t.id === team.team_id);
  check("an admin restores it within 30 days, exactly as it was", restored.status === 200 && back && (await sql(`select deleted_at from teams where id='${team.team_id}'`))[0].deleted_at === null, JSON.stringify(restored.body));
  await api("coach", "delete-team", { team_id: team.team_id, confirm_name: "QA Disband Team", notify_families: false });
  await sql(`update teams set deleted_at = now() - interval '31 days' where id='${team.team_id}'`);
  const late = await call("admin-api", admin, "set-team-archived", { team_id: team.team_id, archived: false, note: "QA too late" });
  check("after 30 days even an admin can't restore it", late.status === 410, JSON.stringify(late.body));

  // ----- Purge ------------------------------------------------------------------
  const jobs = await (await fetch(`${SUPABASE_URL}/functions/v1/scheduled-jobs`, { method: "POST", headers: { Authorization: `Bearer ${DISPATCH}`, "Content-Type": "application/json" }, body: "{}" })).json();
  const left = await sql(`select (select count(*)::int from teams where id='${team.team_id}') t, (select count(*)::int from players where id='${kid}') p, (select count(*)::int from events where team_id='${team.team_id}') e, (select count(*)::int from parent_player_links where player_id='${kid}') l, (select count(*)::int from organizations where id='${team.org_id}') o`);
  check("after 30 days it's permanently deleted with everything on it", jobs.purged >= 1 && left[0].t === 0 && left[0].p === 0 && left[0].e === 0 && left[0].l === 0 && left[0].o === 0, `${JSON.stringify(jobs)} ${JSON.stringify(left)}`);

  // ----- Club team: only directors ---------------------------------------------
  const club = (await api("director", "create-club", { name: `QA Delete Club ${stamp}` })).body;
  orgs.push(club.org_id);
  await sql(`update organizations set club_approved_at = now() where id = '${club.org_id}'`); // new clubs wait for approval (D-051)
  const [ct] = (await api("director", "club-create-teams", { org_id: club.org_id, teams: [{ name: "QA Club Team", grade: "6", coach_email: users.clubcoach.email }] })).body.teams;
  await api("clubcoach", "claim-club-invite", { token: ct.coach.code }); // coaches accept a code (D-051)
  const cctx = (await api("clubcoach", "context")).body.teams.find((t) => t.id === ct.team_id);
  check("context marks a club team", cctx?.is_club_team === true && cctx.roles.includes("head_coach"), JSON.stringify(cctx));
  const coachTry = await api("clubcoach", "delete-team", { team_id: ct.team_id, confirm_name: "QA Club Team" });
  check("the club team's head coach can't delete it", coachTry.status === 403 && /directors/.test(coachTry.body.error?.message ?? ""), JSON.stringify(coachTry.body));
  const dirDel = await api("director", "delete-team", { team_id: ct.team_id, confirm_name: "QA Club Team" });
  check("the club director can", dirDel.status === 200, JSON.stringify(dirDel.body));
  const ov = (await api("director", "club-overview", { org_id: club.org_id })).body;
  check("…and it leaves the Club tab", !ov.teams.some((t) => t.id === ct.team_id), JSON.stringify(ov.teams?.map((t) => t.name)));
} finally {
  const list = orgs.filter(Boolean).map((o) => `'${o}'`).join(",");
  if (list) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id in (select id from teams where org_id in (${list})));
    delete from notifications where team_id in (select id from teams where org_id in (${list}));
    delete from teams where org_id in (${list}); delete from user_roles where org_id in (${list}); delete from organizations where id in (${list});`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from notification_sends where recipient_user_id in (${ids}); delete from audit_logs where actor_user_id in (${ids}); delete from platform_admins where email like 'qa+d046-%'; delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
