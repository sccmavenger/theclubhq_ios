// Live check for D-037 (weekly repeats keep local time across Daylight Saving).
// Throwaway coach, parent, and team in production; everything is deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d037_live_check.mjs
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
  const email = `qa+d037-${role}-${Date.now()}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
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
const startsOf = async (ids) => (await sql(`select starts_at, ends_at from events where id in (${ids.map((i) => `'${i}'`).join(",")}) order by starts_at`))
  .map((r) => [new Date(r.starts_at).toISOString(), new Date(r.ends_at).toISOString()]);

let teamA, teamB;
try {
  await makeUser("coach");
  teamA = (await api("coach", "create-team", { team_name: `QA D037 A ${Date.now()}` })).body;
  check("team starts with no time zone", (await sql(`select time_zone from teams where id='${teamA.team_id}'`))[0].time_zone === null);

  // Sun Oct 25, 2026 6:00–7:30 PM CDT, weekly ×3: crosses the Nov 1 change.
  const saved = await api("coach", "save-event", {
    team_id: teamA.team_id, title: "Practice", event_type: "practice", repeat_weeks: 2, time_zone: "America/Chicago",
    starts_at: "2026-10-25T23:00:00.000Z", ends_at: "2026-10-26T00:30:00.000Z",
  });
  check("new app: weekly repeats keep 6:00 PM local across Daylight Saving", JSON.stringify(await startsOf(saved.body.event_ids)) === JSON.stringify([
    ["2026-10-25T23:00:00.000Z", "2026-10-26T00:30:00.000Z"],
    ["2026-11-02T00:00:00.000Z", "2026-11-02T01:30:00.000Z"],
    ["2026-11-09T00:00:00.000Z", "2026-11-09T01:30:00.000Z"],
  ]), JSON.stringify(await startsOf(saved.body.event_ids)));
  check("head coach's zone is remembered on the team", (await sql(`select time_zone from teams where id='${teamA.team_id}'`))[0].time_zone === "America/Chicago");

  // An older build sends no time_zone: the team's remembered zone is used.
  const old = await api("coach", "save-event", {
    team_id: teamA.team_id, title: "Practice", event_type: "practice", repeat_weeks: 1,
    starts_at: "2026-10-27T23:00:00.000Z", ends_at: "2026-10-28T00:30:00.000Z",
  });
  check("older build: uses the team's zone", (await startsOf(old.body.event_ids))[1][0] === "2026-11-04T00:00:00.000Z", JSON.stringify(await startsOf(old.body.event_ids)));

  const bogus = await api("coach", "save-event", {
    team_id: teamA.team_id, title: "Scrimmage", event_type: "practice", time_zone: "Mars/Olympus_Mons", starts_at: "2026-10-29T23:00:00.000Z",
  });
  check("unknown zone is ignored, not an error", bogus.status === 200 && (await sql(`select time_zone from teams where id='${teamA.team_id}'`))[0].time_zone === "America/Chicago");

  await new Promise((r) => setTimeout(r, 3000)); // notifications fan out in the background
  const bodies = (await sql(`select body from notifications where team_id='${teamA.team_id}' order by created_at`)).map((n) => n.body);
  check("notifications show local time", bodies.some((b) => b.includes("Sun, Oct 25, 6:00 PM")) && !bodies.some((b) => b.includes("UTC")), JSON.stringify(bodies));

  await api("coach", "cancel-event", { event_id: saved.body.event_ids[1], time_zone: "America/Chicago" });
  await new Promise((r) => setTimeout(r, 3000));
  const cancelled = (await sql(`select body from notifications where team_id='${teamA.team_id}' and subject like 'Cancelled%'`))[0]?.body ?? "";
  check("cancel notice shows local time", cancelled.includes("Sun, Nov 1, 6:00 PM"), cancelled);

  // A team that has never saved from a new build keeps the old fixed-day behavior.
  await makeUser("coach2");
  teamB = (await api("coach2", "create-team", { team_name: `QA D037 B ${Date.now()}` })).body;
  if (teamB.team_id) {
    const legacy = await api("coach2", "save-event", {
      team_id: teamB.team_id, title: "Practice", event_type: "practice", repeat_weeks: 1, starts_at: "2026-10-25T23:00:00.000Z",
    });
    check("no zone anywhere: unchanged fixed 7-day step", (await startsOf(legacy.body.event_ids))[1][0] === "2026-11-01T23:00:00.000Z");
  } else {
    console.log("SKIP  second team (free plan allows one head-coach team)");
  }
} finally {
  for (const t of [teamA, teamB].filter((t) => t?.team_id)) {
    await sql(`delete from notification_sends where notification_id in (select id from notifications where team_id='${t.team_id}');
      delete from notifications where team_id='${t.team_id}'; delete from teams where id='${t.team_id}'; delete from organizations where id='${t.org_id}';`);
  }
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
