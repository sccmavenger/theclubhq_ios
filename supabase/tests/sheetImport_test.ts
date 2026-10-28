// Schedule import from Google Sheets (D-042), against a saved copy of the real
// 2026 CNR October 3-4 tournament (21 tabs, fetched 2026-10-28).
//   npx deno test --allow-read supabase/tests/sheetImport_test.ts
import {
  gamesForTeam,
  isPlaceholder,
  localToISO,
  matchInBracket,
  nameSimilarity,
  ourSide,
  parseCSV,
  parseDateRange,
  parseSheetURL,
  parseTabList,
  parseTime,
  parseTournament,
  resolveDay,
  resolveLocation,
  scoreTeams,
  stripRoundLabel,
  type Tournament,
  zoneForAddress,
} from "../functions/_shared/sheetImport.ts";

function assertEquals(actual: unknown, expected: unknown, label = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\n     got ${a}`);
}
function assert(ok: unknown, label: string) {
  if (!ok) throw new Error(label);
}

const dir = new URL("./fixtures/cnr-2026-10/", import.meta.url);
const fixture = JSON.parse(await Deno.readTextFile(new URL("tabs.json", dir)));
const html = await Deno.readTextFile(new URL("pubhtml.html", dir));
const cnr: Tournament = parseTournament({ title: "2026 CNR Oct 3-4 Tourney Schedule", tabs: fixture.tabs }, { fallbackYear: 2026 });
const team = (name: string) => {
  const t = cnr.teams.find((x) => x.name === name);
  if (!t) throw new Error(`no team ${name}`);
  return t;
};
const counts = Object.fromEntries(cnr.teams.map((t) => [t.key, gamesForTeam(cnr, t.key).length]));

// ----- Links and tabs --------------------------------------------------------
Deno.test("recognizes published and shared Google Sheets links", () => {
  const pub = parseSheetURL("https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vQoH24Yk3kQM7zd5_uX8JOXgwmHYN8pCKl8jAemdHtFo2ldPSo-sNFtJnQRF5Qsjre9JFGOstXi2urS/pubhtml?pli=1");
  assertEquals(pub?.kind, "published");
  assertEquals(pub?.url, "https://docs.google.com/spreadsheets/d/e/2PACX-1vQoH24Yk3kQM7zd5_uX8JOXgwmHYN8pCKl8jAemdHtFo2ldPSo-sNFtJnQRF5Qsjre9JFGOstXi2urS/pubhtml");
  const shared = parseSheetURL("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0");
  assertEquals(shared?.kind, "shared");
  assertEquals(parseSheetURL("https://example.com/spreadsheets/d/e/2PACX-1vQoH24Yk3kQM7zd5/pubhtml"), null);
  assertEquals(parseSheetURL("http://docs.google.com/spreadsheets/d/e/2PACX-1vQoH24Yk3kQM7zd5_uX8JOXgw/pubhtml"), null);
  assertEquals(parseSheetURL("not a link"), null);
});

Deno.test("lists all 21 tabs from the published page", () => {
  const tabs = parseTabList(html);
  assertEquals(tabs.length, 21);
  assertEquals(tabs[0], { name: "Tourney Info", gid: "1033321362" });
  assert(tabs.some((t) => t.name === "5/6 G Malone"), "escaped slash in tab name");
});

Deno.test("CSV handles quotes, commas and newlines inside cells", () => {
  assertEquals(parseCSV('a,"b, c","say ""hi""\nthere"\r\nx,,y'), [["a", "b, c", 'say "hi"\nthere'], ["x", "", "y"]]);
});

// ----- Tournament facts ------------------------------------------------------
Deno.test("reads title, dates, venues, time zone and the home-team rule", () => {
  assertEquals(cnr.title, "2026 CNR October 3-4 Tournament");
  assertEquals(cnr.dates, ["2026-10-03", "2026-10-04"]);
  assertEquals(cnr.timeZone, "America/Chicago");
  assertEquals(cnr.homeSide, "right");
  assertEquals(cnr.homeNote, "Home team wears white");
  assertEquals(cnr.venues.map((v) => v.code), ["Beal", "CSTL"]);
  assertEquals(cnr.venues[0].address, "150 N. Eatherton Rd., Chesterfield, MO 63005");
});

Deno.test("every bracket tab reads, and every game has a date and a venue", () => {
  assertEquals(cnr.brackets.length, 17);
  assertEquals(cnr.games.length, 112);
  assertEquals(cnr.games.filter((g) => !g.localStart).length, 0);
  assertEquals(cnr.games.filter((g) => !g.venue).length, 0);
  // Note rows ("3rd Place team in Pool B won't play a Sunday game") and tiebreaker tables aren't games.
  assert(!cnr.games.some((g) => /tiebreak|overall record|won't play/i.test(g.left.raw + g.right.raw)), "no note rows");
  // Each team list appears twice (alphabetical and by bracket); teams are not duplicated.
  assertEquals(cnr.teams.length, 76);
});

Deno.test("only the genuinely ambiguous names stay unmatched", () => {
  const unmatched = cnr.brackets.flatMap((b) => b.unmatchedNames.map((n) => `${b.name}: ${n}`));
  // "Elite status" could be either Elite Status team in Frosh/JV.
  assertEquals(unmatched, ["Frosh/JV Boys: Elite status"]);
  const zero = cnr.teams.filter((t) => counts[t.key] === 0).map((t) => t.name);
  assertEquals(zero, []);
});

// ----- The owner's team ------------------------------------------------------
Deno.test("3D Nation 2033 6th Boys: exactly three games, with scores", () => {
  const me = team("3D Nation 2033 6th Boys");
  assertEquals(me.coach, "Danny Guillory");
  assertEquals(me.bracket, "6B Carter");
  const games = gamesForTeam(cnr, me.key);
  assertEquals(games.map((g) => [g.localStart, g.round, g.venue?.name, g.court, ourSide(g, me.key)]), [
    ["2026-10-03T16:00", "Pool B", "Beal Center", "6", "right"],
    ["2026-10-03T18:00", "Pool B", "Beal Center", "6", "right"],
    ["2026-10-04T08:00", "3rd Place Game", "Beal Center", "5", "right"],
  ]);
  assertEquals(games.map((g) => [g.left.name, g.left.score, g.right.score]), [
    ["STL Grizzlies", 30, 26],
    ["Rise & Reign Maroon", 24, 50],
    ["Arch city Select Gold", 37, 33],
  ]);
  // 4:00 PM Central on Oct 3 (Daylight time, UTC-5).
  assertEquals(localToISO(games[0].localStart!, "America/Chicago"), "2026-10-03T21:00:00.000Z");
});

Deno.test("game keys are stable and unique", () => {
  const keys = cnr.games.map((g) => g.key);
  assertEquals(new Set(keys).size, keys.length);
  const again = parseTournament({ title: null, tabs: fixture.tabs }, { fallbackYear: 2026 });
  assertEquals(again.games.map((g) => g.key), keys);
  // A rematch in the same pool gets its own key.
  const carterA = cnr.games.filter((g) => g.bracket === "6B Carter" && g.round === "Pool A");
  assertEquals(carterA.length, 2);
  assert(carterA[0].key.endsWith("|1") && carterA[1].key.endsWith("|2"), "occurrence suffix");
});

// ----- Messy rows ------------------------------------------------------------
Deno.test("score columns that shift between pools (5/6 G Malone)", () => {
  const g = cnr.games.find((x) => x.bracket === "5/6 G Malone" && x.localStart === "2026-10-03T08:00")!;
  assertEquals([g.left.name, g.left.score, g.right.score, g.right.name], ["Mavericks GFC 2033 Royal 6th", 16, 29, "Rise & Reign White 6th"]);
  assertEquals(g.round, "Pool B");
});

Deno.test("typos, partial names and odd spacing connect to the listed team", () => {
  const find = (bracket: string, raw: string) => cnr.games.flatMap((g) => [g.left, g.right]).find((s) => s.raw === raw && cnr.games.some((g) => g.bracket === bracket && (g.left === s || g.right === s)));
  assertEquals(find("3B Garnett", "Gensis 2036 3rd")?.teamKey, team("Genesis 2036 3rd Boys").key);
  assertEquals(find("5/6 G Malone", "Knighs Rubel Red 5th")?.teamKey, team("Knights Rubel Red 5th Girls").key);
  assertEquals(find("5/6 G Malone", "Rise & Reign")?.teamKey, team("Rise & Reign White 6th Girls").key);
  assertEquals(find("5/6 G Malone", "Knights rubel black")?.teamKey, team("Knights Rubel Black 5th Girls").key);
  assertEquals(find("6B Carter", "Stl Grizzlies")?.teamKey, team("STL Grizzlies 6th Boys").key);
  assertEquals(find("Frosh/JV Boys", "Elite Status Freshmen")?.teamKey, team("Elite Status Freshmen Boys").key);
  assertEquals(find("Frosh/JV Boys", "Elite Status JV")?.teamKey, team("Elite Status JV Boys").key);
});

Deno.test("round labels inside team cells, placeholders, and 'Won' instead of a score", () => {
  const final = cnr.games.find((g) => g.bracket === "6B Carter" && g.round === "1st Place Game")!;
  assertEquals([final.left.name, final.left.teamKey], ["Bradley Beal Elite 2033", team("Bradley Beal Elite 2033 6th Boys").key]);
  const champ = cnr.games.find((g) => g.bracket === "3B Garnett" && g.round === "Championship Game")!;
  assertEquals([champ.left.placeholder, champ.left.teamKey, champ.right.teamKey], [true, null, team("Knights Durco 3rd Boys").key]);
  const won = cnr.games.find((g) => g.bracket === "8B Drexler" && g.localStart === "2026-10-04T13:00")!;
  assertEquals([won.left.name, won.left.score, won.right.score], ["Rage", null, null]);
});

// ----- Picking the coach's team ----------------------------------------------
Deno.test("clear winner: the owner's team on the first try", () => {
  const r = scoreTeams(cnr.teams, { teamName: "3D Nation 6th Grade", coachNames: ["Danny Guillory"] }, counts);
  assertEquals(r.outcome, "clear");
  assertEquals(r.teamKeys, [team("3D Nation 2033 6th Boys").key]);
  // Name alone is enough, and so is the coach alone.
  assertEquals(scoreTeams(cnr.teams, { teamName: "3D Nation", coachNames: [] }, counts).teamKeys, [team("3D Nation 2033 6th Boys").key]);
  assertEquals(scoreTeams(cnr.teams, { teamName: "My Team", coachNames: ["Danny Guillory"] }, counts).teamKeys[0], team("3D Nation 2033 6th Boys").key);
});

Deno.test("one coach with six teams: a short list, narrowed by name and grade", () => {
  const r = scoreTeams(cnr.teams, { teamName: "Arch City", coachNames: ["Jake Kampf"] }, counts);
  assertEquals(r.outcome, "choices");
  assertEquals(r.teamKeys.length, 6);
  assert(r.teamKeys.every((k) => k.includes("arch-city-select")), "all six Kampf teams");
  const exact = scoreTeams(cnr.teams, { teamName: "Arch City Select Gold 7th", coachNames: ["Jake Kampf"] }, counts);
  assertEquals([exact.outcome, exact.teamKeys], ["clear", [team("Arch City Select Gold 7th Boys").key]]);
});

Deno.test("same name in four brackets: grade and gender decide", () => {
  const vague = scoreTeams(cnr.teams, { teamName: "Rise & Reign Silver", coachNames: [] }, counts);
  assertEquals(vague.outcome, "choices");
  assertEquals(vague.teamKeys.filter((k) => k.includes("rise-reign-silver")).length, 4);
  const exact = scoreTeams(cnr.teams, { teamName: "Rise & Reign Silver 8th Girls", coachNames: [] }, counts);
  assertEquals([exact.outcome, exact.teamKeys], ["clear", [team("Rise & Reign Silver 8th Girls").key]]);
});

Deno.test("a wrong Grade column doesn't hide the team", () => {
  // Listed as grade 6, named 5th.
  const r = scoreTeams(cnr.teams, { teamName: "Knights Rubel Black 5th Girls", coachNames: ["Jason Rubel"] }, counts);
  assertEquals([r.outcome, r.teamKeys], ["clear", [team("Knights Rubel Black 5th Girls").key]]);
});

Deno.test("a team that isn't in the tournament gets no guess", () => {
  assertEquals(scoreTeams(cnr.teams, { teamName: "Chesterfield Lakers 10U", coachNames: ["Pat Smith"] }, counts).outcome, "none");
});

Deno.test("a remembered match wins next time", () => {
  const r = scoreTeams(cnr.teams, { teamName: "Saturday Squad", coachNames: [], aliases: ["Mavericks 2031 Blue 8th Boys"] }, counts);
  assertEquals([r.outcome, r.teamKeys], ["clear", [team("Mavericks 2031 Blue 8th Boys").key]]);
});

// ----- Small pieces ----------------------------------------------------------
Deno.test("date ranges", () => {
  assertEquals(parseDateRange("2026 CNR October 3-4 Tournament", 2025), ["2026-10-03", "2026-10-04"]);
  assertEquals(parseDateRange("Fall Classic Oct 31 - Nov 1", 2026), ["2026-10-31", "2026-11-01"]);
  assertEquals(parseDateRange("Hoops Fest 10/3-10/4/2026", 2026), ["2026-10-03", "2026-10-04"]);
  assertEquals(parseDateRange("Winter Jam Dec 12th & 13th 2026", 2025), ["2026-12-12", "2026-12-13"]);
  assertEquals(parseDateRange("League Schedule", 2026), []);
  assertEquals(resolveDay("Sun", ["2026-10-03", "2026-10-04"], 2026), "2026-10-04");
  assertEquals(resolveDay("Sat 10/3", [], 2026), "2026-10-03");
  assertEquals(resolveDay("Fri", ["2026-10-03", "2026-10-04"], 2026), null);
});

Deno.test("times, places and zones", () => {
  assertEquals(parseTime("4:00 PM"), { hour: 16, minute: 0 });
  assertEquals(parseTime("12:30 am"), { hour: 0, minute: 30 });
  assertEquals(parseTime("9a"), { hour: 9, minute: 0 });
  assertEquals(parseTime("Sat"), null);
  assertEquals(resolveLocation("CSTL 5", cnr.venues).venue?.name, "Center St. Louis");
  assertEquals(resolveLocation("Beal Court 6", cnr.venues).court, "6");
  assertEquals(resolveLocation("Somewhere Else", cnr.venues).venue, null);
  assertEquals(zoneForAddress("6727 Langley Avenue, St. Louis, MO 63123"), "America/Chicago");
  assertEquals(zoneForAddress("632 Autumn Rise Lane"), null);
  // Standard time after November 1.
  assertEquals(localToISO("2026-11-07T09:00", "America/Chicago"), "2026-11-07T15:00:00.000Z");
});

Deno.test("names", () => {
  assertEquals(stripRoundLabel("1st Place Game- Bradley  Beal Elite 2033"), { name: "Bradley Beal Elite 2033", label: "1st Place Game" });
  assertEquals(stripRoundLabel("Stl Grizzlies "), { name: "Stl Grizzlies", label: null });
  assert(isPlaceholder("Winner of Semi-Final Game"), "winner");
  assert(isPlaceholder("TBD"), "tbd");
  assert(isPlaceholder("2nd Place Pool A"), "pool place");
  assert(!isPlaceholder("Knights Durco"), "real team");
  assert(nameSimilarity("Gensis 2036 3rd", "Genesis 2036 3rd Boys") >= 0.9, "typo");
  assertEquals(matchInBracket("Mavericks", cnr.teams.filter((t) => t.bracket === "8B Drexler")), null);
});
