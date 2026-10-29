// Live check for D-047 (team calendar import from an .ics link) against the deployed mobile-api
// and scheduled-jobs. The "other app" is a real feed: a throwaway ClubHQ team's own calendar
// subscription (calendar-feed). Throwaway users and teams; all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d047_live_check.mjs
import { readFileSync } from "node:fs";
const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF } = process.env;
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_REF) throw new Error("source .env.local first");
const DISPATCH = readFileSync(new URL("../../.secrets/apns-dispatch-secret", import.meta.url), "utf8").trim();
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
  const email = `qa+d047-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
  const created = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  users[role] = { id: created.id, email, jwt: s.access_token };
}
const api = async (role, action, params = {}) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mobile-api`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${users[role].jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  return { status: res.status, body: await res.json() };
};
const day = (n, hourUTC) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); d.setUTCHours(hourUTC, 0, 0, 0); return d.toISOString(); };
const events = (teamId) => sql(`select id, title, event_type, opponent, home_away, starts_at, ends_at, location, cancelled_at, external_key, import_id, home_score from events where team_id='${teamId}' order by starts_at`);

let source, team;
try {
  await makeUser("source");
  await makeUser("coach");
  await makeUser("stranger");
  source = (await api("source", "create-team", { team_name: "Hawks 12U", heard_from: "friend_or_coach" })).body;
  team = (await api("coach", "create-team", { team_name: "Hawks 12U", heard_from: "friend_or_coach" })).body;
  const ins = (title, type, start, mins, extra = "") => `insert into events (team_id, created_by, title, event_type, starts_at, ends_at, location ${extra ? ", opponent, home_away" : ""})
    values ('${source.team_id}', '${users.source.id}', '${title}', '${type}', '${start}', '${new Date(Date.parse(start) + mins * 60000).toISOString()}', 'Central Gym' ${extra});`;
  await sql([
    ins("Game", "game", day(3, 15), 60, ", 'Lions', 'home'"),
    ins("Game", "game", day(5, 16), 60, ", 'Tigers', 'away'"),
    ins("Practice", "practice", day(4, 23), 90),
    ins("Practice", "practice", day(6, 23), 90),
    ins("Team photo", "other", day(7, 17), 30),
  ].join("\n"));
  const feed = (await api("source", "calendar-feed")).body.url;
  check("source team has a calendar link", typeof feed === "string" && /\.ics$/.test(feed), JSON.stringify(feed));
  const webcal = feed.replace(/^https:/, "webcal:");

  // ----- Preview ---------------------------------------------------------------
  const preview = await api("coach", "import-preview", { team_id: team.team_id, url: webcal, time_zone: "America/Chicago" });
  const p = preview.body;
  check("preview reads the feed as a calendar", preview.status === 200 && p.source?.kind === "ical" && p.match?.outcome === "clear" && p.match.team_keys[0] === "calendar", `${preview.status} ${JSON.stringify(p).slice(0, 300)}`);
  const types = (p.games ?? []).map((g) => g.event_type).join();
  check("games, practices and other events", types === "game,practice,game,practice,other", types);
  const labels = (p.games ?? []).filter((g) => g.event_type === "game").map((g) => [g.right.name, g.home_away]);
  check("opponents and home/away from the titles", JSON.stringify(labels) === JSON.stringify([["Lions", "home"], ["Tigers", "away"]]), JSON.stringify(labels) + " " + (p.games ?? []).map((g) => g.title).join(" | "));

  // ----- Guards ----------------------------------------------------------------
  const forbidden = await api("stranger", "import-preview", { team_id: team.team_id, url: webcal });
  check("only the head coach can import", forbidden.status === 403, String(forbidden.status));
  const priv = await api("coach", "import-preview", { team_id: team.team_id, url: "http://169.254.169.254/latest/meta-data" });
  check("private-network links are refused before fetching", priv.status === 422 && priv.body.error?.code === "not_a_sheet", JSON.stringify(priv.body));
  const page = await api("coach", "import-preview", { team_id: team.team_id, url: "https://www.teamsnap.com/" });
  check("a web page explains where the calendar link is", page.status === 422 && page.body.error?.code === "not_a_calendar" && /TeamSnap/.test(page.body.error.message), JSON.stringify(page.body));
  const holidays = await api("coach", "import-preview", { team_id: team.team_id, url: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics" });
  check("an all-day-only calendar (Google holidays) has nothing to import", holidays.status === 422 && holidays.body.error?.code === "no_games", JSON.stringify(holidays.body).slice(0, 200));

  // ----- Commit (one practice unticked) ----------------------------------------
  const keysAll = p.games.map((g) => g.key);
  const skipped = p.games.find((g) => g.event_type === "practice" && g.starts_at === p.games.filter((x) => x.event_type === "practice")[1].starts_at).key;
  const commit = await api("coach", "import-commit", { team_id: team.team_id, url: webcal, team_key: "calendar", game_keys: keysAll.filter((k) => k !== skipped), time_zone: "America/Chicago" });
  check("commit adds four events", commit.status === 200 && commit.body.added === 4, JSON.stringify(commit.body));
  let rows = await events(team.team_id);
  check("rows keep their types, opponents and lengths", JSON.stringify(rows.map((r) => [r.event_type, r.opponent, r.home_away, (Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60000])) ===
    JSON.stringify([["game", "Lions", "home", 60], ["practice", null, null, 90], ["game", "Tigers", "away", 60], ["other", null, null, 30]]), JSON.stringify(rows.map((r) => [r.event_type, r.opponent, r.home_away, r.ends_at])));
  const imp = (await sql(`select id, source_kind, skipped_keys from schedule_imports where team_id='${team.team_id}'`))[0];
  check("import is stored as ical with the skipped key", imp?.source_kind === "ical" && imp.skipped_keys?.length === 1, JSON.stringify(imp));
  // A coach's score must survive re-checks.
  await sql(`update events set home_score = 41, away_score = 30, result = 'win' where id='${rows[0].id}'`);

  // ----- Source changes, then the automatic re-check -----------------------------
  const lionsSource = (await sql(`select id from events where team_id='${source.team_id}' and opponent='Lions'`))[0].id;
  await sql(`update events set starts_at = '${day(3, 16)}', ends_at = '${day(3, 17)}' where id='${lionsSource}';
    update events set cancelled_at = now() where team_id='${source.team_id}' and title='Team photo';
    update schedule_imports set last_checked_at = now() - interval '30 minutes' where id='${imp.id}';`);
  const notesBefore = (await sql(`select count(*)::int n from notifications where team_id='${team.team_id}'`))[0].n;
  const job = await fetch(`${SUPABASE_URL}/functions/v1/scheduled-jobs`, { method: "POST", headers: { Authorization: `Bearer ${DISPATCH}` } });
  const jobBody = await job.json();
  check("scheduled-jobs re-checks calendars", job.status === 200 && jobBody.rechecks?.checked >= 1 && jobBody.rechecks.failed === 0, JSON.stringify(jobBody));
  rows = await events(team.team_id);
  const lions = rows.find((r) => r.opponent === "Lions");
  check("moved game has its new time and keeps the coach's score", Date.parse(lions.starts_at.replace(" ", "T").replace(/\+00$/, "Z")) === Date.parse(day(3, 16)) && lions.home_score === 41, JSON.stringify(lions));
  check("removed event is cancelled, not deleted", rows.find((r) => r.event_type === "other")?.cancelled_at !== null, JSON.stringify(rows.map((r) => [r.title, r.cancelled_at])));
  check("unticked practice stays out", rows.length === 4, String(rows.length));
  const notes = await sql(`select subject, body from notifications where team_id='${team.team_id}' order by created_at desc`);
  check("families get one change alert", notes.length === notesBefore + 1 && /^Schedule changes: /.test(notes[0].subject) && /Lions now/.test(notes[0].body) && /cancelled/.test(notes[0].body), JSON.stringify(notes[0]));
  const after = (await sql(`select last_checked_at, check_failures, check_error from schedule_imports where id='${imp.id}'`))[0];
  check("the re-check is recorded", Date.now() - Date.parse(after.last_checked_at) < 120000 && after.check_failures === 0 && after.check_error === null, JSON.stringify(after));

  // ----- No changes: nothing sent ------------------------------------------------
  await sql(`update schedule_imports set last_checked_at = now() - interval '30 minutes' where id='${imp.id}'`);
  await fetch(`${SUPABASE_URL}/functions/v1/scheduled-jobs`, { method: "POST", headers: { Authorization: `Bearer ${DISPATCH}` } });
  const notes2 = (await sql(`select count(*)::int n from notifications where team_id='${team.team_id}'`))[0].n;
  check("an unchanged calendar sends nothing", notes2 === notesBefore + 1, `${notes2}`);

  // ----- Manual Check for Changes, then Remove Games ---------------------------
  await sql(`update events set location = 'North Gym' where id='${lionsSource}'`);
  await new Promise((r) => setTimeout(r, 2500));
  await sql(`delete from sheet_fetch_cache where url like '%calendar-feed%'`);
  const manual = await api("coach", "import-commit", { team_id: team.team_id, url: webcal, team_key: "calendar", time_zone: "America/Chicago" });
  check("Check for Changes updates and tells families", manual.status === 200 && manual.body.updated === 3 && manual.body.added === 0 && manual.body.notified === true, JSON.stringify(manual.body));
  const undo = await api("coach", "import-undo", { import_id: imp.id });
  check("Remove Games removes them", undo.status === 200 && undo.body.removed === 4, JSON.stringify(undo.body));
} finally {
  for (const t of [source, team].filter((t) => t?.team_id)) {
    await sql(`delete from events where team_id='${t.team_id}'; delete from schedule_imports where team_id='${t.team_id}';
      delete from notification_sends where notification_id in (select id from notifications where team_id='${t.team_id}');
      delete from notifications where team_id='${t.team_id}'; delete from teams where id='${t.team_id}'; delete from organizations where id='${t.org_id}';`);
  }
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from calendar_feeds where user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
