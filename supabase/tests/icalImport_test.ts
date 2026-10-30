// Team calendar import (D-047) against a TeamSnap-style feed: games, home/away, weekly practices
// with an exception and a moved occurrence, all-day and cancelled items, and link safety.
//   npx deno test --allow-read supabase/tests/icalImport_test.ts
import {
  classifyTitle,
  expandRule,
  fetchCalendar,
  isPrivateAddress,
  isPrivateHost,
  parseCalendar,
  parseCalendarURL,
  parseWhen,
  splitLocation,
  zoneForTZID,
} from "../functions/_shared/icalImport.ts";
import { changeNotice } from "../functions/_shared/scheduleImport.ts";
import { isDue } from "../functions/_shared/importRecheck.ts";

function assertEquals(actual: unknown, expected: unknown, label = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\n     got ${a}`);
}

const NOW = Date.parse("2026-10-29T12:00:00Z");
const feed = Deno.readTextFileSync(new URL("./fixtures/ical/teamsnap.ics", import.meta.url)).replace(/\r?\n/g, "\r\n");
const read = parseCalendar(feed, { now: NOW, provider: "TeamSnap" });
const games = read.tournament.games;
const byTitle = (t: string) => games.find((g) => g.calendar!.title === t)!;

Deno.test("reads the calendar as one team, in its zone", () => {
  assertEquals(read.tournament.title, "Hawks 12U");
  assertEquals(read.tournament.timeZone, "America/Chicago");
  assertEquals(read.tournament.teams.map((t) => t.key), ["calendar"]);
  assertEquals(read.skippedAllDay, 1, "the all-day tournament");
});

Deno.test("games: opponent, home/away, length, notes, venue", () => {
  const home = byTitle("Hawks 12U vs. Lions");
  assertEquals([home.calendar!.eventType, home.right.name, home.calendar!.homeAway, home.calendar!.minutes], ["game", "Lions", "home", 90]);
  assertEquals(home.calendar!.startsAt, "2026-11-07T15:00:00.000Z");
  assertEquals(home.localStart, "2026-11-07T09:00");
  assertEquals(home.venue, { name: "Lifetime Fitness", code: "Lifetime Fitness", address: "123 Main St, Chesterfield, MO 63017" });
  assertEquals(home.calendar!.notes, "Arrival Time: 30 minutes early\nUniform: White");
  const away = byTitle("Hawks 12U at Tigers (Away)");
  assertEquals([away.right.name, away.calendar!.homeAway, away.calendar!.minutes, away.location], ["Tigers", "away", 60, "Tiger Dome"]);
  const flipped = byTitle("Bears @ Hawks 12U");
  assertEquals([flipped.right.name, flipped.calendar!.homeAway], ["Bears", "home"], "our name on the right of @");
});

Deno.test("practices repeat, skip exceptions, and take moved occurrences", () => {
  const practices = games.filter((g) => g.calendar!.eventType === "practice");
  assertEquals(practices.map((g) => g.localStart), [
    "2026-11-10T18:00", "2026-11-12T18:00", "2026-11-17T18:00", "2026-11-19T19:00", "2026-11-24T18:00",
  ]);
  assertEquals(practices[3].calendar!.title, "Practice (late start)");
  assertEquals(practices[0].calendar!.minutes, 90);
  // Keys are stable per occurrence and differ between occurrences.
  assertEquals(new Set(practices.map((g) => g.key)).size, 5);
  assertEquals(practices[0].key, parseCalendar(feed, { now: NOW }).tournament.games.find((g) => g.localStart === "2026-11-10T18:00")!.key);
});

Deno.test("leaves out old, cancelled and all-day items; other events stay events", () => {
  const titles = games.map((g) => g.calendar!.title);
  for (const gone of ["Hawks 12U vs. Old Foes", "Hawks 12U vs. Ghosts", "Turkey Classic"]) assertEquals(titles.includes(gone), false, gone);
  assertEquals(byTitle("Team photo at Lifetime Fitness").calendar!.eventType, "other");
});

Deno.test("titles from other apps", () => {
  const c = (s: string, ours: string[] = []) => {
    const r = classifyTitle(s, "", new Set(ours));
    return [r.eventType, r.opponent, r.homeAway];
  };
  assertEquals(c("vs. Lions"), ["game", "Lions", "home"], "GameChanger home");
  assertEquals(c("@ Lions"), ["game", "Lions", "away"], "GameChanger away");
  assertEquals(c("Game: Lions (Away)"), ["game", "Lions", "away"]);
  assertEquals(c("Game vs Lions - Home"), ["game", "Lions", "home"]);
  assertEquals(c("Game 3"), ["game", null, null]);
  assertEquals(c("Team Practice"), ["practice", null, null]);
  assertEquals(c("Skills Session"), ["practice", null, null]);
  assertEquals(c("Pizza party at Mario's"), ["other", null, null]);
  assertEquals(c("Hawks at Lions", ["hawks"]), ["game", "Lions", "away"]);
});

Deno.test("dates, zones and rules", () => {
  assertEquals(parseWhen("20261107T150000Z", {}), { local: "2026-11-07T15:00", zone: "UTC", allDay: false });
  assertEquals(parseWhen("20261107", {})?.allDay, true);
  assertEquals(zoneForTZID("Central Standard Time"), "America/Chicago");
  assertEquals(zoneForTZID("/mozilla.org/20050126_1/America/New_York"), "America/New_York");
  assertEquals(zoneForTZID("Nowhere/Land"), null);
  const start = { local: "2026-11-02T18:00", zone: "America/Chicago", allDay: false };
  assertEquals(expandRule(start, "FREQ=WEEKLY;INTERVAL=2;COUNT=3", Infinity, "America/Chicago"), ["2026-11-02T18:00", "2026-11-16T18:00", "2026-11-30T18:00"]);
  assertEquals(expandRule(start, "FREQ=DAILY;COUNT=2", Infinity, "America/Chicago"), ["2026-11-02T18:00", "2026-11-03T18:00"]);
  assertEquals(splitLocation("Central Gym"), { name: "Central Gym", address: null });
  assertEquals(splitLocation("500 Elm St, Clayton, MO 63105, USA"), { name: "500 Elm St, Clayton, MO 63105, USA", address: "500 Elm St, Clayton, MO 63105" });
});

Deno.test("links: webcal, Google share links, and no private networks", () => {
  assertEquals(parseCalendarURL("webcal://ical-cdn.teamsnap.com/team_schedule/abc.ics"), { url: "https://ical-cdn.teamsnap.com/team_schedule/abc.ics", provider: "TeamSnap" });
  assertEquals(parseCalendarURL("webcal://api.team-manager.gc.com/ics-calendar-documents/user/x.ics?teamId=1")?.provider, "GameChanger");
  assertEquals(parseCalendarURL(`https://calendar.google.com/calendar/u/0?cid=${btoa("abc@group.calendar.google.com")}`)?.url,
    "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics");
  for (const bad of ["http://localhost/x.ics", "http://127.0.0.1/x.ics", "http://10.1.2.3/x.ics", "http://169.254.169.254/latest", "http://[::1]/x", "http://2130706433/", "https://example.com:8443/x.ics", "ftp://example.com/x.ics", "not a link"]) {
    assertEquals(parseCalendarURL(bad), null, bad);
  }
  assertEquals(isPrivateHost("ical-cdn.teamsnap.com"), false);
});

Deno.test("fetch: refuses redirects into private networks and web pages", async () => {
  const fake = ((url: string) => {
    if (url.includes("redirect")) return Promise.resolve(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }));
    if (url.includes("page")) return Promise.resolve(new Response("<html>TeamSnap</html>"));
    return Promise.resolve(new Response(feed));
  }) as unknown as typeof fetch;
  const publicDNS = () => Promise.resolve(["52.10.20.30"]);
  const code = async (url: string) => {
    try {
      await fetchCalendar({ url, provider: "TeamSnap" }, fake, publicDNS);
      return "ok";
    } catch (e) {
      return (e as { code: string }).code;
    }
  };
  assertEquals(await code("https://x.teamsnap.com/redirect"), "unreadable");
  assertEquals(await code("https://x.teamsnap.com/page"), "not_a_calendar");
  assertEquals(await code("https://x.teamsnap.com/feed.ics"), "ok");
});

Deno.test("change notices", () => {
  const moved = { type: "moved" as const, eventId: "e1", label: "vs Lions", startsAt: "2026-11-07T16:00:00.000Z", previousStartsAt: "2026-11-07T15:00:00.000Z", location: "Lifetime", previousLocation: null };
  assertEquals(changeNotice([moved], "America/Chicago", "Hawks 12U"), {
    kind: "event_updated", subject: "Time changed: vs Lions", body: "Now Sat, Nov 7, 10:00 AM (was Sat, Nov 7, 9:00 AM) · Lifetime", refId: "e1",
  });
  const cancelled = { ...moved, type: "cancelled" as const, eventId: "e2", label: "Practice", previousStartsAt: null };
  const added = { ...moved, type: "added" as const, eventId: "e3", label: "Practice", previousStartsAt: null };
  const many = changeNotice([moved, cancelled, added], "America/Chicago", "Hawks 12U")!;
  assertEquals(many.subject, "Schedule changes: Hawks 12U");
  assertEquals(many.body, "vs Lions now Sat, Nov 7, 10:00 AM (was 9:00 AM); Practice on Sat, Nov 7, 10:00 AM cancelled; and 1 more.");
  assertEquals(changeNotice([], "America/Chicago", "x"), null);
});

Deno.test("re-check cadence", () => {
  const at = (minAgo: number, failures = 0) => ({ last_checked_at: new Date(NOW - minAgo * 60_000).toISOString(), check_failures: failures });
  assertEquals(isDue({ last_checked_at: null, check_failures: 0 }, true, NOW), true);
  assertEquals(isDue(at(10), true, NOW), false);
  assertEquals(isDue(at(20), true, NOW), true);
  assertEquals(isDue(at(60), false, NOW), false, "idle imports wait 6 hours");
  assertEquals(isDue(at(60), true, NOW) && !isDue(at(60, 3), true, NOW), true, "backs off after 3 failures");
});

Deno.test("fetch: refuses public names that point at private addresses (D-051)", async () => {
  const fake = (() => Promise.resolve(new Response(feed))) as unknown as typeof fetch;
  const dns: Record<string, string[]> = {
    "rebind.example.com": ["127.0.0.1"],
    "metadata.example.com": ["169.254.169.254"],
    "v6.example.com": ["2600:1f18::1", "fd00::5"],
    "mapped.example.com": ["::ffff:10.0.0.4"],
    "ok.example.com": ["93.184.216.34", "2606:2800:220:1::1"],
  };
  const resolve = (h: string) => Promise.resolve(dns[h] ?? []);
  const code = async (url: string) => {
    try { await fetchCalendar({ url, provider: "Calendar" }, fake, resolve); return "ok"; } catch (e) { return (e as { code: string }).code; }
  };
  assertEquals(await code("https://rebind.example.com/x.ics"), "unreadable");
  assertEquals(await code("https://metadata.example.com/x.ics"), "unreadable");
  assertEquals(await code("https://v6.example.com/x.ics"), "unreadable");
  assertEquals(await code("https://mapped.example.com/x.ics"), "unreadable");
  assertEquals(await code("https://ok.example.com/x.ics"), "ok");
  for (const [addr, priv] of [["10.1.1.1", true], ["8.8.8.8", false], ["::1", true], ["fe80::1", true], ["2001:4860::8888", false]] as const) {
    assertEquals(isPrivateAddress(addr), priv, addr);
  }
});
