// Throwaway QA team in production for hands-on testing (simulator, Swift client).
//
//   set -a; source .env.local; set +a
//   node supabase/tests/qa_fixture.mjs setup      # writes logins to /tmp/clubhq-qa.json
//   node supabase/tests/qa_fixture.mjs teardown   # deletes the users, team, and photos
//
// Logins live only in /tmp (never in the repo). Accounts use qa+fixture-*@teamclubhq.com.
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const STATE = "/tmp/clubhq-qa.json";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` },
})).json();
const SERVICE = keys.find((k) => k.name === "service_role").api_key;
const ANON = keys.find((k) => k.name === "anon").api_key;
const adminHeaders = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

async function makeUser(role, fullName) {
  const email = `qa+fixture-${role}-${Date.now()}@teamclubhq.com`;
  const password = `QaFixture-${crypto.randomUUID().slice(0, 8)}`;
  const created = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
  })).json();
  const session = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  })).json();
  return { id: created.id, email, password, jwt: session.access_token, fullName };
}

async function api(user, action, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${user.jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${action}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function setup() {
  const coach = await makeUser("coach", "QA Coach");
  const parent = await makeUser("parent", "QA Parent");
  await api(coach, "update-profile", { full_name: "QA Coach" });
  await api(parent, "update-profile", { full_name: "QA Parent" });
  const team = await api(coach, "create-team", { team_name: "QA Mavericks 6th", sport: "basketball", age_group: "6th grade" });
  const invite = await api(coach, "create-invite", { team_id: team.team_id });
  await api(parent, "claim-invite", {
    token: invite.token,
    child: { first_name: "Riley", last_name: "Qatest", parent_relationship: "father", contacts: [{ relationship: "father", phone: "5555550123" }] },
  });
  const day = (n, hourUTC) => { const d = new Date(Date.now() + n * 86_400_000); d.setUTCHours(hourUTC, 0, 0, 0); return d; };
  const practice = await api(coach, "save-event", {
    team_id: team.team_id, title: "Practice", event_type: "practice", starts_at: day(2, 23).toISOString(),
    ends_at: new Date(day(2, 23).getTime() + 90 * 60_000).toISOString(), location: "Lincoln Middle School Gym", repeat_weeks: 2,
  });
  await api(coach, "save-event", {
    team_id: team.team_id, title: "Game", event_type: "game", opponent: "Rockets", home_away: "home",
    starts_at: day(5, 15).toISOString(), location: "Rec-Plex North, Court 3",
  });
  await api(coach, "cancel-event", { event_id: practice.event_ids[2] });
  const state = { teamId: team.team_id, orgId: team.org_id, inviteToken: invite.token, coach, parent };
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ team: "QA Mavericks 6th", coach: { email: coach.email, password: coach.password }, parent: { email: parent.email, password: parent.password } }, null, 2));
}

async function teardown() {
  const state = JSON.parse(readFileSync(STATE, "utf8"));
  const paths = await sql(`select name from storage.objects where bucket_id = 'chat-photos' and name like '${state.teamId}/%'`);
  if (Array.isArray(paths) && paths.length > 0) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/chat-photos`, {
      method: "DELETE", headers: adminHeaders, body: JSON.stringify({ prefixes: paths.map((p) => p.name) }),
    });
  }
  await sql(`
    delete from public.notification_sends where notification_id in (select id from public.notifications where team_id = '${state.teamId}');
    delete from public.notifications where team_id = '${state.teamId}';
    delete from public.teams where id = '${state.teamId}';
    delete from public.organizations where id = '${state.orgId}';`);
  for (const u of [state.coach, state.parent]) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  }
  rmSync(STATE);
  console.log("removed", JSON.stringify(await sql(`select (select count(*) from auth.users where email like 'qa+fixture-%') users, (select count(*) from public.teams where id = '${state.teamId}') teams`)));
}

const command = process.argv[2];
if (command === "setup") await setup();
else if (command === "teardown") await teardown();
else console.log("usage: qa_fixture.mjs setup | teardown");
