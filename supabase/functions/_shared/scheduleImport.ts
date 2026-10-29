// Schedule import, shared by mobile-api (preview / commit) and scheduled-jobs (calendar re-checks).
// Sources: Google Sheets (D-042), CNR league (D-043) and iCal team calendars (D-047). Each reader
// produces the same `Tournament` shape; `applyImport` writes one team's games to `events`.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";
import { adminClient, ApiError } from "./http.ts";
import { formatEventTime, validTimeZone } from "./time.ts";
import {
  fetchSheet,
  type Game,
  type GameSide,
  gamesForTeam,
  localToISO,
  ourSide,
  parseSheetURL,
  parseTournament,
  SheetImportError,
  type SheetSource,
  type Tournament,
} from "./sheetImport.ts";
import {
  canonicalLeagueURL,
  fetchLeagueIndex,
  fetchTeamGames,
  LeagueError,
  type LeagueIndex,
  leagueTournament,
  parseLeagueURL,
} from "./cnrLeague.ts";
import { CalendarError, type CalendarSource, fetchCalendar, parseCalendar, parseCalendarURL } from "./icalImport.ts";
import { unwrapLink } from "./linkUnwrap.ts";

const IMPORT_GAME_MINUTES = 60;
const CUTOFF_LEAD_MS = 4 * 3600_000;
const CACHE_MS = 120_000;
/** Calendars bigger than this are fetched every time rather than cached. */
const MAX_CACHED_CALENDAR = 1_000_000;

export type SourceKind = "google_sheet" | "cnr_league" | "ical";

export interface LoadedSource {
  kind: SourceKind;
  /** Canonical address stored on the import (a league URL carries its season). */
  url: string;
  sheetTitle: string | null;
  tabCount: number;
  tournament: Tournament;
  /** CNR league (D-043): games load per team, so the index is kept for `withLeagueGames`. */
  league: { index: LeagueIndex; teamSlug: string | null } | null;
  /** Calendar feeds (D-047): which app it came from, and what was left out. */
  calendar: { provider: string; skippedAllDay: number } | null;
}

export const NOT_A_SCHEDULE_MESSAGE =
  "That isn't a schedule link we can read. Paste a team calendar link (TeamSnap, GameChanger, SportsEngine, LeagueApps, PlayMetrics, Google Calendar…), a Google Sheets link from the organizer, or a CNR league link.";

/** Fetches and reads a sheet, a CNR league site or a calendar feed; turns reader errors into API errors the app can show. */
export async function loadSource(p: Record<string, unknown>, opts: { useCache?: boolean } = {}): Promise<LoadedSource> {
  // Links copied from Outlook, Gmail and Facebook arrive wrapped in a redirect.
  const raw = unwrapLink(typeof p.url === "string" ? p.url.slice(0, 4000) : "");
  const leagueSource = parseLeagueURL(raw);
  const sheetSource = leagueSource ? null : parseSheetURL(raw);
  const calendarSource = leagueSource || sheetSource ? null : parseCalendarURL(raw);
  if (!leagueSource && !sheetSource && !calendarSource) throw new ApiError("not_a_sheet", NOT_A_SCHEDULE_MESSAGE, 422);
  const firstDay = typeof p.first_day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.first_day) ? p.first_day : null;
  const useCache = opts.useCache ?? true;
  try {
    if (leagueSource) {
      const index = await fetchLeagueIndex(leagueSource);
      return {
        kind: "cnr_league", url: canonicalLeagueURL(index.host, index.season.start), sheetTitle: null, tabCount: 0,
        tournament: leagueTournament(index, []), league: { index, teamSlug: leagueSource.teamSlug }, calendar: null,
      };
    }
    if (calendarSource) {
      const ics = await cachedCalendar(calendarSource, useCache);
      const read = parseCalendar(ics, { now: Date.now(), fallbackZone: validTimeZone(p.time_zone), provider: calendarSource.provider });
      if (read.tournament.games.length === 0) {
        throw new ApiError("no_games", "We opened this calendar but found no events from the last two weeks on. If the season hasn't been scheduled yet, try again once it has.", 422);
      }
      return {
        kind: "ical", url: calendarSource.url, sheetTitle: null, tabCount: 0, tournament: read.tournament, league: null,
        calendar: { provider: calendarSource.provider, skippedAllDay: read.skippedAllDay },
      };
    }
    const sheet = await cachedSheet(sheetSource!);
    const tournament = parseTournament(sheet, { fallbackYear: new Date().getUTCFullYear(), firstDay });
    if (tournament.games.length === 0) {
      throw new ApiError("no_games", "We opened this sheet but didn't find any games in it. If it's a tournament schedule, tap Report so we can add support for it.", 422);
    }
    return { kind: "google_sheet", url: sheetSource!.url, sheetTitle: sheet.title, tabCount: sheet.tabs.length, tournament, league: null, calendar: null };
  } catch (e) {
    throw importError(e);
  }
}

export function importError(e: unknown): unknown {
  if (e instanceof SheetImportError || e instanceof LeagueError || e instanceof CalendarError) return new ApiError(e.code, e.message, 422);
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return new ApiError("unreadable", "The schedule site took too long to answer. Try again in a minute.", 504);
  }
  return e;
}

type SheetPayload = { title: string | null; tabs: { name: string; gid: string; csv: string }[] };

async function cacheHit(url: string): Promise<unknown | null> {
  const { data: hit } = await adminClient()
    .from("sheet_fetch_cache")
    .select("payload")
    .eq("url", url)
    .gte("fetched_at", new Date(Date.now() - CACHE_MS).toISOString())
    .maybeSingle();
  return hit?.payload ?? null;
}

async function cacheStore(url: string, payload: unknown) {
  await adminClient().from("sheet_fetch_cache").upsert({ url, fetched_at: new Date().toISOString(), payload }, { onConflict: "url" });
}

/**
 * Sheets fetched in the last 2 minutes are reused, so preview → import (and a coach going back
 * and forth) reads Google once. Google throttles repeated bursts from cloud servers.
 */
async function cachedSheet(source: SheetSource): Promise<SheetPayload> {
  const hit = await cacheHit(source.url);
  if (hit) return hit as SheetPayload;
  const sheet = await fetchSheet(source);
  await cacheStore(source.url, sheet);
  return sheet;
}

/** The same 2-minute reuse for calendar feeds, so preview and import read the same events. */
async function cachedCalendar(source: CalendarSource, useCache: boolean): Promise<string> {
  if (useCache) {
    const hit = await cacheHit(source.url) as { ics?: string } | null;
    if (typeof hit?.ics === "string") return hit.ics;
  }
  const ics = await fetchCalendar(source);
  if (ics.length <= MAX_CACHED_CALENDAR) await cacheStore(source.url, { ics });
  return ics;
}

/** League sources: load these teams' games (each team has its own page). Sheets and calendars already have every game. */
export async function withLeagueGames(loaded: LoadedSource, keys: string[]): Promise<Tournament> {
  if (!loaded.league) return loaded.tournament;
  const { index } = loaded.league;
  try {
    const lists = await Promise.all([...new Set(keys)].filter((k) => index.teams.some((t) => t.key === k)).map((k) =>
      fetchTeamGames(index, k).catch((e) => {
        if (e instanceof LeagueError && e.code === "team_not_found") return [];
        throw e;
      })
    ));
    const games = new Map<string, Game>();
    for (const g of lists.flat()) if (!games.has(g.key)) games.set(g.key, g);
    return leagueTournament(index, [...games.values()].sort((a, b) => (a.localStart ?? "").localeCompare(b.localStart ?? "")));
  } catch (e) {
    throw importError(e);
  }
}

/** A game's start instant: calendars carry their own; sheets and leagues are wall-clock in `tz`. */
export function gameStartISO(g: Game, tz: string): string | null {
  if (g.calendar) return g.calendar.startsAt;
  return g.localStart ? localToISO(g.localStart, tz) : null;
}

function sideOf(game: Game, side: "left" | "right"): GameSide {
  return side === "left" ? game.left : game.right;
}

export function importGameJSON(g: Game, tz: string) {
  const side = (s: GameSide) => ({ name: s.name, team_key: s.teamKey, score: s.score, placeholder: s.placeholder });
  return {
    key: g.key,
    bracket: g.bracket,
    round: g.round,
    left: side(g.left),
    right: side(g.right),
    starts_at: gameStartISO(g, tz),
    day_label: g.dayLabel,
    time_label: g.timeLabel,
    location: g.location,
    venue_name: g.venue?.name ?? null,
    address: g.venue?.address || null,
    court: g.court,
    // Calendar feeds (D-047); older apps ignore these and show every row as a game.
    event_type: g.calendar?.eventType ?? "game",
    title: g.calendar?.title ?? null,
    home_away: g.calendar?.homeAway ?? null,
  };
}

/** The columns of an imported `events` row that change detection reads. */
type EventRow = {
  title: string;
  event_type: string;
  starts_at: string;
  location: string | null;
  opponent: string | null;
  home_away: string | null;
  [column: string]: unknown;
};

/** An `events` row for one of our games. Scores and home/away follow the organizer's rule. */
export function importedEventRow(t: Tournament, g: Game, teamKey: string, alias: string | null, tz: string): EventRow {
  if (g.calendar) return calendarEventRow(t, g);
  const ours = ourSide(g, teamKey, alias);
  const us = sideOf(g, ours), them = sideOf(g, ours === "left" ? "right" : "left");
  const isHome = t.homeSide ? ours === t.homeSide : null;
  const opponent = them.placeholder ? `TBD (${them.name})` : them.name;
  const startsAt = localToISO(g.localStart!, tz);
  const startMs = new Date(startsAt).getTime();
  const hasScore = us.score !== null && them.score !== null;
  // With no home rule, `home_away` stays null and the app reads home_score as ours.
  const homeScore = hasScore ? (isHome === false ? them.score : us.score) : null;
  const awayScore = hasScore ? (isHome === false ? us.score : them.score) : null;
  const result = hasScore ? (us.score! > them.score! ? "win" : us.score! < them.score! ? "loss" : "tie") : null;
  const color = t.homeNote?.match(/wears (\w+)/)?.[1];
  const notes = [
    [g.bracketTitle, g.round].filter(Boolean).join(" · "),
    isHome === true ? `Home team${color ? ` — wear ${color}` : ""}.` : isHome === false ? `Away team${color ? ` (home team wears ${color})` : ""}.` : null,
    `Imported from ${t.title}.`,
  ].filter(Boolean).join("\n");
  return {
    title: `${g.round ?? "Game"} · ${t.title}`.slice(0, 140),
    event_type: "game",
    starts_at: startsAt,
    ends_at: new Date(startMs + IMPORT_GAME_MINUTES * 60_000).toISOString(),
    rsvp_cutoff_at: new Date(startMs - CUTOFF_LEAD_MS).toISOString(),
    location: (g.venue ? (g.court ? `${g.venue.name} · Court ${g.court}` : g.venue.name) : g.location)?.slice(0, 200) ?? null,
    location_address: g.venue?.address || null,
    notes: notes.slice(0, 2000),
    opponent: opponent.slice(0, 120),
    home_away: isHome === null ? null : isHome ? "home" : "away",
    home_score: homeScore,
    away_score: awayScore,
    result,
  };
}

/**
 * A calendar event (game, practice or other). Feeds don't carry scores, so score columns are left
 * alone: a coach's entered result survives every re-check.
 */
function calendarEventRow(t: Tournament, g: Game): EventRow {
  const c = g.calendar!;
  const startMs = Date.parse(c.startsAt);
  const isGame = c.eventType === "game";
  return {
    title: c.title.slice(0, 140),
    event_type: c.eventType,
    starts_at: c.startsAt,
    ends_at: new Date(startMs + c.minutes * 60_000).toISOString(),
    rsvp_cutoff_at: new Date(startMs - CUTOFF_LEAD_MS).toISOString(),
    location: (g.venue?.name ?? g.location)?.slice(0, 200) ?? null,
    location_address: g.venue?.address || null,
    notes: [c.notes, `Imported from ${t.title}.`].filter(Boolean).join("\n\n").slice(0, 2000),
    opponent: isGame && !g.right.placeholder && g.right.name ? g.right.name.slice(0, 120) : null,
    home_away: isGame ? c.homeAway : null,
  };
}

/** "6b-carter-610861338|pool-b|a~b|1" → "610861338|pool-b": same tab and round. */
function gameSlot(key: string): string {
  return key.split("|").slice(0, 2).join("|");
}

/** `.in()` filters go in the URL; keep each request's list short. */
async function inChunks<T>(values: string[], size: number, fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += size) out.push(...await fn(values.slice(i, i + size)));
  return out;
}

/** Games kept from an earlier import of this link ("Keep Games, Remove from List"), by key. */
export async function keptEvents(admin: SupabaseClient, teamId: string, keys: string[]) {
  return await inChunks(keys, 80, async (chunk) => {
    const { data } = await admin.from("events").select(EXISTING_COLUMNS).eq("team_id", teamId).is("import_id", null).in("external_key", chunk);
    return (data ?? []) as ExistingEvent[];
  });
}

const EXISTING_COLUMNS = "id, external_key, starts_at, location, title, event_type, opponent, home_away, cancelled_at";
interface ExistingEvent {
  id: string;
  external_key: string;
  starts_at: string;
  location: string | null;
  title: string;
  event_type: string;
  opponent: string | null;
  home_away: string | null;
  cancelled_at: string | null;
}

/** A change to an upcoming event that families should hear about (calendar re-checks). */
export interface ImportChange {
  type: "moved" | "added" | "cancelled";
  eventId: string;
  /** "vs Lions", "@ Tigers", "Practice". */
  label: string;
  startsAt: string;
  previousStartsAt: string | null;
  location: string | null;
  previousLocation: string | null;
}

export interface ApplyResult {
  importId: string;
  added: number;
  updated: number;
  removed: number;
  cancelled: number;
  skipped: number;
  upcoming: number;
  eventIds: string[];
  /** Only for a re-check of the same team (never on a first import). */
  changes: ImportChange[];
}

function eventLabel(row: { event_type: string; title: string; opponent: string | null; home_away: string | null }): string {
  if (row.event_type === "game" && row.opponent) return `${row.home_away === "away" ? "@" : "vs"} ${row.opponent}`;
  return row.title;
}

/**
 * Saves the chosen team's games. Importing the same link again updates those games instead of
 * copying them; picking a different team swaps them. Games the source dropped are cancelled.
 * Sends nothing; callers decide whether `changes` are announced.
 */
export async function applyImport(admin: SupabaseClient, input: {
  teamId: string;
  createdBy: string | null;
  loaded: LoadedSource;
  t: Tournament;
  teamKey: string;
  alias: string | null;
  wanted: Set<string> | null;
  tz: string;
}): Promise<ApplyResult> {
  const { teamId, loaded, t, teamKey, alias, wanted, tz } = input;
  const team = t.teams.find((x) => x.key === teamKey);
  if (!team) throw new ApiError("not_found", "That team isn't in this sheet anymore. Go back and pick your team again.", 404);
  const ourGames = gamesForTeam(t, teamKey, alias);
  const { data: previous } = await admin
    .from("schedule_imports")
    .select("id, sheet_team_key, skipped_keys")
    .eq("team_id", teamId)
    .eq("source_url", loaded.url)
    .maybeSingle();
  // Games the coach unticked stay out: chosen now, or remembered from the last pick of this team.
  const skipped = wanted
    ? ourGames.filter((g) => !wanted.has(g.key)).map((g) => g.key)
    : previous && previous.sheet_team_key === teamKey ? (previous.skipped_keys as string[] | null) ?? [] : [];
  const skippedSet = new Set(skipped);
  const games = ourGames.filter((g) => g.localStart !== null && !skippedSet.has(g.key));
  if (games.length === 0) throw new ApiError("invalid_input", "Pick at least one game to import.");
  const now = new Date().toISOString();
  const record = {
    team_id: teamId, source_url: loaded.url, source_kind: loaded.kind, title: t.title.slice(0, 200),
    sheet_team_key: teamKey, sheet_team_name: team.name.slice(0, 200), sheet_alias: alias, time_zone: tz,
    last_imported_at: now, last_checked_at: now, check_error: null, check_failures: 0,
    skipped_keys: skipped.slice(0, 1000),
  };
  const { data: saved, error: saveErr } = previous
    ? await admin.from("schedule_imports").update(record).eq("id", previous.id).select("id").single()
    : await admin.from("schedule_imports").insert({ ...record, created_by: input.createdBy }).select("id").single();
  if (saveErr || !saved) throw new ApiError("internal", saveErr?.message ?? "Could not save the import", 500);
  const importId = saved.id as string;
  const isRecheck = !!previous && previous.sheet_team_key === teamKey;

  // Existing games from this link. A different team means those games were never ours: swap them out.
  let removed = 0;
  let existing: ExistingEvent[] = [];
  if (previous) {
    const { data } = await admin.from("events").select(EXISTING_COLUMNS).eq("import_id", importId).order("starts_at");
    existing = (data ?? []) as ExistingEvent[];
    if (previous.sheet_team_key !== teamKey && existing.length > 0) {
      await admin.from("events").delete().eq("import_id", importId);
      removed = existing.length;
      existing = [];
    }
  }

  // Games kept from an earlier import of this link come back under this import instead of being copied.
  const detachedKeys = games.map((g) => g.key).filter((k) => !existing.some((e) => e.external_key === k));
  if (detachedKeys.length > 0) {
    const kept = await keptEvents(admin, teamId, detachedKeys);
    if (kept.length > 0) {
      await inChunks(kept.map((e) => e.id), 80, async (ids) => {
        await admin.from("events").update({ import_id: importId }).in("id", ids);
        return [];
      });
      existing = [...existing, ...kept];
    }
  }

  // Match by key first; a game whose opponent was filled in (bracket TBD → real team) keeps its
  // tab and round, so pair leftovers by slot in time order.
  const byKey = new Map(existing.map((e) => [e.external_key, e]));
  const used = new Set<string>();
  const plan: { game: Game; event: ExistingEvent | null }[] = games.map((g) => {
    const hit = byKey.get(g.key) ?? null;
    if (hit) used.add(hit.id);
    return { game: g, event: hit };
  });
  for (const item of plan.filter((x) => x.event === null)) {
    const slotHit = existing.find((e) => !used.has(e.id) && gameSlot(e.external_key) === gameSlot(item.game.key) && !ourGames.some((g) => g.key === e.external_key));
    if (slotHit) {
      used.add(slotHit.id);
      item.event = slotHit;
    }
  }

  const nowMs = Date.now();
  const changes: ImportChange[] = [];
  let added = 0, updated = 0;
  const eventIds: string[] = [];
  for (const { game, event } of plan) {
    const row: EventRow = { ...importedEventRow(t, game, teamKey, alias, tz), external_key: game.key, cancelled_at: null };
    const startsAt = row.starts_at;
    const upcoming = Date.parse(startsAt) > nowMs;
    if (event) {
      const { error } = await admin.from("events").update(row).eq("id", event.id);
      if (error) throw new ApiError("internal", error.message, 500);
      eventIds.push(event.id);
      updated++;
      if (isRecheck && upcoming) {
        const label = eventLabel(row);
        const moved = Math.abs(Date.parse(event.starts_at) - Date.parse(startsAt)) >= 60_000;
        const relocated = !!event.location && !!row.location && event.location !== row.location;
        if (event.cancelled_at) {
          changes.push({ type: "added", eventId: event.id, label, startsAt, previousStartsAt: null, location: row.location, previousLocation: null });
        } else if (moved || relocated) {
          changes.push({
            type: "moved", eventId: event.id, label, startsAt, previousStartsAt: moved ? event.starts_at : null,
            location: row.location, previousLocation: relocated ? event.location : null,
          });
        }
      }
    } else {
      const { data, error } = await admin
        .from("events")
        .insert({ ...row, team_id: teamId, created_by: input.createdBy, import_id: importId })
        .select("id")
        .single();
      if (error || !data) throw new ApiError("internal", error?.message ?? "Could not add a game", 500);
      eventIds.push(data.id);
      added++;
      if (isRecheck && upcoming) {
        changes.push({ type: "added", eventId: data.id, label: eventLabel(row), startsAt, previousStartsAt: null, location: row.location, previousLocation: null });
      }
    }
  }
  // Games the organizer removed are cancelled, not deleted (families may have RSVP'd). A calendar
  // only lists recent and future events, so its past events are history and stay as they are.
  const vanished = existing.filter((e) =>
    !used.has(e.id) && !ourGames.some((g) => g.key === e.external_key) &&
    !(loaded.kind === "ical" && Date.parse(e.starts_at) <= nowMs)
  );
  if (vanished.length > 0) {
    await admin.from("events").update({ cancelled_at: new Date().toISOString() }).in("id", vanished.map((e) => e.id)).is("cancelled_at", null);
    if (isRecheck) {
      for (const e of vanished) {
        if (e.cancelled_at || Date.parse(e.starts_at) <= nowMs) continue;
        changes.push({ type: "cancelled", eventId: e.id, label: eventLabel(e), startsAt: e.starts_at, previousStartsAt: null, location: e.location, previousLocation: null });
      }
    }
  }

  return {
    importId,
    added, updated, removed, cancelled: vanished.length,
    skipped: ourGames.filter((g) => g.localStart === null).length,
    upcoming: games.filter((g) => Date.parse(gameStartISO(g, tz)!) > nowMs).length,
    eventIds,
    changes: changes.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

/**
 * One notification for a re-check's changes: a specific one for a single change ("Time changed:
 * vs Lions — now Sat, Nov 7, 10:00 AM, was 9:00 AM"), else a summary. Null when nothing changed.
 */
export function changeNotice(changes: ImportChange[], tz: string | null, title: string):
  { kind: "event_updated" | "event_created"; subject: string; body: string; refId: string } | null {
  if (changes.length === 0) return null;
  const when = (iso: string) => formatEventTime(iso, tz);
  const timeOnly = (iso: string) => when(iso).replace(/^.*?,\s*[A-Z][a-z]{2} \d{1,2},\s*/, "");
  const line = (c: ImportChange): string => {
    switch (c.type) {
      case "moved": {
        const parts: string[] = [];
        if (c.previousStartsAt) {
          const sameDay = when(c.previousStartsAt).split(",").slice(0, 2).join() === when(c.startsAt).split(",").slice(0, 2).join();
          parts.push(`now ${when(c.startsAt)} (was ${sameDay ? timeOnly(c.previousStartsAt) : when(c.previousStartsAt)})`);
        }
        if (c.previousLocation) parts.push(`now at ${c.location}`);
        return `${c.label} ${parts.join(", ")}`;
      }
      case "added":
        return `${c.label} added: ${when(c.startsAt)}`;
      case "cancelled":
        return `${c.label} on ${when(c.startsAt)} cancelled`;
    }
  };
  if (changes.length === 1) {
    const c = changes[0];
    const subject = c.type === "moved"
      ? (c.previousStartsAt ? `Time changed: ${c.label}` : `Location changed: ${c.label}`)
      : c.type === "added" ? `New: ${c.label}` : `Cancelled: ${c.label}`;
    const body = c.type === "moved"
      ? [c.previousStartsAt ? `Now ${when(c.startsAt)} (was ${when(c.previousStartsAt)})` : when(c.startsAt), c.location].filter(Boolean).join(" · ")
      : [when(c.startsAt), c.location].filter(Boolean).join(" · ");
    return { kind: c.type === "added" ? "event_created" : "event_updated", subject: subject.slice(0, 140), body: body.slice(0, 500), refId: c.eventId };
  }
  const shown = changes.slice(0, 2).map(line);
  const more = changes.length - shown.length;
  return {
    kind: "event_updated",
    subject: `Schedule changes: ${title}`.slice(0, 140),
    body: `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`.slice(0, 500),
    refId: changes[0].eventId,
  };
}
