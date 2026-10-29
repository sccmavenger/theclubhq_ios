// Live check for D-042 (schedule import from a Google Sheets link) against the deployed
// mobile-api and the real 2026 CNR sheet. Throwaway users and team; all deleted at the end.
//   set -a; source .env.local; set +a; node supabase/tests/d042_live_check.mjs
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

const CNR = "https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vQoH24Yk3kQM7zd5_uX8JOXgwmHYN8pCKl8jAemdHtFo2ldPSo-sNFtJnQRF5Qsjre9JFGOstXi2urS/pubhtml?pli=1";
const ME = "6b-carter:3d-nation-2033-6th-boys";
const stamp = Date.now();
const users = {};
async function makeUser(role) {
  const email = `qa+d042-${role}-${stamp}@teamclubhq.com`, password = `Qa!${crypto.randomUUID()}`;
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
const events = (teamId) => sql(`select id, title, opponent, home_away, home_score, away_score, result, starts_at, location, location_address, notes, cancelled_at, external_key, import_id from events where team_id='${teamId}' order by starts_at`);

let team, other;
try {
  await makeUser("coach");
  await makeUser("stranger");
  team = (await api("coach", "create-team", { team_name: "3D Nation 6th Grade", heard_from: "friend_or_coach" })).body;
  other = (await api("stranger", "create-team", { team_name: "Arch City", heard_from: "friend_or_coach" })).body;
  const tz = { time_zone: "America/New_York" }; // The simulator's zone; the venues' zone must win.

  // ----- Preview ---------------------------------------------------------------
  const t0 = Date.now();
  const preview = await api("coach", "import-preview", { team_id: team.team_id, url: CNR, ...tz });
  const p = preview.body;
  check("preview reads the sheet", preview.status === 200 && p.games?.length === 112 && p.teams?.length === 76, `${preview.status} ${JSON.stringify(p).slice(0, 200)}`);
  check(`preview is quick enough (${Date.now() - t0} ms)`, Date.now() - t0 < 15000);
  check("tournament facts", p.source?.title === "2026 CNR October 3-4 Tournament" && p.source.time_zone === "America/Chicago" && p.source.home_note === "Home team wears white" && p.source.needs_dates === false, JSON.stringify(p.source));
  check("clear match on the team name", p.match?.outcome === "clear" && p.match.team_keys[0] === ME, JSON.stringify(p.match));
  const mine = p.games.filter((g) => g.left.team_key === ME || g.right.team_key === ME);
  check("three games, Central time", mine.map((g) => g.starts_at).join() === "2026-10-03T21:00:00.000Z,2026-10-03T23:00:00.000Z,2026-10-04T13:00:00.000Z", mine.map((g) => g.starts_at).join());
  const arch = await api("stranger", "import-preview", { team_id: other.team_id, url: CNR, ...tz });
  check("ambiguous name → a short list", arch.body.match?.outcome === "choices" && arch.body.match.team_keys.length >= 6, JSON.stringify(arch.body.match));

  // ----- Guards ----------------------------------------------------------------
  const forbidden = await api("stranger", "import-preview", { team_id: team.team_id, url: CNR });
  check("only the head coach can import", forbidden.status === 403, String(forbidden.status));
  // Any other web link is tried as a team calendar (D-047); text that isn't a link is refused outright.
  const bad = await api("coach", "import-preview", { team_id: team.team_id, url: "my schedule" });
  check("text that isn't a link is refused before fetching", bad.status === 422 && bad.body.error?.code === "not_a_sheet", JSON.stringify(bad.body));
  const page = await api("coach", "import-preview", { team_id: team.team_id, url: "https://example.com/schedule" });
  check("a web page that isn't a calendar explains itself", page.status === 422 && ["unreadable", "not_a_calendar"].includes(page.body.error?.code), JSON.stringify(page.body));
  const gone = await api("coach", "import-preview", { team_id: team.team_id, url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vDOESNOTEXISTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/pubhtml" });
  check("a missing sheet explains itself", gone.status === 422 && /couldn't find that sheet/i.test(gone.body.error?.message ?? ""), JSON.stringify(gone.body));

  // ----- Commit ----------------------------------------------------------------
  const notesBefore = (await sql(`select count(*)::int n from notifications where team_id='${team.team_id}'`))[0].n;
  const commit = await api("coach", "import-commit", { team_id: team.team_id, url: CNR, team_key: ME, ...tz });
  check("commit adds three games", commit.status === 200 && commit.body.added === 3 && commit.body.updated === 0 && commit.body.upcoming === 0, JSON.stringify(commit.body));
  let rows = await events(team.team_id);
  check("rows: opponents, home side, scores and results", JSON.stringify(rows.map((r) => [r.opponent, r.home_away, r.home_score, r.away_score, r.result])) ===
    JSON.stringify([["STL Grizzlies", "home", 26, 30, "loss"], ["Rise & Reign Maroon", "home", 50, 24, "win"], ["Arch city Select Gold", "home", 33, 37, "loss"]]), JSON.stringify(rows.map((r) => [r.opponent, r.home_away, r.home_score, r.away_score, r.result])));
  check("rows: venue, court and address", rows[0].location === "Beal Center · Court 6" && rows[0].location_address === "150 N. Eatherton Rd., Chesterfield, MO 63005" && rows[2].location === "Beal Center · Court 5", rows[0].location);
  check("rows: notes and title", rows[2].title === "3rd Place Game · 2026 CNR October 3-4 Tournament" && /Home team — wear white/.test(rows[0].notes), `${rows[2].title} | ${rows[0].notes}`);
  const notesAfter = (await sql(`select count(*)::int n from notifications where team_id='${team.team_id}'`))[0].n;
  check("importing sends no notifications", notesAfter === notesBefore, `${notesBefore} → ${notesAfter}`);

  // ----- Re-import: update, never duplicate --------------------------------------
  await sql(`update events set starts_at = starts_at + interval '2 hours', location = 'Moved' where id='${rows[0].id}'`);
  const again = await api("coach", "import-commit", { team_id: team.team_id, url: CNR, team_key: ME, ...tz });
  rows = await events(team.team_id);
  check("re-import updates in place, no copies", again.body.added === 0 && again.body.updated === 3 && rows.length === 3 && rows[0].location === "Beal Center · Court 6" && rows[0].starts_at.startsWith("2026-10-03 21:00"), `${JSON.stringify(again.body)} ${rows[0]?.starts_at}`);

  // A bracket game whose opponent was TBD and is now filled in keeps its row (same tab and round).
  const thirdKey = rows[2].external_key;
  await sql(`update events set external_key = '${thirdKey.split("|").slice(0, 2).join("|")}|placeholder~${ME}|1' where id='${rows[2].id}'`);
  // A game the organizer deleted from the sheet.
  await sql(`insert into events (team_id, title, event_type, starts_at, created_by, import_id, external_key) values ('${team.team_id}', 'Old game', 'game', '2026-10-04 15:00:00+00', '${users.coach.id}', '${commit.body.import_id}', '610861338|pool-b|gone~${ME}|1')`);
  const third = await api("coach", "import-commit", { team_id: team.team_id, url: CNR, team_key: ME, ...tz });
  rows = await events(team.team_id);
  const old = rows.find((r) => r.title === "Old game");
  check("a filled-in bracket slot updates the same row", third.body.added === 0 && third.body.updated === 3 && rows.find((r) => r.id === rows.find((x) => x.external_key === thirdKey)?.id), JSON.stringify(third.body));
  check("a game removed from the sheet is cancelled, not deleted", third.body.cancelled === 1 && old?.cancelled_at !== null, JSON.stringify(third.body));

  // ----- Change team -------------------------------------------------------------
  const swap = await api("coach", "import-commit", { team_id: team.team_id, url: CNR, team_key: "6b-carter:stl-grizzlies-6th-boys", ...tz });
  rows = await events(team.team_id);
  check("picking another team swaps the games", swap.body.removed === 4 && swap.body.added === 3 && rows.length === 3 && rows.every((r) => r.opponent !== "STL Grizzlies"), `${JSON.stringify(swap.body)} ${rows.map((r) => r.opponent)}`);
  const back = await api("coach", "import-commit", { team_id: team.team_id, url: CNR, team_key: ME, game_keys: mine.slice(0, 2).map((g) => g.key), ...tz });
  check("only the checked games are imported", back.body.added === 2 && (await events(team.team_id)).length === 2, JSON.stringify(back.body));

  // ----- CNR league site (D-043) ------------------------------------------------
  const LEAGUE = "https://cnrschedule.stlbasketball.com/";
  const lp = await api("coach", "import-preview", { team_id: team.team_id, url: LEAGUE, ...tz });
  const lmine = (lp.body.games ?? []).filter((g) => g.left.team_key === "3d-nation-2033-6th-boys" || g.right.team_key === "3d-nation-2033-6th-boys");
  check("league: preview finds the team with its games", lp.status === 200 && lp.body.source?.kind === "cnr_league" && lp.body.match?.team_keys?.[0] === "3d-nation-2033-6th-boys" && lmine.length >= 1 && /season=/.test(lp.body.source.url), `${lp.status} ${JSON.stringify(lp.body.match ?? lp.body).slice(0, 200)}`);
  check("league: teams not loaded yet have no game count", lp.body.teams?.some((t) => t.game_count === null), "");
  const wrapped = await api("coach", "import-preview", { team_id: team.team_id, url: "https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fcnrschedule.stlbasketball.com%2F&data=05%7C02%7C%7C4714301c0f684179d39808df3524bec7%7C84df9e7fe9f640afb435aaaaaaaaaaaa%7C1%7C0%7C639288104079698901%7CUnknown%7CTWFpbGZsb3d8eyJFbXB0eU1hcGkiOnRydWUsIlYiOiIwLjAuMDAwMCIsIlAiOiJXaW4zMiIsIkFOIjoiTWFpbCIsIldUIjoyfQ%3D%3D%7C0%7C%7C%7C&sdata=K1NXcVYJum5kjDiHppW0zY5seDICBZ%2Fpsa26%2B4X0Sl4%3D&reserved=0", ...tz });
  check("league: an Outlook Safe Links copy of the link works", wrapped.status === 200 && wrapped.body.source?.url === lp.body.source.url, `${wrapped.status} ${JSON.stringify(wrapped.body.error ?? {})}`);
  const ltp = await api("coach", "import-preview", { team_id: team.team_id, url: "webcal://cnrnovdec2026schedules.stlbasketball.com/3d-nation-2033-6th-boys.ics", ...tz });
  check("league: a calendar link picks the team directly", ltp.body.match?.outcome === "clear" && ltp.body.match.team_keys[0] === "3d-nation-2033-6th-boys", JSON.stringify(ltp.body.match ?? ltp.body));
  const kings = await api("coach", "import-preview", { team_id: team.team_id, url: LEAGUE, team_key: "kings-gold-6th-boys", ...tz });
  check("league: picking another team loads its games", kings.body.games?.some((g) => g.left.team_key === "kings-gold-6th-boys" || g.right.team_key === "kings-gold-6th-boys"), "");
  const shared = (body) => body.games?.find((g) => [g.left.team_key, g.right.team_key].sort().join() === "3d-nation-2033-6th-boys,kings-gold-6th-boys")?.key;
  check("league: the same game has the same key from either team's page", shared(lp.body) && shared(lp.body) === shared(kings.body), `${shared(lp.body)} vs ${shared(kings.body)}`);
  const lc = await api("coach", "import-commit", { team_id: team.team_id, url: LEAGUE, team_key: "3d-nation-2033-6th-boys", ...tz });
  const lrows = await sql(`select opponent, home_away, location, location_address, starts_at, external_key, home_score from events where import_id='${lc.body.import_id}' order by starts_at`);
  check("league: commit adds the upcoming games", lc.status === 200 && lc.body.added === lmine.length && lc.body.upcoming === lmine.length && lrows.every((r) => /~.*\|\d+$/.test(r.external_key)) && lrows.every((r) => r.home_score === null), JSON.stringify(lc.body).slice(0, 200));
  check("league: home/away and gym addresses", lrows.some((r) => r.home_away === "home") && lrows.some((r) => r.home_away === "away") && lrows.some((r) => r.location_address?.includes("MO")), JSON.stringify(lrows[0]));
  const lsaved = (await sql(`select source_url, source_kind from schedule_imports where id='${lc.body.import_id}'`))[0];
  const lagain = await api("coach", "import-commit", { team_id: team.team_id, url: lsaved.source_url, team_key: "3d-nation-2033-6th-boys", ...tz });
  check("league: Update from Sheet updates in place", lsaved.source_kind === "cnr_league" && lagain.body.added === 0 && lagain.body.updated === lmine.length, JSON.stringify(lagain.body).slice(0, 200));
  const stale = await api("coach", "import-commit", { team_id: team.team_id, url: "https://cnrschedule.stlbasketball.com/?season=2026-06-01", team_key: "3d-nation-2033-6th-boys", ...tz });
  check("league: an old season's import won't 'update' into the new season", stale.status === 422 && stale.body.error?.code === "season_over", JSON.stringify(stale.body));
  const lnotify = await api("coach", "import-notify", { import_id: lc.body.import_id });
  check("league: upcoming games can be announced once", lnotify.body.sent === true, JSON.stringify(lnotify.body));
  const summer = await api("coach", "import-commit", { team_id: team.team_id, url: "https://cnrsummer2026.stlbasketball.com/", team_key: "3d-nation-2033-6th-boys", ...tz });
  const srows = await sql(`select home_score, away_score, result from events where import_id='${summer.body.import_id}'`);
  check("league: a past season imports with final scores", summer.status === 200 && summer.body.added >= 7 && srows.every((r) => r.result !== null), `${JSON.stringify(summer.body).slice(0, 160)} ${JSON.stringify(srows[0])}`);
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/schedule_imports?team_id=eq.${team.team_id}&select=id,title,last_imported_at,events(starts_at,cancelled_at)`, {
    headers: { apikey: ANON, Authorization: `Bearer ${users.coach.jwt}` },
  });
  const list = await listRes.json();
  check("the imports list includes each import's game times (coach's own permissions)", listRes.status === 200 && list.length >= 2 && list.every((i) => Array.isArray(i.events) && i.events.length > 0), `${listRes.status} ${JSON.stringify(list).slice(0, 160)}`);
  const strangerList = await (await fetch(`${SUPABASE_URL}/rest/v1/schedule_imports?team_id=eq.${team.team_id}&select=id`, { headers: { apikey: ANON, Authorization: `Bearer ${users.stranger.jwt}` } })).json();
  check("other teams' coaches can't see this team's imports", Array.isArray(strangerList) && strangerList.length === 0, JSON.stringify(strangerList));

  // ----- Keep Games, Remove from List -------------------------------------------
  const strangerDetach = await api("stranger", "import-detach", { import_id: summer.body.import_id });
  check("only the head coach can remove an import from the list", strangerDetach.status === 403, String(strangerDetach.status));
  const detach = await api("coach", "import-detach", { import_id: summer.body.import_id });
  const keptRows = await sql(`select id, import_id, result from events where team_id='${team.team_id}' and external_key like '%~%' and starts_at < '2026-08-01'`);
  const summerImport = await sql(`select count(*)::int n from schedule_imports where id='${summer.body.import_id}'`);
  check("keep games: the import leaves the list, the games and scores stay", detach.status === 200 && detach.body.kept === summer.body.added && summerImport[0].n === 0 && keptRows.length === summer.body.added && keptRows.every((r) => r.import_id === null && r.result !== null), `${JSON.stringify(detach.body)} ${keptRows.length}`);
  const rePreview = await api("coach", "import-preview", { team_id: team.team_id, url: "https://cnrsummer2026.stlbasketball.com/", ...tz });
  check("keep games: the preview knows they're already on the schedule and doesn't call them clashes", rePreview.body.kept_keys?.length === summer.body.added && !rePreview.body.existing_events?.some((e) => keptRows.some((k) => k.id === e.id)), `${rePreview.body.kept_keys?.length} kept, ${rePreview.body.existing_events?.length} clashes`);
  const reimport = await api("coach", "import-commit", { team_id: team.team_id, url: "https://cnrsummer2026.stlbasketball.com/", team_key: "3d-nation-2033-6th-boys", ...tz });
  const afterRe = await sql(`select count(*)::int n, count(distinct import_id)::int i from events where team_id='${team.team_id}' and starts_at < '2026-08-01' and external_key like '%~%'`);
  check("keep games: importing the same link again reattaches them, no copies", reimport.body.added === 0 && reimport.body.updated === summer.body.added && afterRe[0].n === summer.body.added && afterRe[0].i === 1, `${JSON.stringify(reimport.body).slice(0, 160)} ${JSON.stringify(afterRe[0])}`);
  summer.body.import_id = reimport.body.import_id;
  await api("coach", "import-undo", { import_id: lc.body.import_id });
  await api("coach", "import-undo", { import_id: summer.body.import_id });

  // ----- Remembered, notify, undo, report -------------------------------------
  const aliases = await sql(`select alias from schedule_team_aliases where team_id='${team.team_id}' order by alias`);
  check("the pairing is remembered", aliases.some((a) => a.alias === "3d nation 2033"), JSON.stringify(aliases));
  const re = await api("coach", "import-preview", { team_id: team.team_id, url: CNR, ...tz });
  check("preview knows about the earlier import", re.body.previous_import?.event_count === 2 && re.body.match.team_keys[0] === ME, JSON.stringify(re.body.previous_import));
  const notifyPast = await api("coach", "import-notify", { import_id: back.body.import_id });
  check("no notification for a tournament that already happened", notifyPast.status === 200 && notifyPast.body.sent === false, JSON.stringify(notifyPast.body));
  const strangerUndo = await api("stranger", "import-undo", { import_id: back.body.import_id });
  check("only the head coach can undo", strangerUndo.status === 403, String(strangerUndo.status));
  const undo = await api("coach", "import-undo", { import_id: back.body.import_id });
  const left = (await sql(`select count(*)::int n from events where team_id='${team.team_id}' and import_id is not null`))[0].n;
  const imports = (await sql(`select count(*)::int n from schedule_imports where team_id='${team.team_id}'`))[0].n;
  check("undo removes the imported games", undo.body.removed === 2 && left === 0 && imports === 0, `${JSON.stringify(undo.body)} left=${left}`);
  const report = await api("coach", "import-report", { team_id: team.team_id, url: CNR, reason: "team_missing", note: "QA" });
  const stored = (await sql(`select count(*)::int n from schedule_import_reports where user_id='${users.coach.id}'`))[0].n;
  check("reports are stored", report.status === 200 && stored === 1, JSON.stringify(report.body));
} finally {
  const teams = [team, other].filter((t) => t?.team_id);
  for (const t of teams) {
    await sql(`delete from events where team_id='${t.team_id}'; delete from schedule_imports where team_id='${t.team_id}';
      delete from notification_sends where notification_id in (select id from notifications where team_id='${t.team_id}');
      delete from notifications where team_id='${t.team_id}'; delete from teams where id='${t.team_id}'; delete from organizations where id='${t.org_id}';`);
  }
  const ids = Object.values(users).map((u) => `'${u.id}'`).join(",");
  if (ids) await sql(`delete from schedule_import_reports where user_id in (${ids}); delete from usage_events where user_id in (${ids}); delete from user_activity_days where user_id in (${ids});`);
  for (const u of Object.values(users)) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: adminHeaders });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
