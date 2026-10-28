// CNR league import (D-043), against saved pages from the current season (Nov–Dec 2026, fetched
// 2026-10-28) and the finished Summer 2026 season.
//   npx deno test --allow-read supabase/tests/cnrLeague_test.ts
import {
  buildGames,
  buildIndex,
  canonicalLeagueURL,
  fetchLeagueIndex,
  fetchTeamGames,
  leagueSlug,
  leagueTournament,
  parseCalendarURL,
  parseFacilityAddress,
  parseFeedUIDs,
  parseLeagueURL,
  parseTeamGames,
} from "../functions/_shared/cnrLeague.ts";
import { gamesForTeam, localToISO, ourSide, scoreTeams } from "../functions/_shared/sheetImport.ts";

function assertEquals(actual: unknown, expected: unknown, label = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\n     got ${a}`);
}
async function assertRejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    if ((e as { code?: string }).code === code) return;
    throw new Error(`expected ${code}, got ${(e as Error).message}`);
  }
  throw new Error(`expected ${code}, got success`);
}

const dir = new URL("./fixtures/cnr-league/", import.meta.url);
const read = (f: string) => Deno.readTextFileSync(new URL(f, dir));
const ME = "3d-nation-2033-6th-boys";
const current = buildIndex("cnrschedule.stlbasketball.com", read("current-home.html"))!;
const summer = buildIndex("cnrsummer2026.stlbasketball.com", read("summer-home.html"))!;

/** Serves the saved pages as if they were the live site. */
const fakeFetch = ((input: string | URL) => {
  const url = new URL(String(input));
  const pages: Record<string, string> = {
    "cnrschedule.stlbasketball.com/": "current-home.html",
    [`cnrschedule.stlbasketball.com/teams/${ME}`]: "current-team.html",
    [`cnrnovdec2026schedules.stlbasketball.com/${ME}.ics`]: "current-team.ics",
    "cnrschedule.stlbasketball.com/facilities/beal-center-gym-8": "facility-beal-gym-8.html",
  };
  const file = pages[url.hostname + url.pathname];
  return Promise.resolve(file ? new Response(read(file), { status: 200 }) : new Response("not found", { status: 404 }));
}) as typeof fetch;

Deno.test("recognizes every kind of CNR league link", () => {
  assertEquals(parseLeagueURL("https://cnrschedule.stlbasketball.com/"), { host: "cnrschedule.stlbasketball.com", teamSlug: null, seasonStart: null });
  assertEquals(parseLeagueURL(`https://cnrschedule.stlbasketball.com/teams/${ME}`)?.teamSlug, ME);
  assertEquals(parseLeagueURL(`webcal://cnrnovdec2026schedules.stlbasketball.com/${ME}.ics`), { host: "cnrschedule.stlbasketball.com", teamSlug: ME, seasonStart: null });
  assertEquals(parseLeagueURL("https://cnrsummer2026.stlbasketball.com/divisions/6th-boys")?.host, "cnrsummer2026.stlbasketball.com");
  assertEquals(parseLeagueURL("https://cnrschedule.stlbasketball.com/?season=2026-11-07")?.seasonStart, "2026-11-07");
  assertEquals(parseLeagueURL("https://stlbasketball.com.evil.com/"), null);
  assertEquals(parseLeagueURL("https://docs.google.com/spreadsheets/d/e/x/pubhtml"), null);
  assertEquals(canonicalLeagueURL("cnrschedule.stlbasketball.com", "2026-11-07"), "https://cnrschedule.stlbasketball.com/?season=2026-11-07");
  assertEquals(leagueSlug("Rise & Reign 6th Boys"), "rise-reign-6th-boys");
  assertEquals(leagueSlug("Eureka Jr. Wildcats Gold 6th Boys"), "eureka-jr-wildcats-gold-6th-boys");
});

Deno.test("season and team list from the home page", () => {
  assertEquals(current.season, { label: "11/7/26 - 12/20/26", start: "2026-11-07", end: "2026-12-20" });
  assertEquals(current.teams.length, 818);
  const me = current.teams.find((t) => t.key === ME)!;
  assertEquals([me.name, me.bracket, me.grade, me.gender], ["3D Nation 2033 6th Boys", "6th Boys", "6", "boys"]);
  assertEquals(summer.season.label, "6/1/26 - 7/17/26");
});

Deno.test("the owner's team is a clear match with no coach column", () => {
  const r = scoreTeams(current.teams, { teamName: "3D Nation 6th Grade", coachNames: ["Danny Guillory"] });
  assertEquals([r.outcome, r.teamKeys], ["clear", [ME]]);
  // Remembered from the tournament import, the alias alone is enough.
  assertEquals(scoreTeams(current.teams, { teamName: "My Team", coachNames: [], aliases: ["3d nation 2033"] }).teamKeys, [ME]);
});

Deno.test("team page, calendar feed and facility page", () => {
  const games = parseTeamGames(read("current-team.html"));
  assertEquals(games.length, 7);
  assertEquals(games[0], {
    date: "2026-11-07", time: "1:00 PM", facility: "Orchard Farm High School Gym 1", home: "Rise & Reign 6th Boys",
    away: "3D Nation 2033 6th Boys", division: "6th Boys", homeScore: null, awayScore: null, homeRank: "4", awayRank: "7",
  });
  assertEquals(parseCalendarURL(read("current-team.html")), `https://cnrnovdec2026schedules.stlbasketball.com/${ME}.ics`);
  const uids = parseFeedUIDs(read("current-team.ics"));
  assertEquals(uids.size, 7);
  assertEquals(uids.get("2026-11-14|3d nation 2033 6th boys|knights klotz 6th boys"), "_JuB8FpQfV0mNHRrVknqX");
  assertEquals(parseFacilityAddress(read("facility-beal-gym-8.html")), "150 N. Eatherton Rd, Chesterfield, MO 63005");
});

Deno.test("current season: seven upcoming games with stable ids, home/away and addresses", async () => {
  const games = await fetchTeamGames(current, ME, fakeFetch);
  const t = leagueTournament(current, games);
  assertEquals(t.title, "CNR League 11/7/26 - 12/20/26");
  assertEquals(t.timeZone, "America/Chicago");
  const mine = gamesForTeam(t, ME);
  assertEquals(mine.length, 7);
  assert(mine.every((g) => g.key.startsWith("uid:")), "feed ids");
  assertEquals(mine.map((g) => [g.localStart, ourSide(g, ME) === "right" ? "home" : "away", ourSide(g, ME) === "right" ? g.left.name : g.right.name]).slice(0, 3), [
    ["2026-11-07T13:00", "away", "Rise & Reign 6th Boys"],
    ["2026-11-08T08:00", "away", "Kings Gold 6th Boys"],
    ["2026-11-14T10:00", "home", "Knights Klotz 6th Boys"],
  ]);
  const beal = mine.find((g) => g.location === "Beal Center Gym 8")!;
  assertEquals(beal.venue?.address, "150 N. Eatherton Rd, Chesterfield, MO 63005");
  // Gyms whose pages aren't saved here simply have no address.
  assertEquals(mine.find((g) => g.location === "Principia Gym 3")!.venue?.address, "");
  // Daylight time ended Nov 1, so every league game is Central Standard (UTC-6).
  assertEquals(localToISO(mine[0].localStart!, "America/Chicago"), "2026-11-07T19:00:00.000Z");
  assertEquals(localToISO(beal.localStart!, "America/Chicago"), "2026-11-14T16:00:00.000Z");
});

Deno.test("past season: finished games with scores, keyed by date and teams", () => {
  const games = buildGames(summer, ME, parseTeamGames(read("summer-team.html")), new Map(), new Map());
  assertEquals(games.length, 7);
  const first = games[0];
  assertEquals([first.key, first.right.name, first.right.score, first.left.name, first.left.score], [
    "2026-06-01|greyhounds-orange-6th-boys~3d-nation-2033-6th-boys|1", "3D Nation 2033 6th Boys", 52, "Greyhounds Orange 6th Boys", 14,
  ]);
  assert(games.every((g) => g.left.score !== null && g.right.score !== null), "every game has a final score");
});

Deno.test("a saved import from an old season refuses to 'update' into a new one", async () => {
  await assertRejects(() => fetchLeagueIndex(parseLeagueURL("https://cnrschedule.stlbasketball.com/?season=2026-06-01")!, fakeFetch), "season_over");
  const ok = await fetchLeagueIndex(parseLeagueURL("https://cnrschedule.stlbasketball.com/?season=2026-11-07")!, fakeFetch);
  assertEquals(ok.season.start, "2026-11-07");
});

Deno.test("a team that isn't on the site", async () => {
  await assertRejects(() => fetchTeamGames(current, "no-such-team-6th-boys", fakeFetch), "team_not_found");
});

function assert(ok: unknown, label: string) {
  if (!ok) throw new Error(label);
}
