// Clubs Phase 0 (D-044): in a club with two teams, coaches see only their team; the director sees
// every team and its team chat, but not private threads. Throwaway accounts, all deleted.
//   set -a; source .env.local; set +a; node supabase/tests/d044_phase0_check.mjs
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` } })).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key, ANON = keys.find((k) => k.name === "anon").api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const sql = (query) => fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }).then((r) => r.json());
let passed = 0; const failures = [];
const check = (name, ok, detail = "") => { ok ? passed++ : failures.push(`${name} ${detail}`); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };
const stamp = Date.now(), users = {};
async function makeUser(role) {
  const email = `qa+d044-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: u.id, jwt: s.access_token };
}
const rest = async (role, path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}` } });
  return r.ok ? await r.json() : [];
};
let org;
try {
  for (const r of ["coachA", "coachB", "director", "parentA"]) await makeUser(r);
  org = (await sql(`insert into organizations (name, type, created_by, club_approved_at) values ('QA Club ${stamp}', 'club', '${users.director.id}', now()) returning id`))[0].id;
  const [ta, tb] = (await sql(`insert into teams (org_id, name, created_by) values ('${org}', 'QA Club A', '${users.coachA.id}'), ('${org}', 'QA Club B', '${users.coachB.id}') returning id`)).map((r) => r.id);
  await sql(`insert into user_roles (user_id, role, team_id, org_id) values
      ('${users.coachA.id}', 'head_coach', '${ta}', '${org}'), ('${users.coachB.id}', 'head_coach', '${tb}', '${org}'),
      ('${users.director.id}', 'program_director', null, '${org}'), ('${users.parentA.id}', 'parent', '${ta}', null);`);
  const pa = (await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${ta}', 'Ava', 'A', '${users.coachA.id}') returning id`))[0].id;
  await sql(`insert into players (team_id, first_name, last_name, created_by) values ('${tb}', 'Ben', 'B', '${users.coachB.id}');
    insert into parent_player_links (player_id, parent_user_id, relationship) values ('${pa}', '${users.parentA.id}', 'mother');
    insert into events (team_id, title, event_type, starts_at, created_by) values ('${ta}', 'A practice', 'practice', now() + interval '3 days', '${users.coachA.id}'), ('${tb}', 'B practice', 'practice', now() + interval '3 days', '${users.coachB.id}');`);
  const teamChat = (await sql(`insert into message_threads (team_id, kind, audience, title, created_by) values ('${ta}', 'team', 'both', 'Team chat', '${users.coachA.id}') returning id`))[0].id;
  const direct = (await sql(`insert into message_threads (team_id, kind, audience, title, created_by) values ('${ta}', 'direct', 'both', 'Coach and parent', '${users.coachA.id}') returning id`))[0].id;
  await sql(`insert into thread_participants (thread_id, user_id) values ('${direct}', '${users.coachA.id}'), ('${direct}', '${users.parentA.id}');
    insert into messages (thread_id, author_id, body) values ('${teamChat}', '${users.coachA.id}', 'Practice moved'), ('${direct}', '${users.parentA.id}', 'Private note');`);

  const names = (rows) => rows.map((r) => r.first_name ?? r.title ?? r.body).sort().join(",");
  check("coach B can't see team A's roster", names(await rest("coachB", `players?team_id=eq.${ta}&select=first_name`)) === "", names(await rest("coachB", `players?team_id=eq.${ta}&select=first_name`)));
  check("coach B can't see team A's events", names(await rest("coachB", `events?team_id=eq.${ta}&select=title`)) === "");
  check("coach A still sees their own team", names(await rest("coachA", `players?team_id=eq.${ta}&select=first_name`)) === "Ava");
  check("the director sees every team's roster", names(await rest("director", `players?team_id=in.(${ta},${tb})&select=first_name`)) === "Ava,Ben", names(await rest("director", `players?team_id=in.(${ta},${tb})&select=first_name`)));
  check("the director sees every team's events", names(await rest("director", `events?team_id=in.(${ta},${tb})&select=title`)) === "A practice,B practice");
  check("the director reads team chat", names(await rest("director", `messages?thread_id=eq.${teamChat}&select=body`)) === "Practice moved");
  check("the director can't read a private thread", names(await rest("director", `messages?thread_id=eq.${direct}&select=body`)) === "" && (await rest("director", `message_threads?id=eq.${direct}&select=id`)).length === 0);
  check("the parent still reads team chat and their private thread", names(await rest("parentA", `messages?thread_id=in.(${teamChat},${direct})&select=body`)) === "Practice moved,Private note");
  check("the parent can't see the other team", (await rest("parentA", `players?team_id=eq.${tb}&select=id`)).length === 0);
  check("coach B can't read team A's chat", (await rest("coachB", `messages?thread_id=eq.${teamChat}&select=body`)).length === 0);
} finally {
  if (org) await sql(`delete from messages where thread_id in (select id from message_threads where team_id in (select id from teams where org_id='${org}'));
    delete from message_threads where team_id in (select id from teams where org_id='${org}'); delete from teams where org_id='${org}'; delete from user_roles where org_id='${org}'; delete from organizations where id='${org}';`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
