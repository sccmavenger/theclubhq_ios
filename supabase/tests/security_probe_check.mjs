// Security probe (2026-10-30 review): tries to break the server the way an attacker would, through
// mobile-api and straight through PostgREST with a user's own token. PASS = the attack was stopped.
// Throwaway accounts (qa+probe-*), all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/security_probe_check.mjs
import { randomUUID } from "node:crypto";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${String(detail).slice(0, 300)}`}`); };
const stamp = Date.now(), users = {}, orgs = [];

async function makeUser(role) {
  const email = `qa+probe-${role}-${stamp}@teamclubhq.com`, password = `Qa!${randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, email, jwt: s.access_token };
}
async function api(role, action, params = {}, raw) {
  const headers = { apikey: ANON, "Content-Type": "application/json" };
  if (role) headers.Authorization = `Bearer ${users[role].jwt}`;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, { method: "POST", headers, body: raw ?? JSON.stringify({ action, ...params }) });
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}
/** PostgREST with the user's own token: what a modified app could do. */
async function rest(role, method, path, body, prefer = "return=representation") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}
const rows = (r) => (Array.isArray(r.data) ? r.data : []);
const iso = (ms) => new Date(Date.now() + ms).toISOString();

try {
  for (const r of ["coachA", "coachB", "parentA", "teen", "outsider"]) await makeUser(r);
  for (const r of Object.keys(users)) await api(r, "update-profile", { full_name: `Probe ${r}` });

  // ----- Setup: team A (coach, parent, 14-year-old player account), team B ------------------
  const A = (await api("coachA", "create-team", { team_name: `Probe A ${stamp}` })).body;
  const B = (await api("coachB", "create-team", { team_name: `Probe B ${stamp}` })).body;
  orgs.push(A.org_id, B.org_id);
  const codeA = (await api("coachA", "create-invite", { team_id: A.team_id })).body.token;
  const codeB = (await api("coachB", "create-invite", { team_id: B.team_id })).body.token;
  const kid = (await api("parentA", "claim-invite", { token: codeA, child: { first_name: "Kid", last_name: `Probe${stamp}`, parent_relationship: "mother", contacts: [{ relationship: "mother", phone: "5555550100" }] } })).body;
  const fourteen = new Date(Date.now() - 14.5 * 365 * 86400000).toISOString().slice(0, 10);
  await api("parentA", "set-player-birthdate", { player_id: kid.player_id, birthdate: fourteen });
  const pcode = (await api("parentA", "create-player-invite", { player_id: kid.player_id })).body.code;
  const teenJoin = await api("teen", "claim-player-invite", { code: pcode });
  check("setup: the 14-year-old has a player account on team A", teenJoin.status === 200, JSON.stringify(teenJoin.body));

  const chatA = (await api("coachA", "team-chat", { team_id: A.team_id })).body.thread_id;
  const chatB = (await api("coachB", "team-chat", { team_id: B.team_id })).body.thread_id;
  const parentsOnly = (await api("coachA", "create-thread", { team_id: A.team_id, audience: "parents", title: "Parents only", body: "Carpool list" })).body.thread_id;
  const coachPost = await api("coachA", "post-message", { thread_id: chatA, body: "Welcome, team" });
  const coachMsg = coachPost.body?.id;
  check("setup: the coach can post in team chat", !!coachMsg, `status ${coachPost.status} ${JSON.stringify(coachPost.body)}`);
  const parentMsg = (await api("parentA", "post-message", { thread_id: chatA, body: "Hi coach" })).body.id;
  const ev = (await api("coachA", "save-event", { team_id: A.team_id, title: "Practice", event_type: "practice", starts_at: iso(3 * 86400000) })).body.event_ids[0];
  const soon = (await api("coachA", "save-event", { team_id: A.team_id, title: "Soon", event_type: "practice", starts_at: iso(3600000) })).body.event_ids[0];

  // ----- 1. Notification injection through save-event ---------------------------------------
  for (const who of ["outsider", "parentA"]) {
    const r = await api(who, "save-event", { team_id: A.team_id, event_id: ev, title: `HACK-${who}`, event_type: "practice", starts_at: iso(86400000) });
    await new Promise((s) => setTimeout(s, 1500));
    const sent = await sql(`select count(*)::int as n from notifications where team_id = '${A.team_id}' and subject like '%HACK-${who}%'`);
    check(`${who} can't edit team A's event or notify the team through save-event`, r.status === 403 && sent[0]?.n === 0, `status ${r.status} notifications ${JSON.stringify(sent)}`);
  }
  const evNow = await sql(`select title from events where id = '${ev}'`);
  check("team A's event title is unchanged", evNow[0]?.title === "Practice", JSON.stringify(evNow));

  // ----- 2. Reading another team's data straight from the database --------------------------
  for (const [table, filter] of [["players", `team_id=eq.${A.team_id}`], ["player_emergency_contacts", `player_id=eq.${kid.player_id}`], ["messages", `thread_id=eq.${chatA}`], ["events", `team_id=eq.${A.team_id}`], ["message_threads", `team_id=eq.${A.team_id}`], ["teams", `id=eq.${A.team_id}`], ["user_roles", `team_id=eq.${A.team_id}`], ["parent_player_links", `player_id=eq.${kid.player_id}`]]) {
    const r = await rest("outsider", "GET", `${table}?${filter}&select=*`);
    check(`outsider reads nothing from ${table}`, rows(r).length === 0, JSON.stringify(r.data).slice(0, 200));
  }
  const teenContacts = await rest("teen", "GET", `player_emergency_contacts?player_id=eq.${kid.player_id}&select=*`);
  check("the teen player can't read emergency contacts", rows(teenContacts).length === 0, JSON.stringify(teenContacts.data));
  const teenParents = await rest("teen", "GET", `messages?thread_id=eq.${parentsOnly}&select=body`);
  check("the teen player can't read the parents-only thread", rows(teenParents).length === 0, JSON.stringify(teenParents.data));
  const teenPostParents = await rest("teen", "POST", "messages", { thread_id: parentsOnly, author_id: users.teen.id, body: "teen in parents thread" });
  check("the teen player can't post in the parents-only thread", teenPostParents.status >= 400, `status ${teenPostParents.status}`);

  // ----- 3. Private adult<->minor messaging (D-009) at the database level -------------------
  const dm = await rest("parentA", "POST", "message_threads", { team_id: A.team_id, kind: "direct", audience: "both", title: "DM", created_by: users.parentA.id });
  const dmId = rows(dm)[0]?.id;
  check("an adult can't create a direct thread", !dmId, `status ${dm.status} ${JSON.stringify(dm.data).slice(0, 160)}`);
  if (dmId) {
    const add = await rest("parentA", "POST", "thread_participants", [{ thread_id: dmId, user_id: users.parentA.id }, { thread_id: dmId, user_id: users.teen.id }]);
    const post = await rest("parentA", "POST", "messages", { thread_id: dmId, author_id: users.parentA.id, body: "private to a minor" });
    const teenSees = await rest("teen", "GET", `messages?thread_id=eq.${dmId}&select=body`);
    check("…and can't privately message the teen", rows(teenSees).length === 0, `add ${add.status} post ${post.status} teen sees ${JSON.stringify(teenSees.data)}`);
  }
  const teenDm = await rest("teen", "POST", "message_threads", { team_id: A.team_id, kind: "group", audience: "both", title: "G", created_by: users.teen.id });
  check("the teen player can't create a group thread", !rows(teenDm)[0]?.id, `status ${teenDm.status}`);
  if (rows(teenDm)[0]?.id) {
    const add = await rest("teen", "POST", "thread_participants", [{ thread_id: rows(teenDm)[0].id, user_id: users.coachB.id }]);
    check("…or add an adult from another team to it", add.status >= 400, `status ${add.status}`);
  }

  // ----- 4. Tampering with your own message -----------------------------------------------
  const moved = await rest("parentA", "PATCH", `messages?id=eq.${parentMsg}`, { thread_id: chatB });
  const where = await sql(`select thread_id, created_at from messages where id = '${parentMsg}'`);
  check("a parent can't move their message into another team's chat", where[0]?.thread_id === chatA, `patch ${moved.status} now ${JSON.stringify(where)}`);
  const forged = await rest("parentA", "PATCH", `messages?id=eq.${parentMsg}`, { created_at: "2099-01-01T00:00:00Z" });
  const when = await sql(`select created_at from messages where id = '${parentMsg}'`);
  check("a parent can't change when their message was sent", !String(when[0]?.created_at).startsWith("2099"), `patch ${forged.status} now ${JSON.stringify(when)}`);
  const del = await api("parentA", "delete-message", { message_id: coachMsg });
  const coachStill = await sql(`select deleted_at from messages where id = '${coachMsg}'`);
  check("a parent can't delete the coach's message", coachStill[0]?.deleted_at === null, `status ${del.status} ${JSON.stringify(coachStill)}`);

  // ----- 5. Roles, teams and joining ---------------------------------------------------------
  const selfPromote = await rest("parentA", "POST", "user_roles", { user_id: users.parentA.id, role: "head_coach", team_id: A.team_id });
  check("a parent can't make themselves head coach", selfPromote.status >= 400, `status ${selfPromote.status}`);
  const link = await rest("outsider", "POST", "parent_player_links", { player_id: kid.player_id, parent_user_id: users.outsider.id, relationship: "other" });
  check("an outsider can't link themselves to someone else's child", link.status >= 400, `status ${link.status}`);
  const teenParent = await api("teen", "claim-invite", { token: codeB, child: { first_name: "Fake", last_name: "Kid", parent_relationship: "father", contacts: [{ relationship: "father", phone: "5555550199" }] } });
  check("a player account (minor) can't join another team as a parent", teenParent.status === 403, `status ${teenParent.status} ${JSON.stringify(teenParent.body)}`);
  const orgMove = await rest("coachA", "PATCH", `teams?id=eq.${A.team_id}`, { org_id: B.org_id });
  const orgNow = await sql(`select org_id from teams where id = '${A.team_id}'`);
  check("a coach can't move their team into another organization directly", orgNow[0]?.org_id === A.org_id, `patch ${orgMove.status}`);
  const color = await rest("coachA", "PATCH", `teams?id=eq.${A.team_id}`, { brand_color: "#123456" });
  const colorNow = await sql(`select brand_color from teams where id = '${A.team_id}'`);
  check("a free coach can't set a team color directly (Coach Pro)", colorNow[0]?.brand_color !== "#123456", `patch ${color.status}`);
  const late = await rest("parentA", "POST", "rsvps?on_conflict=event_id,player_id", { event_id: soon, player_id: kid.player_id, status: "yes", responded_by: users.parentA.id }, "resolution=merge-duplicates,return=representation");
  check("RSVPs after the cutoff are refused directly too", late.status >= 400, `status ${late.status}`);
  const lateApi = await api("parentA", "set-rsvp", { event_id: soon, player_id: kid.player_id, status: "yes" });
  check("…and through the API", lateApi.status === 409, `status ${lateApi.status}`);
  const susp = await rest("parentA", "PATCH", `profiles?id=eq.${users.parentA.id}`, { suspended_at: null, signup_via: "created_team" });
  check("a user can't edit admin-owned profile columns", susp.status >= 400 || rows(susp)[0]?.signup_via !== "created_team", `status ${susp.status} ${JSON.stringify(susp.data).slice(0, 120)}`);

  // ----- 6. API permission checks ------------------------------------------------------------
  for (const [action, params] of [["team-members", { team_id: A.team_id }], ["list-dues", { team_id: A.team_id }], ["create-invite", { team_id: A.team_id }], ["import-preview", { team_id: A.team_id, url: "https://docs.google.com/spreadsheets/d/x" }], ["delete-team", { team_id: A.team_id, confirm_name: `Probe A ${stamp}` }]]) {
    const r = await api("outsider", action, params);
    check(`outsider is refused: ${action}`, r.status === 403, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const listMsgs = await api("outsider", "list-messages", { thread_id: chatA });
  check("outsider can't list team A's messages", listMsgs.status === 404, `status ${listMsgs.status}`);
  const ann = await api("parentA", "create-announcement", { team_id: A.team_id, title: "Fake", body: "Not from the coach" });
  check("a parent can't post announcements", ann.status === 403, `status ${ann.status}`);
  const rsvpOther = await api("outsider", "set-rsvp", { event_id: ev, player_id: kid.player_id, status: "no" });
  check("outsider can't RSVP for someone's child", rsvpOther.status >= 400, `status ${rsvpOther.status}`);
  const report = await api("outsider", "report-content", { message_id: coachMsg, reason: "spam" });
  check("outsider can't report (or read) team A's messages", report.status === 404, `status ${report.status}`);

  // ----- 7. Garbage input never causes a server error ---------------------------------------
  const noAuth = await api(null, "context");
  check("no sign-in → 401", noAuth.status === 401, `status ${noAuth.status}`);
  const garbage = [
    ["not JSON", null, "{{{nope"],
    ["unknown action", { action: "drop-tables" }],
    ["SQL-ish team id", { action: "team-members", team_id: "x' or 1=1 --" }],
    ["number as text", { action: "update-profile", full_name: 42 }],
    ["huge name", { action: "update-profile", full_name: "x".repeat(10000) }],
    ["bad date", { action: "save-event", team_id: A.team_id, title: "x", starts_at: "not a date" }],
    ["huge repeat", { action: "save-event", team_id: A.team_id, title: "x", starts_at: iso(86400000), repeat_weeks: 1e9 }],
    ["object as text", { action: "post-message", thread_id: chatA, body: { a: 1 } }],
    ["array as id", { action: "list-messages", thread_id: [chatA] }],
    ["bad status", { action: "set-rsvp", event_id: ev, player_id: kid.player_id, status: "definitely" }],
    ["bad color", { action: "update-team", team_id: A.team_id, brand_color: "red; drop" }],
    ["dues amount", { action: "create-dues", team_id: A.team_id, title: "x", amount_cents: -500 }],
    ["dues date", { action: "create-dues", team_id: A.team_id, title: "x", amount_cents: 1000, due_date: "tomorrow-ish" }],
    ["dues player ids", { action: "create-dues", team_id: A.team_id, title: "x", amount_cents: 1000, player_ids: ["x", "y)"] }],
    ["usage events", { action: "track", events: [{ name: "x".repeat(500) }, 5, null, { name: "ok.event", props: { a: { b: 1 } } }] }],
  ];
  for (const [label, params, raw] of garbage) {
    const r = await api("coachA", params?.action ?? "context", params ?? {}, raw);
    check(`garbage input is a clean 4xx, not a crash: ${label}`, r.status < 500, `status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  const feed = await fetch(`${SUPABASE_URL}/functions/v1/calendar-feed/not-a-real-token.ics`);
  check("calendar feed with a made-up token → 404", feed.status === 404, `status ${feed.status}`);

  // ----- 8. A long chat still shows its newest messages ------------------------------------
  await sql(`insert into messages (thread_id, author_id, body, created_at)
    select '${chatA}', '${users.coachA.id}', 'old ' || g, now() - interval '30 days' + g * interval '1 minute' from generate_series(1, 520) g`);
  const newest = (await api("parentA", "post-message", { thread_id: chatA, body: `newest-${stamp}` })).body.id;
  const longChat = await api("parentA", "list-messages", { thread_id: chatA });
  const shown = longChat.body?.messages ?? [];
  check("a chat with 500+ messages still shows the newest one, last", shown.at(-1)?.id === newest && shown.length === 500,
    `${shown.length} messages, last = ${shown.at(-1)?.body}`);
} finally {
  const list = orgs.filter(Boolean).map((o) => `'${o}'`).join(",");
  if (list) await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id in (select id from teams where org_id in (${list})));
    delete from notifications where team_id in (select id from teams where org_id in (${list}));
    delete from teams where org_id in (${list}); delete from user_roles where org_id in (${list}); delete from organizations where id in (${list});`);
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from notification_sends where recipient_user_id in (${ids}); delete from audit_logs where actor_user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids}); delete from user_roles where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
