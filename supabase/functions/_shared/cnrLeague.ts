// CNR league schedules from cnrschedule.stlbasketball.com and its past-season sites (D-043).
//
// The site is a Next.js app; each page carries its data in the page payload:
//   - the home page: the season ("11/7/26 - 12/20/26") and every team with its division,
//   - a team page (/teams/<slug>): that team's games with scores and, for the current season,
//     its calendar feed (webcal://…/<slug>.ics), whose event UIDs are stable game ids,
//   - a facility page (/facilities/<slug>): the gym's street address.
// The output is the same `Tournament` shape the Google Sheets reader produces, so import-preview,
// import-commit, update and undo work unchanged. Parsing is pure and tested against saved pages
// in supabase/tests/cnrLeague_test.ts; only the `fetch*` functions do I/O.
import { type Game, type SheetTeam, type Tournament, parseGender, parseGrade, parseTime, type Venue, zoneForAddress } from "./sheetImport.ts";

const ZONE = "America/Chicago"; // The feeds say so, and every gym is in the St. Louis area.
const FETCH_TIMEOUT_MS = 10_000;
const HOST_RE = /^cnr[a-z0-9]*\.stlbasketball\.com$/;
const FEED_HOST_RE = /^cnr[a-z0-9]*schedules\.stlbasketball\.com$/;

export interface LeagueSource {
  /** Site to read, e.g. "cnrschedule.stlbasketball.com" (current season) or "cnrsummer2026.stlbasketball.com". */
  host: string;
  /** Team slug when the link pointed at one team (team page or calendar feed). */
  teamSlug: string | null;
  /** Season start ("2026-11-07") recorded in a saved import's address; checked before updating. */
  seasonStart: string | null;
}

/**
 * Recognizes CNR league links: any page on a cnr*.stlbasketball.com season site, a team page
 * (/teams/<slug>), or a team's calendar feed (webcal://cnr…schedules.stlbasketball.com/<slug>.ics).
 */
export function parseLeagueURL(input: string): LeagueSource | null {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcal:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const seasonStart = url.searchParams.get("season");
  const season = seasonStart && /^\d{4}-\d{2}-\d{2}$/.test(seasonStart) ? seasonStart : null;
  if (FEED_HOST_RE.test(host)) {
    // A feed always belongs to the season that's current on the main site.
    const slug = url.pathname.match(/^\/([a-z0-9-]+)\.ics$/i)?.[1]?.toLowerCase() ?? null;
    return slug ? { host: "cnrschedule.stlbasketball.com", teamSlug: slug, seasonStart: season } : null;
  }
  if (!HOST_RE.test(host)) return null;
  const slug = url.pathname.match(/^\/teams\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase() ?? null;
  return { host, teamSlug: slug, seasonStart: season };
}

/** The address we store for an import: the site plus its season, so a new season is never mistaken for changes. */
export function canonicalLeagueURL(host: string, seasonStart: string | null): string {
  return `https://${host}/${seasonStart ? `?season=${seasonStart}` : ""}`;
}

/** The site's slug for a team or facility name: "Rise & Reign 6th Boys" → "rise-reign-6th-boys". */
export function leagueSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Page payloads
// ---------------------------------------------------------------------------
/** Next.js embeds page data as escaped JSON inside script strings; undo the outer escaping. */
function payload(html: string): string {
  return html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function jsonObjects(html: string, field: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of payload(html).matchAll(new RegExp(`\\{[^{}]*"${field}":[^{}]*\\}`, "g"))) {
    try {
      out.push(JSON.parse(m[0]));
    } catch { /* a fragment that isn't a whole record */ }
  }
  return out;
}

/** "11/7/26 - 12/20/26" → title, label and ISO dates. */
export function parseSeason(html: string): { label: string; start: string | null; end: string | null } | null {
  const label = html.match(/border-l border-brand-700 pl-2 ml-1">([^<]+)</)?.[1]?.trim() ??
    html.match(/\b(\d{1,2}\/\d{1,2}\/\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2})\b/)?.[0];
  if (!label) return null;
  const iso = (d: string) => {
    const [m, day, y] = d.split("/").map(Number);
    return `${2000 + y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const parts = label.match(/(\d{1,2}\/\d{1,2}\/\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2})/);
  return { label, start: parts ? iso(parts[1]) : null, end: parts ? iso(parts[2]) : null };
}

/** Every team in the season with its division, from the home page's team search. */
export function parseLeagueTeams(html: string): { name: string; division: string }[] {
  const m = payload(html).match(/"teamNames":(\[(?:\{[^{}]*\},?)*\])/);
  if (!m) return [];
  try {
    const list = JSON.parse(m[1]) as { name?: unknown; division?: unknown }[];
    return list
      .filter((t) => typeof t.name === "string" && typeof t.division === "string")
      .map((t) => ({ name: (t.name as string).trim(), division: (t.division as string).trim() }));
  } catch {
    return [];
  }
}

export interface LeagueGame {
  date: string;
  time: string;
  facility: string;
  home: string;
  away: string;
  division: string;
  homeScore: number | null;
  awayScore: number | null;
  homeRank: string | null;
  awayRank: string | null;
}

/** A team page's games. Unplayed games show a score of -1. */
export function parseTeamGames(html: string): LeagueGame[] {
  const score = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const games: LeagueGame[] = [];
  const seen = new Set<string>();
  for (const o of jsonObjects(html, "home_team")) {
    const g: LeagueGame = {
      date: text(o.date), time: text(o.time), facility: text(o.facility),
      home: text(o.home_team), away: text(o.away_team), division: text(o.division),
      homeScore: score(o.home_score), awayScore: score(o.away_score),
      homeRank: text(o.home_ranking) || null, awayRank: text(o.away_ranking) || null,
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date) || !parseTime(g.time) || !g.home || !g.away) continue;
    // Both the table and the card layout carry the same records.
    const id = `${g.date}|${g.time}|${g.home}|${g.away}`;
    if (seen.has(id)) continue;
    seen.add(id);
    games.push(g);
  }
  return games;
}

/** The team's calendar feed (current season only), as an https URL. */
export function parseCalendarURL(html: string): string | null {
  const m = payload(html).match(/"calendarUrl":"(webcal:\/\/[^"]+\.ics)"/);
  return m ? m[1].replace(/^webcal:/, "https:") : null;
}

/** A facility page's street address, e.g. "150 N. Eatherton Rd, Chesterfield, MO 63005". */
export function parseFacilityAddress(html: string): string | null {
  const text = html.replace(/<[^>]+>/g, "\n");
  const m = text.match(/\b\d+[ \t]+[^\n,]+,[ \t]*[^\n,]+,[ \t]*[A-Z]{2}[ \t]+\d{5}(-\d{4})?/);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** UIDs from a calendar feed, keyed by "date|home|away" (the DESCRIPTION names the home team). */
export function parseFeedUIDs(ics: string): Map<string, string> {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const out = new Map<string, string>();
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const uid = block.match(/^UID:(.+)$/m)?.[1]?.trim();
    const start = block.match(/^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})T/m);
    const desc = block.match(/^DESCRIPTION:(.+)$/m)?.[1] ?? "";
    const teams = desc.match(/HOME TEAM:\s*(.+?)\s+vs\s+AWAY TEAM:\s*(.+?)(\\n|$)/);
    if (!uid || !start || !teams) continue;
    out.set(`${start[1]}-${start[2]}-${start[3]}|${teams[1].trim().toLowerCase()}|${teams[2].trim().toLowerCase()}`, uid);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building the shared shape
// ---------------------------------------------------------------------------
export interface LeagueIndex {
  host: string;
  season: { label: string; start: string | null; end: string | null };
  teams: SheetTeam[];
}

export function buildIndex(host: string, homeHTML: string): LeagueIndex | null {
  const season = parseSeason(homeHTML);
  const list = parseLeagueTeams(homeHTML);
  if (!season || list.length === 0) return null;
  const teams: SheetTeam[] = list.map((t) => ({
    key: leagueSlug(t.name),
    name: t.name,
    grade: parseGrade(t.division) ?? parseGrade(t.name),
    gender: parseGender(t.division) ?? parseGender(t.name),
    coach: null,
    bracket: t.division,
    bracketTitle: t.division,
  }));
  return { host, season, teams };
}

/** One team's games as shared `Game`s: away team on the left, home on the right. */
export function buildGames(index: LeagueIndex, teamKey: string, games: LeagueGame[], uids: Map<string, string>, addresses: Map<string, string>): Game[] {
  const keyFor = (name: string) => {
    const slug = leagueSlug(name);
    return index.teams.some((t) => t.key === slug) ? slug : null;
  };
  const counts = new Map<string, number>();
  return games.map((g) => {
    const t = parseTime(g.time)!;
    const uid = uids.get(`${g.date}|${g.home.toLowerCase()}|${g.away.toLowerCase()}`);
    // Without a feed (past seasons), date + teams is stable enough for history.
    const base = uid ? `uid:${uid}` : `${g.date}|${leagueSlug(g.away)}~${leagueSlug(g.home)}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const address = addresses.get(g.facility) ?? null;
    const venue: Venue | null = g.facility ? { name: g.facility, code: g.facility, address: address ?? "" } : null;
    return {
      key: uid ? base : `${base}|${n}`,
      bracket: g.division || (index.teams.find((x) => x.key === teamKey)?.bracket ?? "League"),
      bracketTitle: g.division ? `${g.division} · CNR League` : "CNR League",
      round: null,
      left: { raw: g.away, name: g.away, teamKey: keyFor(g.away), score: g.awayScore, placeholder: false },
      right: { raw: g.home, name: g.home, teamKey: keyFor(g.home), score: g.homeScore, placeholder: false },
      dayLabel: g.date,
      timeLabel: g.time,
      localStart: `${g.date}T${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`,
      location: g.facility || null,
      venue,
      court: null,
    };
  });
}

export function leagueTournament(index: LeagueIndex, games: Game[]): Tournament {
  const venues: Venue[] = [];
  for (const g of games) if (g.venue && !venues.some((v) => v.name === g.venue!.name)) venues.push(g.venue);
  const tz = venues.map((v) => zoneForAddress(v.address)).find((z) => z) ?? ZONE;
  return {
    title: `CNR League ${index.season.label}`,
    dates: [index.season.start, index.season.end].filter((d): d is string => d !== null),
    venues,
    homeSide: "right",
    homeNote: null,
    timeZone: tz,
    teams: index.teams,
    brackets: [],
    games,
  };
}

// ---------------------------------------------------------------------------
// Fetching (I/O)
// ---------------------------------------------------------------------------
export class LeagueError extends Error {
  constructor(public code: "unreadable" | "season_over" | "team_not_found", message: string) {
    super(message);
  }
}

async function get(url: string, fetcher: typeof fetch): Promise<string | null> {
  const res = await fetcher(url, { redirect: "follow", headers: { "User-Agent": "ClubHQ schedule import (teamclubhq.com)" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new LeagueError("unreadable", `The CNR site answered ${res.status}. Try again in a minute.`);
  return await res.text();
}

export async function fetchLeagueIndex(source: LeagueSource, fetcher: typeof fetch = fetch): Promise<LeagueIndex> {
  const html = await get(`https://${source.host}/`, fetcher);
  const index = html ? buildIndex(source.host, html) : null;
  if (!index) throw new LeagueError("unreadable", "We couldn't read the CNR league site. Check the link and try again.");
  if (source.seasonStart && index.season.start && source.seasonStart !== index.season.start) {
    throw new LeagueError("season_over", `CNR has moved on to a new season (${index.season.label}). Paste the league link again to import the new season.`);
  }
  return index;
}

/** One team's games, with calendar-feed ids and gym addresses. */
export async function fetchTeamGames(index: LeagueIndex, teamKey: string, fetcher: typeof fetch = fetch): Promise<Game[]> {
  const html = await get(`https://${index.host}/teams/${teamKey}`, fetcher);
  if (html === null) throw new LeagueError("team_not_found", "That team's page isn't on the CNR site anymore.");
  const games = parseTeamGames(html);
  const feed = parseCalendarURL(html);
  const facilities = [...new Set(games.map((g) => g.facility).filter((f) => f))];
  const [ics, ...addresses] = await Promise.all([
    feed && new URL(feed).hostname.match(FEED_HOST_RE) ? get(feed, fetcher).catch(() => null) : Promise.resolve(null),
    ...facilities.map((f) => get(`https://${index.host}/facilities/${leagueSlug(f)}`, fetcher).then((h) => (h ? parseFacilityAddress(h) : null)).catch(() => null)),
  ]);
  const addressMap = new Map<string, string>();
  facilities.forEach((f, i) => {
    if (addresses[i]) addressMap.set(f, addresses[i]!);
  });
  return buildGames(index, teamKey, games, ics ? parseFeedUIDs(ics) : new Map(), addressMap);
}
