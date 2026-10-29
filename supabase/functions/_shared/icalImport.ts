// Team calendar import from an iCal (.ics) subscription link (DECISIONS D-047, roadmap #3).
//
// TeamSnap, GameChanger, SportsEngine, LeagueApps, PlayMetrics, TeamLinkt, Spond, Google
// Calendar, Apple Calendar and Outlook all publish a team's schedule as an .ics feed. A feed is
// one team's calendar, so there is no team to pick: every event is ours. Games, practices and
// other events are told apart by their titles ("vs Lions", "@ Lions", "Practice").
// The output is the same `Tournament` shape the Google Sheets reader produces, so import-preview,
// import-commit, Check for Changes, Remove Games and the scheduled re-check work unchanged.
// Parsing is pure and tested in supabase/tests/icalImport_test.ts; only `fetchCalendar` does I/O.
import { type Game, type GameSide, localToISO, nameSimilarity, normalizeName, type Tournament, type Venue, zoneForAddress } from "./sheetImport.ts";
import { validTimeZone } from "./time.ts";

/** The one "team" in a calendar feed. */
export const CALENDAR_TEAM_KEY = "calendar";
const DAY_MS = 24 * 3600_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 4_000_000;
const MAX_REDIRECTS = 4;
/** Events are imported from two weeks back (recent results, this week) to about a year ahead. */
export const WINDOW_PAST_DAYS = 14;
const WINDOW_FUTURE_DAYS = 400;
const MAX_EVENTS = 400;
const MAX_OCCURRENCES_PER_RULE = 400;
const DEFAULT_MINUTES = { game: 60, practice: 90, other: 60 };

export type CalendarEventType = "game" | "practice" | "other";

export interface CalendarSource {
  /** Address we fetch and store (webcal:// becomes https://). */
  url: string;
  /** "TeamSnap", "GameChanger"… from the host, for the "Read from …" line. */
  provider: string;
}

export class CalendarError extends Error {
  constructor(public code: "not_a_calendar" | "not_published" | "unreadable" | "no_games", message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
const PROVIDERS: [RegExp, string][] = [
  [/(^|\.)teamsnap\.com$/, "TeamSnap"],
  [/(^|\.)(gc\.com|gamechanger\.io|gamechanger\.com)$/, "GameChanger"],
  [/(^|\.)(sportsengine\.com|sportngin\.com|ngin\.com)$/, "SportsEngine"],
  [/(^|\.)leagueapps\.(com|io)$/, "LeagueApps"],
  [/(^|\.)playmetrics\.com$/, "PlayMetrics"],
  [/(^|\.)exposureevents\.com$/, "Exposure Events"],
  [/(^|\.)teamlinkt\.com$/, "TeamLinkt"],
  [/(^|\.)spond\.com$/, "Spond"],
  [/(^|\.)heja\.io$/, "Heja"],
  [/(^|\.)demosphere(-secure)?\.com$/, "Demosphere"],
  [/(^|\.)byga\.net$/, "BYGA"],
  [/(^|\.)stack(sports|teamapp)\.com$/, "Stack Sports"],
  [/(^|\.)teamapp\.com$/, "Team App"],
  [/(^|\.)calendar\.google\.com$/, "Google Calendar"],
  [/(^|\.)icloud\.com$/, "Apple Calendar"],
  [/(^|\.)(outlook\.office365\.com|outlook\.live\.com|office\.com)$/, "Outlook"],
];

export function providerFor(host: string): string {
  const h = host.toLowerCase();
  return PROVIDERS.find(([re]) => re.test(h))?.[1] ?? h.replace(/^www\./, "");
}

/** True for hosts a server must never fetch on a user's behalf (loopback, private networks, link-local). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(h) || !h.includes(".")) return true;
  if (h.startsWith("[") || h.includes(":")) return true; // IPv6 literals: no real feed uses one
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  // Numeric forms browsers accept ("2130706433", "0x7f.1") resolve to IPs too.
  return /^[0-9.]+$/.test(h) || /^0x/i.test(h);
}

/**
 * Any http(s) or webcal link that could be a calendar feed. A Google Calendar share link
 * (`calendar.google.com/calendar/u/0?cid=…` or `…/embed?src=…`) becomes its public .ics address.
 * Whether it really is a calendar is only known after fetching it.
 */
export function parseCalendarURL(input: string): CalendarSource | null {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return null;
  if (isPrivateHost(url.hostname)) return null;
  const host = url.hostname.toLowerCase();
  if (host === "calendar.google.com" && !url.pathname.includes("/ical/")) {
    const cid = url.searchParams.get("cid") ?? url.searchParams.get("src");
    if (cid) {
      let id = cid;
      // Share links carry the calendar id base64-encoded (no "@" in the encoded form).
      if (!cid.includes("@")) {
        try {
          const decoded = atob(cid.replace(/-/g, "+").replace(/_/g, "/"));
          if (/^[\w.+-]+@[\w.-]+$/.test(decoded)) id = decoded;
        } catch { /* not base64; use as is */ }
      }
      return { url: `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`, provider: "Google Calendar" };
    }
  }
  url.hash = "";
  return { url: url.toString(), provider: providerFor(host) };
}

// ---------------------------------------------------------------------------
// Parsing .ics text
// ---------------------------------------------------------------------------
interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

type Component = { type: string; props: Prop[]; children: Component[] };

/** RFC 5545 lines: unfold continuation lines, then split NAME;PARAM=…:VALUE. */
export function parseICS(text: string): Component | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const root: Component = { type: "ROOT", props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of lines) {
    if (!line.trim()) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    const top = stack[stack.length - 1];
    if (prop.name === "BEGIN") {
      const c: Component = { type: prop.value.toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (prop.name === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(prop);
    }
  }
  return root.children.find((c) => c.type === "VCALENDAR") ?? null;
}

function parseLine(line: string): Prop | null {
  // The value starts at the first ":" that isn't inside a quoted parameter.
  let inQuote = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** TEXT values: \n, \, \; and \\ escapes. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c)).trim();
}

const prop = (c: Component, name: string) => c.props.find((p) => p.name === name);
const props = (c: Component, name: string) => c.props.filter((p) => p.name === name);
const text = (c: Component, name: string) => {
  const p = prop(c, name);
  return p ? unescapeText(p.value) : "";
};

// ---------------------------------------------------------------------------
// Dates and zones
// ---------------------------------------------------------------------------
const WINDOWS_ZONES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "us eastern standard time": "America/Indiana/Indianapolis",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "us mountain standard time": "America/Phoenix",
  "pacific standard time": "America/Los_Angeles",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "atlantic standard time": "America/Halifax",
  "gmt standard time": "Europe/London",
  "utc": "UTC",
};

/** An IANA zone for a TZID: "America/Chicago", "Central Standard Time", "/mozilla.org/…/America/Chicago". */
export function zoneForTZID(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const clean = tzid.trim().replace(/^"|"$/g, "");
  const direct = validTimeZone(clean);
  if (direct) return direct;
  const windows = WINDOWS_ZONES[clean.toLowerCase()];
  if (windows) return windows;
  const tail = clean.match(/([A-Za-z_]+\/[A-Za-z_-]+(?:\/[A-Za-z_-]+)?)$/)?.[1];
  return tail ? validTimeZone(tail) : null;
}

/** A DTSTART/DTEND/RECURRENCE-ID/EXDATE value as wall-clock time plus how to read it. */
interface When {
  /** "2026-11-07T09:30" (midnight for all-day dates). */
  local: string;
  /** "UTC" for …Z, an IANA zone for TZID=…, null for floating (the team's zone). */
  zone: string | null;
  allDay: boolean;
}

export function parseWhen(value: string, params: Record<string, string>): When | null {
  const v = value.trim();
  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) return { local: `${d[1]}-${d[2]}-${d[3]}T00:00`, zone: null, allDay: true };
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!t) return null;
  const local = `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}`;
  if (t[7]) return { local, zone: "UTC", allDay: false };
  return { local, zone: zoneForTZID(params.TZID), allDay: params.VALUE === "DATE" };
}

/** The instant for a `When`; floating times use `fallbackZone`. */
function instant(w: When, fallbackZone: string): number {
  if (w.zone === "UTC") return Date.parse(`${w.local}:00Z`);
  return Date.parse(localToISO(w.local, w.zone ?? fallbackZone));
}

/** "PT1H30M", "P1D" → minutes. */
export function parseDuration(value: string): number | null {
  const m = value.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const [w, d, h, min] = [m[2], m[3], m[4], m[5]].map((x) => Number(x ?? 0));
  const total = ((w * 7 + d) * 24 + h) * 60 + min;
  return m[1] === "-" ? null : total;
}

function addDaysLocal(local: string, days: number): string {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.toISOString().slice(0, 10)}T${time}`;
}

function addMonthsLocal(local: string, months: number): string | null {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  if (dt.getUTCDate() !== d) return null; // Jan 31 + 1 month: no Feb 31, so that month is skipped (RFC 5545)
  return `${dt.toISOString().slice(0, 10)}T${time}`;
}

function weekdayOfLocal(local: string): number {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Occurrence start times (wall clock, same zone as DTSTART) of a recurring event. Handles what
 * team apps and Google/Apple calendars emit: DAILY/WEEKLY/MONTHLY with INTERVAL, COUNT, UNTIL,
 * BYDAY (weekly) and BYMONTHDAY. Anything else yields just the first occurrence.
 */
export function expandRule(start: When, rrule: string, untilMs: number, zone: string): string[] {
  const rule: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) rule[k.toUpperCase()] = v.toUpperCase();
  }
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1);
  const count = rule.COUNT ? Math.min(Number(rule.COUNT) || 1, MAX_OCCURRENCES_PER_RULE) : MAX_OCCURRENCES_PER_RULE;
  let until = untilMs;
  if (rule.UNTIL) {
    const u = parseWhen(rule.UNTIL, {});
    if (u) until = Math.min(until, u.allDay ? instant({ ...u, local: u.local.replace("T00:00", "T23:59") }, zone) : instant(u, zone));
  }
  const out: string[] = [];
  const push = (local: string) => {
    if (out.length >= count) return false;
    if (instant({ ...start, local }, zone) > until) return false;
    out.push(local);
    return true;
  };
  const freq = rule.FREQ;
  if (freq === "DAILY") {
    for (let i = 0; i < MAX_OCCURRENCES_PER_RULE * interval; i += interval) if (!push(addDaysLocal(start.local, i))) break;
  } else if (freq === "WEEKLY") {
    const days = (rule.BYDAY ?? "").split(",").map((d) => BYDAY[d.replace(/^[+-]?\d+/, "")]).filter((d) => d !== undefined);
    const weekdays = days.length > 0 ? [...new Set(days)].sort() : [weekdayOfLocal(start.local)];
    // Weeks start on the DTSTART's week (Sunday-based is fine for team schedules).
    const weekStart = addDaysLocal(start.local, -weekdayOfLocal(start.local));
    outer: for (let w = 0; w < MAX_OCCURRENCES_PER_RULE; w += 1) {
      for (const wd of weekdays) {
        const local = addDaysLocal(weekStart, w * 7 * interval + wd);
        if (local < start.local) continue;
        if (!push(local)) break outer;
      }
    }
  } else if (freq === "MONTHLY" && !rule.BYDAY) {
    const monthDays = (rule.BYMONTHDAY ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 31);
    outer: for (let i = 0; i < MAX_OCCURRENCES_PER_RULE; i++) {
      const base = addMonthsLocal(`${start.local.slice(0, 8)}01T${start.local.slice(11)}`, i * interval)!;
      const targets = monthDays.length > 0 ? monthDays.sort((a, b) => a - b) : [Number(start.local.slice(8, 10))];
      for (const day of targets) {
        const local = addMonthsLocal(`${base.slice(0, 8)}${String(day).padStart(2, "0")}T${start.local.slice(11)}`, 0);
        if (!local || local < start.local) continue;
        if (!push(local)) break outer;
      }
    }
  } else {
    push(start.local);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What an event is
// ---------------------------------------------------------------------------
export interface Classified {
  eventType: CalendarEventType;
  /** Our team's name when the title names both teams ("Hawks vs Eagles"). */
  us: string | null;
  opponent: string | null;
  homeAway: "home" | "away" | null;
}

const PRACTICE_RE = /\b(practice|practise|training|workout|work-out|conditioning|skills?\s+(session|clinic|work)|shoot-?around|walk-?through|open gym|film session|lift(ing)?)\b/i;
const GAME_PREFIX_RE = /^\s*(?:game|match|scrimmage|league game|tournament game|playoff(?: game)?)\s*(?:\d+\s*)?[:\-–—#]?\s*/i;
const HOME_AWAY_RE = /\s*[\(\[]\s*(home|away)\s*[\)\]]\s*|\s+[-–—]\s+(home|away)\s*$|^\s*(home|away)\s*(?:game)?\s*[:\-–—]\s*/i;

function cleanName(s: string): string {
  return s.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, "").replace(/^[\s:\-–—]+|[\s:\-–—,.]+$/g, "").trim();
}

/**
 * Reads a title: "Practice" → practice; "vs. Lions", "Hawks vs Lions", "@ Lions", "Game at Lions",
 * "Hawks at Lions (Away)" → game; anything else → other. `ourNames` are names that appear in
 * most game titles of the feed (our own team), so "Hawks at Lions" puts us on the right side.
 */
export function classifyTitle(summary: string, categories: string, ourNames: Set<string> = new Set()): Classified {
  let s = summary.replace(/\s+/g, " ").trim();
  let homeAway: "home" | "away" | null = null;
  const marker = s.match(HOME_AWAY_RE);
  if (marker) {
    homeAway = (marker[1] ?? marker[2] ?? marker[3]).toLowerCase() as "home" | "away";
    s = s.replace(HOME_AWAY_RE, " ").trim();
  }
  const cat = categories.toLowerCase();
  const gamePrefix = GAME_PREFIX_RE.test(s);
  const gameMarked = gamePrefix || /\b(game|match)\b/.test(cat);
  if (gamePrefix) s = s.replace(GAME_PREFIX_RE, "").trim();

  const vs = s.match(/^(.*?)(?:^|\s)(?:vs\.?|versus|v\.?)\s+(.+)$/i);
  const at = s.match(/^(.*?)\s*@\s*(.+)$/) ?? ((gameMarked || /^at\s/i.test(s) || ourNames.size > 0) ? s.match(/^(.*?)(?:^|\s)at\s+(.+)$/i) : null);
  const hit = vs ?? at;
  const isOurs = (name: string) => [...ourNames].some((n) => normalizeName(name) === n || nameSimilarity(name, n) >= 0.85);
  if (hit && !PRACTICE_RE.test(hit[1])) {
    const left = cleanName(hit[1]), right = cleanName(hit[2]);
    // "at" needs a game marker or our own name on the left, so "Team photo at Lifetime" stays an event.
    if (right && (vs || /@/.test(s) || gameMarked || /^at\s/i.test(s) || (left && isOurs(left)))) {
      if (!left || isOurs(left) || !isOurs(right)) {
        // Team apps write home games "vs" and away games "@"/"at".
        return { eventType: "game", us: left || null, opponent: right, homeAway: homeAway ?? (vs ? "home" : "away") };
      }
      // Our name is on the right: "Lions @ Hawks" means we're home; "Lions vs Hawks" doesn't say.
      return { eventType: "game", us: right, opponent: left, homeAway: homeAway ?? (vs ? null : "home") };
    }
  }
  if (PRACTICE_RE.test(summary) || /\bpractice\b/.test(cat)) return { eventType: "practice", us: null, opponent: null, homeAway: null };
  // "Game: Lions" names the opponent; a bare "Game 3" doesn't.
  if (gameMarked) return { eventType: "game", us: null, opponent: gamePrefix ? cleanName(s) || null : null, homeAway };
  return { eventType: "other", us: null, opponent: null, homeAway: null };
}

/** Names that appear on the left of most "A vs B" titles: our team, written the way the feed writes it. */
export function frequentNames(summaries: string[]): Set<string> {
  const counts = new Map<string, number>();
  let games = 0;
  for (const s of summaries) {
    const c = classifyTitle(s, "");
    if (c.eventType !== "game") continue;
    games++;
    for (const n of [c.us, c.opponent]) {
      if (!n) continue;
      const k = normalizeName(n);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  if (games < 2) return out;
  for (const [k, n] of counts) if (n >= Math.max(2, games * 0.5)) out.add(k);
  return out;
}

/** "Lifetime Fitness, 123 Main St, Chesterfield, MO 63017" → venue name and street address. */
export function splitLocation(location: string): { name: string; address: string | null } {
  const loc = location.replace(/\s+/g, " ").trim();
  const addr = loc.match(/\b\d+[^,]*,\s*[^,]+,\s*[A-Z]{2}\b(?:\s+\d{5}(?:-\d{4})?)?(?:,\s*(?:USA|United States))?$/);
  if (!addr) return { name: loc, address: null };
  const before = loc.slice(0, addr.index).replace(/[,\s\-–—]+$/, "").trim();
  return { name: before || addr[0], address: addr[0].replace(/,\s*(USA|United States)$/, "") };
}

// ---------------------------------------------------------------------------
// The whole calendar
// ---------------------------------------------------------------------------
export interface CalendarRead {
  tournament: Tournament;
  /** Events left out: all-day items (tournament placeholders, picture day) and cancelled ones. */
  skippedAllDay: number;
}

/** A short, stable key for an event (or one occurrence): `ics|<hash of UID>|<YYYYMMDD>`. */
export function eventKey(uid: string, occurrence: string | null): string {
  return occurrence ? `ics|${hash(uid)}|${occurrence.slice(0, 10).replace(/-/g, "")}` : `ics|${hash(uid)}`;
}

function hash(s: string): string {
  // cyrb53: fast, stable, and plenty for telling a calendar's events apart.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

interface Occurrence {
  key: string;
  summary: string;
  categories: string;
  description: string;
  location: string;
  start: When;
  minutes: number | null;
  status: string;
}

/**
 * Reads an .ics feed into the shared shape: one team (the calendar), and one `Game` per event
 * from `now − WINDOW_PAST_DAYS` to about a year ahead. Each carries its own type, title, start
 * instant and length. `fallbackZone` reads times written without a zone ("floating").
 */
export function parseCalendar(
  icsText: string,
  opts: { now: number; fallbackZone?: string | null; provider?: string | null },
): CalendarRead {
  const cal = parseICS(icsText);
  if (!cal) throw new CalendarError("not_a_calendar", "That link didn't return a calendar.");
  const calName = text(cal, "X-WR-CALNAME").slice(0, 120) || null;
  const calZone = zoneForTZID(text(cal, "X-WR-TIMEZONE")) ??
    cal.children.filter((c) => c.type === "VTIMEZONE").map((c) => zoneForTZID(text(c, "TZID"))).find((z) => z) ?? null;
  const windowStart = opts.now - WINDOW_PAST_DAYS * DAY_MS;
  const windowEnd = opts.now + WINDOW_FUTURE_DAYS * DAY_MS;

  const vevents = cal.children.filter((c) => c.type === "VEVENT");
  // Moved or edited single occurrences of a recurring event (same UID + RECURRENCE-ID).
  const overrides = new Map<string, Component>();
  for (const e of vevents) {
    const rid = prop(e, "RECURRENCE-ID");
    if (rid) overrides.set(`${text(e, "UID")}|${rid.value.trim().slice(0, 8)}`, e);
  }

  let skippedAllDay = 0;
  const firstZone = vevents.map((e) => parseWhen(prop(e, "DTSTART")?.value ?? "", prop(e, "DTSTART")?.params ?? {})?.zone)
    .find((z) => z && z !== "UTC") ?? null;
  const zone = calZone ?? firstZone ?? opts.fallbackZone ?? "America/Chicago";
  const fallbackZone = opts.fallbackZone ?? null;
  const occurrences: Occurrence[] = [];
  /** The event's length in minutes, from DURATION or DTEND − DTSTART (null: use the default). */
  const lengthOf = (e: Component): number | null => {
    const dur = prop(e, "DURATION");
    if (dur) return parseDuration(dur.value);
    const sp = prop(e, "DTSTART"), ep = prop(e, "DTEND");
    const start = sp ? parseWhen(sp.value, sp.params) : null, end = ep ? parseWhen(ep.value, ep.params) : null;
    if (!start || !end || end.allDay) return null;
    const m = Math.round((instant(end, zone) - instant(start, zone)) / 60_000);
    return m > 0 && m <= 24 * 60 ? m : null;
  };
  const read = (e: Component, start: When, key: string): Occurrence => ({
    key,
    summary: text(e, "SUMMARY").slice(0, 200) || "Event",
    categories: props(e, "CATEGORIES").map((p) => unescapeText(p.value)).join(","),
    description: text(e, "DESCRIPTION"),
    location: text(e, "LOCATION"),
    start,
    minutes: lengthOf(e),
    status: text(e, "STATUS").toUpperCase(),
  });

  for (const e of vevents) {
    if (prop(e, "RECURRENCE-ID")) continue;
    const sp = prop(e, "DTSTART");
    const start = sp ? parseWhen(sp.value, sp.params) : null;
    if (!start) continue;
    const uid = text(e, "UID") || `${text(e, "SUMMARY")}|${sp!.value}`;
    const rrule = prop(e, "RRULE")?.value;
    if (!rrule) {
      if (start.allDay) {
        if (instant(start, zone) >= windowStart && instant(start, zone) <= windowEnd) skippedAllDay++;
        continue;
      }
      occurrences.push(read(e, start, eventKey(uid, null)));
      continue;
    }
    if (start.allDay) continue;
    const exdates = new Set(props(e, "EXDATE").flatMap((p) => p.value.split(",").map((v) => v.trim().slice(0, 8))));
    for (const local of expandRule(start, rrule, windowEnd, zone)) {
      const ymd = local.slice(0, 10).replace(/-/g, "");
      if (exdates.has(ymd)) continue;
      const override = overrides.get(`${uid}|${ymd}`);
      if (override) {
        const op = prop(override, "DTSTART");
        const os = op ? parseWhen(op.value, op.params) : null;
        if (os && !os.allDay) occurrences.push(read(override, os, eventKey(uid, local)));
        continue;
      }
      occurrences.push(read(e, { ...start, local }, eventKey(uid, local)));
    }
  }

  const inWindow = occurrences
    .filter((o) => o.status !== "CANCELLED" && !/^\s*(cancel+ed|postponed)\b/i.test(o.summary))
    .filter((o) => {
      const t = instant(o.start, zone);
      return t >= windowStart && t <= windowEnd;
    })
    .sort((a, b) => instant(a.start, zone) - instant(b.start, zone))
    .slice(0, MAX_EVENTS);

  const ourNames = frequentNames(inWindow.map((o) => o.summary));
  if (calName) ourNames.add(normalizeName(calName));
  const teamName = calName ?? (opts.provider ? `${opts.provider} calendar` : "Team calendar");
  const venues: Venue[] = [];
  const seen = new Set<string>();
  const games: Game[] = inWindow.map((o) => {
    // Two occurrences can share a key when a feed repeats an event; keep the first.
    let key = o.key;
    for (let n = 2; seen.has(key); n++) key = `${o.key}~${n}`;
    seen.add(key);
    const c = classifyTitle(o.summary, o.categories, ourNames);
    const startMs = instant(o.start, zone);
    const localStart = isoToLocal(startMs, zone);
    const loc = o.location ? splitLocation(o.location) : null;
    const venue: Venue | null = loc ? { name: loc.name.slice(0, 200), code: loc.name.slice(0, 200), address: loc.address ?? "" } : null;
    if (venue && !venues.some((v) => v.name === venue.name)) venues.push(venue);
    const us: GameSide = { raw: teamName, name: teamName, teamKey: CALENDAR_TEAM_KEY, score: null, placeholder: false };
    const them: GameSide = c.eventType === "game"
      ? { raw: c.opponent ?? "TBD", name: c.opponent ?? "TBD", teamKey: null, score: null, placeholder: !c.opponent }
      : { raw: "", name: "", teamKey: null, score: null, placeholder: false };
    const [hh, mm] = localStart.slice(11).split(":").map(Number);
    return {
      key,
      bracket: CALENDAR_TEAM_KEY,
      bracketTitle: teamName,
      round: null,
      left: us,
      right: them,
      dayLabel: localStart.slice(0, 10),
      timeLabel: `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`,
      localStart,
      location: loc?.name ?? null,
      venue: venue && venue.address ? venue : null,
      court: null,
      calendar: {
        eventType: c.eventType,
        title: o.summary,
        startsAt: new Date(startMs).toISOString(),
        minutes: o.minutes ?? DEFAULT_MINUTES[c.eventType],
        homeAway: c.homeAway,
        notes: o.description ? o.description.slice(0, 1500) : null,
      },
    };
  });

  const dates = games.map((g) => g.localStart!.slice(0, 10));
  return {
    tournament: {
      title: (calName ?? (opts.provider ? `${opts.provider} schedule` : "Team calendar")).slice(0, 200),
      dates: dates.length > 0 ? [dates[0], dates[dates.length - 1]] : [],
      venues: venues.filter((v) => v.address),
      homeSide: null,
      homeNote: null,
      // The zone floating times were read in, so preview and saved times agree.
      timeZone: calZone ?? firstZone ?? fallbackZone ?? venues.map((v) => (v.address ? zoneForAddress(v.address) : null)).find((z) => z) ?? null,
      teams: [{ key: CALENDAR_TEAM_KEY, name: teamName, grade: null, gender: null, coach: null, bracket: CALENDAR_TEAM_KEY, bracketTitle: teamName }],
      brackets: [],
      games,
    },
    skippedAllDay,
  };
}

/** An instant as wall-clock "YYYY-MM-DDTHH:MM" in `tz`. */
function isoToLocal(ms: number, tz: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------------------
// Fetching (I/O)
// ---------------------------------------------------------------------------
/** Where each app keeps its calendar link, for the "that's a web page" error. */
const WHERE_TO_FIND: Record<string, string> = {
  TeamSnap: "In TeamSnap, open Schedule → Export/Sync (or Subscribe) and copy the calendar link.",
  GameChanger: "In GameChanger, open the team → Schedule → ⚙ → Sync Schedule to Calendar, and copy the link.",
  SportsEngine: "In SportsEngine, open the team's Schedule → Subscribe (iCal) and copy the link.",
  LeagueApps: "In LeagueApps, open My Schedule → Calendar Sync and copy the link.",
  PlayMetrics: "In PlayMetrics, open Calendar → Sync Calendar and copy the link.",
  "Google Calendar": "In Google Calendar, open the calendar's Settings → \"Public address in iCal format\" and copy it.",
};

function notCalendarMessage(provider: string): string {
  return `That's a web page, not a calendar link. ${WHERE_TO_FIND[provider] ?? "Look for \"Subscribe\", \"Sync to calendar\" or \"iCal\" in the app and copy that link (it often starts with webcal:// or ends in .ics)."}`;
}

/** Downloads a feed. Follows up to 4 redirects, re-checking each address; refuses private networks and huge bodies. */
export async function fetchCalendar(source: CalendarSource, fetcher: typeof fetch = fetch): Promise<string> {
  let url = source.url;
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || isPrivateHost(parsed.hostname) ||
      (parsed.port && parsed.port !== "443" && parsed.port !== "80")) {
      throw new CalendarError("unreadable", "That calendar link points somewhere we can't open.");
    }
    res = await fetcher(url, {
      redirect: "manual",
      headers: { "User-Agent": "ClubHQ calendar import (teamclubhq.com)", Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location")!, url).toString();
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new CalendarError("unreadable", "That calendar link redirects too many times.");
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new CalendarError("not_published", "That calendar is private. Copy the subscribe (iCal) link instead, or ask the team admin to make the schedule public.");
  }
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel();
    throw new CalendarError("unreadable", "That calendar link doesn't work anymore. Copy a fresh one from the team app.");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new CalendarError("unreadable", `The calendar site answered ${res.status}. Try again in a minute.`);
  }
  const body = await readCapped(res);
  if (!/BEGIN:VCALENDAR/i.test(body.slice(0, 4096))) {
    throw new CalendarError("not_a_calendar", notCalendarMessage(source.provider));
  }
  return body;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new CalendarError("unreadable", "That calendar is too large to import.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
