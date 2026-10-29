// Live check for D-045 (event reminders + RSVP nudges) against the deployed scheduled-jobs and
// mobile-api. Throwaway users and team, all deleted at the end. The team's time zone is one where
// it's currently midday, so the quiet-hour rules don't block the test.
//   set -a; source .env.local; set +a; node supabase/tests/d045_live_check.mjs
import { readFileSync } from "node:fs";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN) throw new Error("source .env.local first");
const DISPATCH = readFileSync(new URL("../../.secrets/apns-dispatch-secret", import.meta.url), "utf8").trim();
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const stamp = Date.now(), users = {};
async function makeUser(role) {
  const email = `qa+d045-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, email, jwt: s.access_token };
}
const api = async (role, action, params = {}) => {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
  return { status: r.status, body: await r.json() };
};
const runJobs = async () => (await fetch(`${SUPABASE_URL}/functions/v1/scheduled-jobs`, { method: "POST", headers: { Authorization: `Bearer ${DISPATCH}`, "Content-Type": "application/json" }, body: "{}" })).json();
// A zone where it's 12–16h now.
const ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];
const hourIn = (tz) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
const tz = ZONES.find((z) => hourIn(z) >= 11 && hourIn(z) <= 16) ?? ZONES.find((z) => hourIn(z) >= 9 && hourIn(z) <= 18);

let team;
try {
  await makeUser("coach"); await makeUser("parent"); await makeUser("optout");
  team = (await api("coach", "create-team", { team_name: "QA Reminders", heard_from: "friend_or_coach" })).body;
  await sql(`update teams set time_zone='${tz}' where id='${team.team_id}'`);
  // Two players: Jordan (parent) and Mia (optout parent).
  const p1 = (await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${team.team_id}', 'Jordan', 'QA', '${users.coach.id}') returning id`))[0].id;
  const p2 = (await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${team.team_id}', 'Mia', 'QA', '${users.coach.id}') returning id`))[0].id;
  await sql(`insert into parent_player_links (player_id, parent_user_id, relationship) values ('${p1}', '${users.parent.id}', 'mother'), ('${p2}', '${users.optout.id}', 'father');
    insert into user_roles (user_id, role, team_id) values ('${users.parent.id}', 'parent', '${team.team_id}'), ('${users.optout.id}', 'parent', '${team.team_id}');`);
  const prefs = await api("optout", "set-notification-prefs", { event_reminders: false, rsvp_reminders: false });
  check("a parent can turn reminders off", prefs.status === 200 && prefs.body.notification_prefs?.event_reminders === false, JSON.stringify(prefs.body));
  const ctxPrefs = (await api("parent", "context")).body.notification_prefs;
  check("reminders are on by default", ctxPrefs?.event_reminders === true && ctxPrefs?.rsvp_reminders === true, JSON.stringify(ctxPrefs));

  const now = Date.now();
  // Starts in 2 h → "In 2 hours". Starts in 24 h with a cutoff in 6 h → "Tomorrow/Today" + RSVP nudge.
  const soon = (await sql(`insert into events (team_id, title, event_type, starts_at, created_by) values ('${team.team_id}', 'Practice', 'practice', '${new Date(now + 2 * 3600e3).toISOString()}', '${users.coach.id}') returning id`))[0].id;
  const later = (await sql(`insert into events (team_id, title, event_type, opponent, home_away, starts_at, rsvp_cutoff_at, location, created_by) values ('${team.team_id}', 'Game', 'game', 'Rage', 'away', '${new Date(now + 24 * 3600e3).toISOString()}', '${new Date(now + 6 * 3600e3).toISOString()}', 'Beal Center Gym 8', '${users.coach.id}') returning id`))[0].id;
  await sql(`insert into rsvps (event_id, player_id, status, responded_by) values ('${later}', '${p2}', 'yes', '${users.optout.id}')`);

  const run1 = await runJobs();
  // The every-5-minutes cron may have run first; count what was delivered, not who sent it.
  check(`the job runs (zone ${tz}, ${hourIn(tz)}:00 there)`, run1.reminders?.checked >= 2, JSON.stringify(run1));
  const notes = await sql(`select n.kind, n.subject, n.body, n.ref_id, s.recipient_user_id from notifications n join notification_sends s on s.notification_id=n.id where n.team_id='${team.team_id}' order by n.created_at`);
  const to = (uid, kind, ref) => notes.filter((n) => n.recipient_user_id === uid && n.kind === kind && n.ref_id === ref);
  check("2-hour reminder to the parent and the coach", to(users.parent.id, "event_reminder", soon).length === 1 && to(users.coach.id, "event_reminder", soon).length === 1 && /^In 2 hours: Practice/.test(to(users.parent.id, "event_reminder", soon)[0]?.subject ?? ""), JSON.stringify(notes.filter((n) => n.ref_id === soon)));
  check("day-before reminder names the game", /^(Today|Tomorrow|\w+day): Game @ Rage$/.test(to(users.parent.id, "event_reminder", later)[0]?.subject ?? ""), to(users.parent.id, "event_reminder", later)[0]?.subject);
  check("RSVP nudge only to the family that hasn't answered, naming the child", to(users.parent.id, "rsvp_reminder", later).length === 1 && /^Jordan hasn't responded/.test(to(users.parent.id, "rsvp_reminder", later)[0]?.body ?? "") && notes.filter((n) => n.kind === "rsvp_reminder" && n.recipient_user_id !== users.parent.id).length === 0, JSON.stringify(notes.filter((n) => n.kind === "rsvp_reminder")));
  check("the parent who turned reminders off gets none", notes.filter((n) => n.recipient_user_id === users.optout.id).length === 0, "");
  const run2 = await runJobs();
  const notes2 = await sql(`select count(*)::int n from notifications where team_id='${team.team_id}'`);
  check("running again sends nothing twice", notes2[0].n === new Set(notes.map((n) => n.subject + n.ref_id + n.kind + (n.kind === "rsvp_reminder" ? n.recipient_user_id : ""))).size && Object.values(run2.reminders?.sent ?? {}).every((v) => v === 0) , `${JSON.stringify(run2.reminders)} rows=${notes2[0].n}`);
  await sql(`update events set cancelled_at=now() where id='${soon}'; delete from event_reminder_log where event_id='${soon}'`);
  const run3 = await runJobs();
  check("cancelled events get no reminders", run3.reminders?.sent?.two_hours === 0, JSON.stringify(run3.reminders));
  const bad = await fetch(`${SUPABASE_URL}/functions/v1/scheduled-jobs`, { method: "POST", headers: { Authorization: "Bearer nope" } });
  check("the job refuses callers without the secret", bad.status === 401, String(bad.status));
} finally {
  if (team?.team_id) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id='${team.team_id}'); delete from notifications where team_id='${team.team_id}'; delete from events where team_id='${team.team_id}'; delete from teams where id='${team.team_id}'; delete from organizations where id='${team.org_id}';`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
