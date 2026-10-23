// Live check for D-038 (Join is safe to retry). Throwaway users and team; deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d038_live_check.mjs
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
const users = {};
async function makeUser(role) {
  const email = `qa+d038-${role}-${Date.now()}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const created = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: created.id, jwt: s.access_token };
}
const api = async (role, action, params = {}) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }),
  });
  return { status: res.status, body: await res.json() };
};
const child = { first_name: "Riley", last_name: "Smith", parent_relationship: "father", contacts: [{ relationship: "father", phone: "5555550199" }] };

let team;
try {
  await Promise.all(["coach", "family"].map(makeUser));
  team = (await api("coach", "create-team", { team_name: `QA D038 ${Date.now()}` })).body;
  const token = (await api("coach", "create-invite", { team_id: team.team_id })).body.token;

  // The owner's case: the head coach joins their own team as a parent.
  const first = await api("coach", "claim-invite", { token, child });
  check("head coach joins own team as a parent", first.status === 200 && !!first.body.player_id, JSON.stringify(first.body));
  const again = await api("coach", "claim-invite", { token, child });
  check("same Join sent again returns the same child", again.status === 200 && again.body.player_id === first.body.player_id, JSON.stringify(again.body));
  const count = (await sql(`select count(*)::int n from players where team_id='${team.team_id}'`))[0].n;
  check("no duplicate child created", count === 1, `${count} players`);

  // A different family with a same-named child still gets the duplicate warning.
  const other = await api("family", "claim-invite", { token, child });
  check("another family's same-named child still warns", other.status === 409 && other.body.error?.code === "possible_duplicate", JSON.stringify(other.body));
  const confirmed = await api("family", "claim-invite", { token, child, allow_duplicate: true });
  check("…and can confirm it's a different child", confirmed.status === 200 && confirmed.body.player_id !== first.body.player_id);
  const retryOther = await api("family", "claim-invite", { token, child });
  check("that family's retry now resolves to their own child", retryOther.status === 200 && retryOther.body.player_id === confirmed.body.player_id, JSON.stringify(retryOther.body));
  const kids = (await sql(`select count(*)::int n from players where team_id='${team.team_id}'`))[0].n;
  check("exactly two children on the roster", kids === 2, `${kids}`);
} finally {
  if (team?.team_id) {
    await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id='${team.team_id}');
      delete from notifications where team_id='${team.team_id}'; delete from teams where id='${team.team_id}'; delete from organizations where id='${team.org_id}';`);
  }
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
