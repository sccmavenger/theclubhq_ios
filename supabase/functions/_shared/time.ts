// Local-time helpers for event scheduling (DECISIONS D-037). Pure functions, no I/O, so
// they are unit-tested in supabase/tests/time_test.ts.

const DAY_MS = 24 * 3600_000;

/** The IANA zone if the runtime recognizes it (e.g. "America/Chicago"), else null. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** Offset of `tz` from UTC at the instant `utcMs`, in ms (Chicago in summer: -5 h). */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - (utcMs - (utcMs % 1000));
}

/**
 * The instant `days` calendar days after `utcMs` at the same local wall-clock time in `tz`,
 * so a 6:00 PM practice stays at 6:00 PM across a Daylight Saving change. Without a zone it
 * falls back to fixed 24-hour days.
 */
export function addLocalDays(utcMs: number, days: number, tz: string | null): number {
  if (!tz) return utcMs + days * DAY_MS;
  const targetWall = utcMs + tzOffsetMs(utcMs, tz) + days * DAY_MS;
  // Resolve the wall time back to an instant; re-check the offset in case the change falls
  // between the guess and the answer. A wall time skipped in spring lands an hour later.
  const guess = targetWall - tzOffsetMs(targetWall - tzOffsetMs(utcMs, tz), tz);
  const offset = tzOffsetMs(guess, tz);
  return targetWall - offset;
}

/** "Sun, Oct 25, 6:00 PM" in `tz`, or the UTC form when the zone is unknown. */
export function formatEventTime(iso: string, tz: string | null): string {
  const date = new Date(iso);
  if (!tz) return date.toUTCString().replace(":00 GMT", " UTC");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
    // Newer ICU (the production runtime) puts U+202F before "PM"; plain spaces read the same
    // in every push, email, and inbox renderer.
    .replace(/[\u202F\u00A0]/g, " ");
}

/** RSVPs close this long before an event starts. */
export const RSVP_CUTOFF_LEAD_MS = 4 * 3600_000;

/**
 * When RSVPs close for an event starting at `startMs` (D-052): 4 hours before, or at the start if
 * that's already past. Before, an event created with less than 4 hours' notice was closed the
 * moment it was made ("practice moved to 6 tonight", posted at 3).
 */
export function rsvpCutoffISO(startMs: number, nowMs = Date.now()): string {
  const usual = startMs - RSVP_CUTOFF_LEAD_MS;
  return new Date(usual >= nowMs ? usual : startMs).toISOString();
}
