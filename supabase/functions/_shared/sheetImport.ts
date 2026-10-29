// Tournament schedule import from a published Google Sheet (DECISIONS D-042).
//
// Organizers type these sheets by hand, so nothing here trusts fixed columns. A game row is
// found by its content: a time ("4:00 PM"), a day or date before it, a location after it, and
// two team names with optional scores between them. Everything except `fetchSheet` is pure,
// so the parser and matcher are tested against a saved copy of a real tournament in
// supabase/tests/sheetImport_test.ts.

const DAY_MS = 24 * 3600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SheetTab {
  name: string;
  gid: string;
  csv: string;
}

export interface Venue {
  name: string;
  code: string;
  address: string;
}

export interface SheetTeam {
  key: string;
  name: string;
  grade: string | null;
  gender: "boys" | "girls" | null;
  coach: string | null;
  /** Tab name of the bracket the team plays in, when known. */
  bracket: string | null;
  bracketTitle: string | null;
}

export interface GameSide {
  /** The name exactly as the sheet shows it in the bracket tab (trimmed). */
  raw: string;
  /** Cleaned display name ("1st Place Game- X" → "X"). */
  name: string;
  teamKey: string | null;
  score: number | null;
  /** "Winner of Semi-Final Game", "TBD", "1st Place Pool A"… */
  placeholder: boolean;
}

export interface Game {
  key: string;
  bracket: string;
  bracketTitle: string;
  round: string | null;
  left: GameSide;
  right: GameSide;
  dayLabel: string;
  timeLabel: string;
  /** Local wall-clock start, "2026-10-03T16:00", or null when the date couldn't be worked out. */
  localStart: string | null;
  location: string | null;
  venue: Venue | null;
  court: string | null;
}

export interface Bracket {
  name: string;
  gid: string;
  title: string;
  /** Bracket-tab names that didn't connect to a listed team (and aren't placeholders). */
  unmatchedNames: string[];
}

export interface Tournament {
  title: string;
  /** Local dates the tournament covers, e.g. ["2026-10-03", "2026-10-04"]; empty when unknown. */
  dates: string[];
  venues: Venue[];
  /** Which side of a bracket row is the home team, when the organizer says so. */
  homeSide: "left" | "right" | null;
  /** The organizer's home-team rule, e.g. "Home team wears white". */
  homeNote: string | null;
  /** IANA zone from the venue addresses (MO → America/Chicago), when known. */
  timeZone: string | null;
  teams: SheetTeam[];
  brackets: Bracket[];
  games: Game[];
}

// ---------------------------------------------------------------------------
// Fetching (the only I/O)
// ---------------------------------------------------------------------------
export class SheetImportError extends Error {
  constructor(public code: "not_a_sheet" | "not_published" | "unreadable" | "no_games", message: string) {
    super(message);
  }
}

export interface SheetSource {
  kind: "published" | "shared";
  id: string;
  /** Canonical address we store and re-check. */
  url: string;
}

/**
 * Recognizes Google Sheets links: "Publish to web" links (`/d/e/2PACX…/pubhtml`) and ordinary
 * share links (`/d/<id>/edit`), which work when the sheet is shared with anyone who has the link.
 */
export function parseSheetURL(input: string): SheetSource | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
  const published = url.pathname.match(/\/spreadsheets(?:\/u\/\d+)?\/d\/e\/([A-Za-z0-9_-]{20,})/);
  if (published) {
    return { kind: "published", id: published[1], url: `https://docs.google.com/spreadsheets/d/e/${published[1]}/pubhtml` };
  }
  const shared = url.pathname.match(/\/spreadsheets(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{20,})/);
  if (shared) {
    return { kind: "shared", id: shared[1], url: `https://docs.google.com/spreadsheets/d/${shared[1]}/edit` };
  }
  return null;
}

/** Tab names and ids from the sheet's HTML view (`items.push({name: "…", …, gid: "…"})`). */
export function parseTabList(html: string): { name: string; gid: string }[] {
  const tabs: { name: string; gid: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)"[^}]*?gid: "(\d+)"/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    let name = m[1];
    try {
      name = JSON.parse(`"${m[1]}"`);
    } catch { /* keep the raw text */ }
    tabs.push({ name, gid: m[2] });
  }
  return tabs;
}

export function sheetTitle(html: string): string | null {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  if (!m) return null;
  return decodeEntities(m[1]).replace(/\s*-\s*Google (Drive|Sheets)\s*$/i, "").trim() || null;
}

const MAX_TABS = 40;
const FETCH_TIMEOUT_MS = 10_000;

/** Downloads every tab as CSV. Only ever fetches docs.google.com. */
/** Runs `fn` over `items` with at most `limit` in flight (Google throttles bursts from servers). */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function fetchSheet(source: SheetSource, fetcher: typeof fetch = fetch): Promise<{ title: string | null; tabs: SheetTab[] }> {
  // One retry after a timeout or a 429/5xx: Google slows down bursts from cloud servers.
  const once = (url: string) => fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const fetchWithRetry = async (url: string) => {
    try {
      const res = await once(url);
      if (res.status !== 429 && res.status < 500) return res;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "TimeoutError")) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500));
    return await once(url);
  };
  const get = async (url: string) => {
    const res = await fetchWithRetry(url);
    // Private sheets bounce to the Google sign-in page.
    if (res.status === 401 || res.status === 403 || new URL(res.url || url).hostname === "accounts.google.com") {
      throw new SheetImportError("not_published", "This sheet isn't shared publicly. Ask the organizer for the \"Publish to web\" link.");
    }
    if (res.status === 404) throw new SheetImportError("unreadable", "We couldn't find that sheet. It may have been unpublished, or the link is incomplete.");
    if (!res.ok) throw new SheetImportError("unreadable", `Google Sheets answered ${res.status}. Try again in a minute.`);
    return await res.text();
  };
  const listURL = source.kind === "published"
    ? `https://docs.google.com/spreadsheets/d/e/${source.id}/pubhtml`
    : `https://docs.google.com/spreadsheets/d/${source.id}/htmlview`;
  const html = await get(listURL);
  let tabs = parseTabList(html);
  if (tabs.length === 0) tabs = [{ name: "Sheet1", gid: "0" }];
  const csvURL = (gid: string) => source.kind === "published"
    ? `https://docs.google.com/spreadsheets/d/e/${source.id}/pub?output=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${gid}`;
  const csvs = await mapLimited(tabs.slice(0, MAX_TABS), 5, async (t) => ({ ...t, csv: await get(csvURL(t.gid)) }));
  return { title: sheetTitle(html), tabs: csvs };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/ /g, " ").trim()));
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
const GRADE_WORDS = /\b(\d{1,2})(st|nd|rd|th)\b(\s+grade)?/i;
const NOISE_TOKENS = new Set(["boys", "boy", "girls", "girl", "grade", "the", "team", "and"]);

/** "1st Place Game- Bradley  Beal Elite 2033" → "Bradley Beal Elite 2033". */
export function stripRoundLabel(raw: string): { name: string; label: string | null } {
  const m = raw.match(/^\s*((?:\d(?:st|nd|rd|th)\s+place|championship|consolation|semi[- ]?final|final|quarter[- ]?final|bronze|gold|silver)(?:\s+(?:game|match|round))?)\s*[-–—:]\s*(.+)$/i);
  if (m) return { name: m[2].replace(/\s+/g, " ").trim(), label: titleCase(m[1]) };
  return { name: raw.replace(/\s+/g, " ").trim(), label: null };
}

export function isPlaceholder(name: string): boolean {
  return /^(tbd|tba|bye)$/i.test(name.trim()) ||
    /\b(winner|loser|seed|tbd|tba)\b/i.test(name) ||
    /^\s*(\d(st|nd|rd|th)|first|second|third)\s+(place\s+)?(in\s+)?pool\b/i.test(name) ||
    /^\s*(\d(st|nd|rd|th)|first|second|third|fourth)\s+place(\s+(in\s+)?(pool\s+)?[a-z0-9])?\s*$/i.test(name) ||
    /^\s*pool\s+[a-z0-9]+\s*#?\s*\d\b/i.test(name);
}

/** Lowercase word tokens with grade/gender words removed: "3D Nation 2033 6th Boys" → ["3d","nation","2033"]. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(GRADE_WORDS, " ")
    .replace(/\b(freshmen|freshman|frosh|jv|varsity)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NOISE_TOKENS.has(t));
}

export function normalizeName(name: string): string {
  return nameTokens(name).join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Tokens match when equal, or one typo apart for words of 5+ letters ("Gensis" ≈ "Genesis"). */
function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  return Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1;
}

/**
 * 0…1 similarity of two team names, ignoring grade/gender words. A name that's fully contained
 * in the other ("Rise & Reign" in "Rise & Reign White") scores 0.9.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let common = 0;
  for (const x of ta) {
    const j = tb.findIndex((y, i) => !used.has(i) && tokenEq(x, y));
    if (j >= 0) {
      used.add(j);
      common++;
    }
  }
  const dice = (2 * common) / (ta.length + tb.length);
  const contained = common > 0 && common === Math.min(ta.length, tb.length) ? 0.9 : 0;
  return Math.max(dice, contained);
}

/** "6", "6th", "6th Grade" → "6"; "Freshmen"/"Frosh" → "9"; "JV" → "jv"; "Varsity" → "varsity". */
export function parseGrade(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  const n = v.match(/\b(\d{1,2})(st|nd|rd|th)?\b(?!\s*u\b)/);
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= 12) return String(Number(n[1]));
  if (/\b(freshm[ae]n|frosh)\b/.test(v)) return "9";
  if (/\bjv\b|junior varsity/.test(v)) return "jv";
  if (/\bvarsity\b/.test(v)) return "varsity";
  return null;
}

/** `loose` also accepts single letters (a "Gender" column's "M"/"F", a tab named "6B Carter"). */
export function parseGender(value: string | null | undefined, loose = false): "boys" | "girls" | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/\b(girls?|female|women|ladies)\b/.test(v) || (loose && /\b(f|w|g)\b/.test(v))) return "girls";
  if (/\b(boys?|male|men)\b/.test(v) || (loose && /\b(m|b)\b/.test(v))) return "boys";
  return null;
}

// ---------------------------------------------------------------------------
// Dates, times, places
// ---------------------------------------------------------------------------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TIME_RE = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i;

export function parseTime(value: string): { hour: number; minute: number } | null {
  const m = value.trim().match(TIME_RE);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (m[3].toLowerCase() === "p" && hour !== 12) hour += 12;
  if (m[3].toLowerCase() === "a" && hour === 12) hour = 0;
  return { hour, minute };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/**
 * The tournament's dates from text like "2026 CNR October 3-4 Tournament", "Oct 31 - Nov 1, 2026"
 * or "10/3-10/4/2026". Without a year in the text, `fallbackYear` is used.
 */
export function parseDateRange(text: string, fallbackYear: number): string[] {
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear;
  const expand = (y: number, m1: number, d1: number, m2: number, d2: number) => {
    const start = Date.UTC(y, m1 - 1, d1);
    let end = Date.UTC(m2 < m1 ? y + 1 : y, m2 - 1, d2);
    if (end < start || end - start > 6 * DAY_MS) end = start;
    const out: string[] = [];
    for (let t = start; t <= end; t += DAY_MS) {
      const d = new Date(t);
      out.push(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
    }
    return out;
  };
  const words = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:[-–—&]|to|and)\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (words && monthIndex(words[1]) >= 0) {
    const m1 = monthIndex(words[1]) + 1;
    const m2 = words[3] && monthIndex(words[3]) >= 0 ? monthIndex(words[3]) + 1 : m1;
    return expand(year, m1, Number(words[2]), m2, Number(words[4]));
  }
  const single = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (single && monthIndex(single[1]) >= 0) return expand(year, monthIndex(single[1]) + 1, Number(single[2]), monthIndex(single[1]) + 1, Number(single[2]));
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s*[-–—]\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\/\d{2,4})?\b/);
  if (numeric) {
    const m1 = Number(numeric[1]), m2 = numeric[3] ? Number(numeric[3]) : m1;
    if (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12) return expand(year, m1, Number(numeric[2]), m2, Number(numeric[4]));
  }
  return [];
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Sat" → the Saturday in `dates`; "10/3" or "Sat 10/3" or "October 3" → that date. */
export function resolveDay(value: string, dates: string[], year: number): string | null {
  const v = value.trim();
  const numeric = v.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const y = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : year;
    return ymd(y, Number(numeric[1]), Number(numeric[2]));
  }
  const words = v.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/);
  if (words && monthIndex(words[1]) >= 0) return ymd(year, monthIndex(words[1]) + 1, Number(words[2]));
  const day = WEEKDAYS.indexOf(v.slice(0, 3).toLowerCase());
  if (day >= 0) return dates.find((d) => weekdayOf(d) === day) ?? null;
  return null;
}

function isDayCell(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|urday|nesday|rsday|sday)?\.?$/.test(v) ||
    /^((sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+)?\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(v) ||
    /^((sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+)?[a-z]{3,9}\.?\s+\d{1,2}$/.test(v) && monthIndex(v.replace(/^[a-z]+\.?,?\s+(?=[a-z])/, "")) >= 0;
}

const STATE_ZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver",
};
const ADDRESS_RE = /^\d+\s+[^,]+,\s*[^,]+,\s*([A-Z]{2})\s+\d{5}(-\d{4})?$/;

export function zoneForAddress(address: string): string | null {
  const m = address.trim().match(ADDRESS_RE);
  return m ? STATE_ZONES[m[1]] ?? null : null;
}

/** "CSTL 5" → Center St. Louis, court "5"; "Beal Court 6" → Beal Center, court "6". */
export function resolveLocation(location: string, venues: Venue[]): { venue: Venue | null; court: string | null } {
  const loc = location.trim();
  const lower = loc.toLowerCase();
  let best: { venue: Venue; rest: string; len: number } | null = null;
  for (const v of venues) {
    for (const label of [v.code, v.name]) {
      const l = label.toLowerCase();
      if (l && (lower === l || lower.startsWith(`${l} `) || lower.startsWith(`${l}-`) || lower.startsWith(`${l}:`)) && (!best || l.length > best.len)) {
        best = { venue: v, rest: loc.slice(label.length), len: l.length };
      }
    }
  }
  if (!best) {
    // Organizers mistype codes ("CSL" on the info tab, "CSTL" in every game). Accept a code one
    // letter off, or the only venue when there's just one.
    const m = loc.match(/^(.*?)[\s:-]*(?:(?:court|ct\.?|gym)\s*)?(\d+[a-z]?)?$/i);
    const prefix = (m?.[1] ?? loc).trim().toLowerCase();
    const near = venues.filter((v) => prefix.length >= 2 && levenshtein(prefix, v.code.toLowerCase()) <= 1);
    const venue = near.length === 1 ? near[0] : venues.length === 1 && prefix.length > 0 ? venues[0] : null;
    return venue ? { venue, court: m?.[2] ?? null } : { venue: null, court: null };
  }
  const court = best.rest.replace(/^[\s:-]+/, "").replace(/^(court|ct\.?|gym)\s*/i, "").trim();
  return { venue: best.venue, court: court || null };
}

/** Converts a local wall-clock time in `tz` to an ISO instant (handles Daylight Saving). */
export function localToISO(localStart: string, tz: string): string {
  const [date, time] = localStart.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (ms: number) => {
    const parts: Record<string, number> = {};
    for (const p of new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(ms))) {
      if (p.type !== "literal") parts[p.type] = Number(p.value);
    }
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - (ms - (ms % 60_000));
  };
  const guess = wall - offset(wall);
  return new Date(wall - offset(guess)).toISOString();
}

// ---------------------------------------------------------------------------
// Parsing a whole sheet
// ---------------------------------------------------------------------------
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(\d)(St|Nd|Rd|Th)\b/g, (_, d, s2) => d + s2.toLowerCase());
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const isNumber = (v: string) => /^\d{1,3}$/.test(v.trim());
const filled = (row: string[]) => row.filter((c) => c !== "");

interface RawGame {
  tab: SheetTab;
  tabTitle: string;
  round: string | null;
  leftRaw: string;
  rightRaw: string;
  leftScore: number | null;
  rightScore: number | null;
  day: string;
  time: string;
  location: string | null;
}

/** Finds game rows in one tab. Returns the tab's title (first cell) too. */
function readGames(tab: SheetTab, rows: string[][]): { title: string; games: RawGame[] } {
  const title = filled(rows[0] ?? [])[0] ?? tab.name;
  const games: RawGame[] = [];
  let round: string | null = null;
  for (const row of rows) {
    const timeIdx = row.findIndex((c) => parseTime(c) !== null);
    if (timeIdx < 0) {
      // A short label alone on its row starts a new round: "Pool B", "Championship Round".
      const cells = filled(row);
      if (cells.length === 1 && cells[0].length <= 80 && /\b(pool|round|final|championship|semi|consolation|bracket|play|division|placement|crossover)\b/i.test(cells[0]) && cells[0] !== title) {
        round = cells[0].replace(/\s*\(.*\)\s*$/, "").trim();
      }
      continue;
    }
    // Day is the nearest day-looking cell before the time; teams and scores come before that.
    let dayIdx = -1;
    for (let i = timeIdx - 1; i >= 0; i--) {
      if (isDayCell(row[i])) {
        dayIdx = i;
        break;
      }
      if (row[i] !== "") break;
    }
    const end = dayIdx >= 0 ? dayIdx : timeIdx;
    const before = row.slice(0, end).map((c, i) => ({ c, i })).filter((x) => x.c !== "");
    const names = before.filter((x) => !isNumber(x.c) && !/^(vs\.?|v|@|at|-|won|lost|w|l|forfeit|ff)$/i.test(x.c));
    if (names.length < 2) continue;
    const left = names[0], right = names[names.length - 1];
    const scores = before.filter((x) => x.i > left.i && x.i < right.i && isNumber(x.c));
    const location = row.slice(timeIdx + 1).find((c) => c !== "") ?? null;
    games.push({
      tab, tabTitle: title, round,
      leftRaw: left.c, rightRaw: right.c,
      leftScore: scores.length === 2 ? Number(scores[0].c) : null,
      rightScore: scores.length === 2 ? Number(scores[1].c) : null,
      day: dayIdx >= 0 ? row[dayIdx] : "",
      time: row[timeIdx],
      location,
    });
  }
  return { title, games };
}

interface ListedTeam {
  name: string;
  grade: string | null;
  gender: "boys" | "girls" | null;
  coach: string | null;
  bracket: string | null;
}

/** A team list has a header row with "Team" and a bracket/division column. */
function readTeamList(rows: string[][]): ListedTeam[] | null {
  const headerIdx = rows.findIndex((r) => {
    const cells = r.map((c) => c.toLowerCase());
    return cells.some((c) => /^team( name)?$/.test(c)) && cells.some((c) => /^(bracket|division|pool|group|flight)$/.test(c));
  });
  if (headerIdx < 0) return null;
  const header = rows[headerIdx].map((c) => c.toLowerCase());
  const col = (re: RegExp) => header.findIndex((c) => re.test(c));
  const cTeam = col(/^team( name)?$/), cBracket = col(/^(bracket|division|pool|group|flight)$/);
  const cGrade = col(/^(grade|age|age group|level)$/), cGender = col(/^(gender|sex|boys\/girls)$/), cCoach = col(/^(head )?coach( name)?$/);
  const teams: ListedTeam[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = (r[cTeam] ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    teams.push({
      name,
      grade: parseGrade(cGrade >= 0 ? r[cGrade] : null) ?? parseGrade(name),
      gender: parseGender(cGender >= 0 ? r[cGender] : null, true) ?? parseGender(name),
      coach: cCoach >= 0 ? r[cCoach]?.replace(/\s+/g, " ").trim() || null : null,
      bracket: r[cBracket]?.trim() || null,
    });
  }
  return teams;
}

/**
 * A team's grade from the list's Grade column and from its name. They can disagree (CNR lists
 * "Knights Rubel Black 5th Girls" as grade 6), so either one counts as a match.
 */
function teamGrades(t: SheetTeam): string[] {
  return [...new Set([t.grade, parseGrade(t.name)].filter((g): g is string => g !== null))];
}

/** Connects a bracket-tab name to one listed team in that bracket, or null when unsure. */
export function matchInBracket(raw: string, candidates: SheetTeam[]): SheetTeam | null {
  // Grade words break ties: "Elite Status Freshmen" vs "Elite Status JV" in a Frosh/JV bracket.
  const rawGrade = parseGrade(raw);
  const scored = candidates
    .map((t) => {
      let s = nameSimilarity(raw, t.name);
      const grades = teamGrades(t);
      if (rawGrade && grades.length > 0) s += grades.includes(rawGrade) ? 0.05 : -0.2;
      return { t, s };
    })
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0 || scored[0].s < 0.6) return null;
  if (scored.length > 1 && scored[0].s - scored[1].s < 0.1) return null;
  return scored[0].t;
}

export function parseTournament(input: { title: string | null; tabs: SheetTab[] }, opts: { fallbackYear: number; firstDay?: string | null }): Tournament {
  const parsed = input.tabs.map((tab) => ({ tab, rows: parseCSV(tab.csv) }));

  // Venues, home rule, and dates come from the non-game text (usually an info tab).
  const venues: Venue[] = [];
  let homeSide: Tournament["homeSide"] = null;
  let homeNote: string | null = null;
  let title = "";
  const gameTabs: { tab: SheetTab; title: string; games: RawGame[] }[] = [];
  const listed: ListedTeam[] = [];
  for (const { tab, rows } of parsed) {
    const list = readTeamList(rows);
    if (list) {
      for (const t of list) {
        if (!listed.some((x) => x.name.toLowerCase() === t.name.toLowerCase() && x.bracket === t.bracket)) listed.push(t);
      }
      continue;
    }
    const read = readGames(tab, rows);
    if (read.games.length > 0) {
      gameTabs.push({ tab, title: read.title, games: read.games });
      continue;
    }
    if (!title && filled(rows[0] ?? []).length > 0) title = filled(rows[0])[0];
    for (const r of rows) {
      const cells = filled(r);
      const addrIdx = r.findIndex((c) => ADDRESS_RE.test(c));
      if (addrIdx > 0) {
        const labels = r.slice(0, addrIdx).filter((c) => c !== "");
        if (labels.length > 0) {
          const name = labels[0];
          const code = labels.length > 1 && labels[1].length <= 12 ? labels[1] : name;
          if (!venues.some((v) => v.code === code)) venues.push({ name, code, address: r[addrIdx] });
        }
      }
      const text = cells.join(" ");
      if (!homeSide && /\bhome\b/i.test(text) && /\b(right|left|bottom|top|second|first)\b/i.test(text)) {
        homeSide = /\b(right|bottom|second)\b/i.test(text) ? "right" : "left";
        const color = text.match(/\b(white|light|dark|black|blue|red)\b/i);
        homeNote = color ? `Home team wears ${color[1].toLowerCase()}` : null;
      }
    }
  }
  title = title || input.title || "Tournament";
  const fallbackYear = opts.fallbackYear;
  let dates = parseDateRange(title, fallbackYear);
  if (dates.length === 0 && input.title) dates = parseDateRange(input.title, fallbackYear);
  if (dates.length === 0 && opts.firstDay && /^\d{4}-\d{2}-\d{2}$/.test(opts.firstDay)) {
    // The coach told us when it starts; cover a long weekend from there.
    const [y, m, d] = opts.firstDay.split("-").map(Number);
    dates = [0, 1, 2].map((i) => {
      const t = new Date(Date.UTC(y, m - 1, d) + i * DAY_MS);
      return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    });
  }
  const year = dates.length > 0 ? Number(dates[0].slice(0, 4)) : fallbackYear;
  const timeZone = venues.map((v) => zoneForAddress(v.address)).find((z) => z) ?? null;

  // Teams: the organizer's list when there is one, connected to bracket tabs by name.
  const tabByBracket = (bracket: string | null) => {
    if (!bracket) return null;
    const b = bracket.toLowerCase().replace(/\s+/g, " ").trim();
    return gameTabs.find((g) => g.tab.name.toLowerCase().replace(/\s+/g, " ").trim() === b) ??
      gameTabs.find((g) => g.title.toLowerCase().includes(b)) ?? null;
  };
  const teams: SheetTeam[] = listed.map((t) => {
    const tab = tabByBracket(t.bracket);
    return {
      key: `${slug(tab?.tab.name ?? t.bracket ?? "team")}:${slug(t.name)}`,
      name: t.name, grade: t.grade, gender: t.gender, coach: t.coach,
      bracket: tab?.tab.name ?? t.bracket, bracketTitle: tab?.title ?? null,
    };
  });

  const brackets: Bracket[] = [];
  const games: Game[] = [];
  for (const g of gameTabs) {
    const inBracket = teams.filter((t) => t.bracket === g.tab.name);
    const tabGrade = parseGrade(g.title) ?? parseGrade(g.tab.name);
    const tabGender = parseGender(g.title) ?? parseGender(g.tab.name.replace(/^(\S*?\d)\s*([BG])\b/i, "$1 $2"), true);
    const unmatched = new Set<string>();
    const sideFor = (raw: string, score: number | null): GameSide => {
      const { name } = stripRoundLabel(raw);
      const placeholder = isPlaceholder(name);
      let team = placeholder ? null : matchInBracket(name, inBracket);
      if (!team && !placeholder) {
        if (listed.length === 0) {
          // No team list: the bracket tabs are the list.
          const key = `${slug(g.tab.name)}:${slug(normalizeName(name) || name)}`;
          team = teams.find((t) => t.key === key) ?? null;
          if (!team) {
            team = { key, name, grade: tabGrade, gender: tabGender, coach: null, bracket: g.tab.name, bracketTitle: g.title };
            teams.push(team);
            inBracket.push(team);
          }
        } else {
          unmatched.add(name);
        }
      }
      return { raw, name, teamKey: team?.key ?? null, score, placeholder };
    };
    const occurrences = new Map<string, number>();
    for (const r of g.games) {
      const left = sideFor(r.leftRaw, r.leftScore);
      const right = sideFor(r.rightRaw, r.rightScore);
      const label = stripRoundLabel(r.leftRaw).label ?? stripRoundLabel(r.rightRaw).label;
      const round = label ?? r.round;
      const date = resolveDay(r.day, dates, year);
      const t = parseTime(r.time)!;
      const { venue, court } = r.location ? resolveLocation(r.location, venues) : { venue: null, court: null };
      const pair = [left.teamKey ?? slug(left.name), right.teamKey ?? slug(right.name)].sort().join("~");
      const base = `${g.tab.gid}|${slug(round ?? "games")}|${pair}`;
      const n = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, n);
      games.push({
        key: `${base}|${n}`,
        bracket: g.tab.name, bracketTitle: g.title, round,
        left, right,
        dayLabel: r.day, timeLabel: r.time,
        localStart: date ? `${date}T${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}` : null,
        location: r.location, venue, court,
      });
    }
    brackets.push({ name: g.tab.name, gid: g.tab.gid, title: g.title, unmatchedNames: [...unmatched] });
  }

  return { title, dates, venues, homeSide, homeNote, timeZone, teams, brackets, games };
}

/** Games for one team; `alias` is a bracket-tab name the coach said is theirs. */
export function gamesForTeam(t: Tournament, teamKey: string, alias?: string | null): Game[] {
  const team = t.teams.find((x) => x.key === teamKey);
  const aliasName = alias?.trim().toLowerCase();
  return t.games.filter((g) =>
    g.left.teamKey === teamKey || g.right.teamKey === teamKey ||
    (aliasName && team && g.bracket === team.bracket &&
      (g.left.name.toLowerCase() === aliasName || g.right.name.toLowerCase() === aliasName))
  );
}

/** Which side of `game` is our team. */
export function ourSide(game: Game, teamKey: string, alias?: string | null): "left" | "right" {
  if (game.left.teamKey === teamKey) return "left";
  if (game.right.teamKey === teamKey) return "right";
  return alias && game.left.name.toLowerCase() === alias.trim().toLowerCase() ? "left" : "right";
}

// ---------------------------------------------------------------------------
// Matching the coach's ClubHQ team to a sheet team
// ---------------------------------------------------------------------------
export interface TeamHints {
  teamName: string;
  ageGroup?: string | null;
  /** The importing coach plus the team's other head coaches. */
  coachNames: string[];
  /** Normalized sheet names this ClubHQ team was matched to before. */
  aliases?: string[];
}

export interface MatchResult {
  outcome: "clear" | "choices" | "none";
  /** Best first; one key for "clear", up to 6 for "choices". */
  teamKeys: string[];
  scores: Record<string, number>;
}

function coachScore(sheetCoach: string | null, coachNames: string[]): number {
  if (!sheetCoach) return 0;
  const sheet = sheetCoach.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);
  let best = 0;
  for (const name of coachNames) {
    const words = name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);
    if (words.length === 0) continue;
    const last = words[words.length - 1], first = words[0];
    const hasLast = words.length > 1 && sheet.some((w) => tokenEq(w, last));
    const hasFirst = sheet.some((w) => tokenEq(w, first));
    best = Math.max(best, hasLast && hasFirst ? 1 : hasLast ? 0.6 : 0);
  }
  return best;
}

/** Share of the coach's own name words found in a sheet name: "Gold" missing from "…Blue…" counts against it. */
function hintCoverage(hint: string, name: string): number {
  const th = nameTokens(hint), tn = nameTokens(name);
  if (th.length === 0) return 0;
  return th.filter((x) => tn.some((y) => tokenEq(x, y))).length / th.length;
}

export function scoreTeams(teams: SheetTeam[], hints: TeamHints, gameCounts: Record<string, number> = {}): MatchResult {
  const grade = parseGrade(hints.ageGroup) ?? parseGrade(hints.teamName);
  const gender = parseGender(hints.ageGroup) ?? parseGender(hints.teamName);
  const aliases = new Set((hints.aliases ?? []).map((a) => normalizeName(a)));
  const scores: Record<string, number> = {};
  for (const t of teams) {
    let s = 0.55 * nameSimilarity(hints.teamName, t.name) * hintCoverage(hints.teamName, t.name) + 0.35 * coachScore(t.coach, hints.coachNames);
    const grades = teamGrades(t);
    if (grade && grades.length > 0) s += grades.includes(grade) ? 0.15 : -0.25;
    if (gender && t.gender) s += gender === t.gender ? 0.05 : -0.25;
    if (aliases.has(normalizeName(t.name))) s += 0.7;
    if ((gameCounts[t.key] ?? 1) === 0) s -= 0.05;
    scores[t.key] = Math.round(s * 1000) / 1000;
  }
  const ranked = teams.map((t) => t.key).sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0];
  if (!top || scores[top] < 0.3) return { outcome: "none", teamKeys: [], scores };
  const second = ranked[1];
  if (scores[top] >= 0.6 && (!second || scores[top] - scores[second] >= 0.15)) {
    return { outcome: "clear", teamKeys: [top], scores };
  }
  const close = ranked.filter((k) => scores[k] >= Math.max(0.3, scores[top] - 0.25)).slice(0, 6);
  return { outcome: "choices", teamKeys: close, scores };
}
