// Run: deno test supabase/tests/time_test.ts   (D-037)
import { assertEquals } from "jsr:@std/assert@1";
import { addLocalDays, formatEventTime, tzOffsetMs, validTimeZone } from "../functions/_shared/time.ts";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("offsets", () => {
  assertEquals(tzOffsetMs(at("2026-07-01T12:00:00Z"), "America/Chicago"), -5 * 3600_000);
  assertEquals(tzOffsetMs(at("2026-12-01T12:00:00Z"), "America/Chicago"), -6 * 3600_000);
  assertEquals(tzOffsetMs(at("2026-12-01T12:00:00Z"), "Asia/Kolkata"), 5.5 * 3600_000);
});

Deno.test("6 PM Central practice stays 6 PM when Daylight Saving ends (Nov 1, 2026)", () => {
  const oct25 = at("2026-10-25T23:00:00Z"); // 6:00 PM CDT
  assertEquals(iso(addLocalDays(oct25, 7, "America/Chicago")), "2026-11-02T00:00:00.000Z"); // 6:00 PM CST
  assertEquals(iso(addLocalDays(oct25, 14, "America/Chicago")), "2026-11-09T00:00:00.000Z");
});

Deno.test("…and when it starts again (Mar 14, 2027)", () => {
  const mar7 = at("2027-03-08T00:00:00Z"); // Sun Mar 7, 6:00 PM CST
  assertEquals(iso(addLocalDays(mar7, 7, "America/Chicago")), "2027-03-14T23:00:00.000Z"); // 6:00 PM CDT
});

Deno.test("southern hemisphere and no-DST zones", () => {
  const auckland = at("2026-09-20T06:00:00Z"); // 6:00 PM NZST; NZ Daylight Saving starts Sep 27
  assertEquals(iso(addLocalDays(auckland, 7, "Pacific/Auckland")), "2026-09-27T05:00:00.000Z"); // 6:00 PM NZDT
  const kolkata = at("2026-10-25T12:30:00Z");
  assertEquals(iso(addLocalDays(kolkata, 7, "Asia/Kolkata")), "2026-11-01T12:30:00.000Z");
});

Deno.test("a wall time skipped in spring lands an hour later instead of failing", () => {
  const sat = at("2027-03-13T08:30:00Z"); // Sat 2:30 AM CST; Sun 2:30 AM doesn't exist
  assertEquals(iso(addLocalDays(sat, 1, "America/Chicago")), "2027-03-14T08:30:00.000Z"); // 3:30 AM CDT
});

Deno.test("no zone keeps the old fixed-day behavior", () => {
  assertEquals(addLocalDays(at("2026-10-25T23:00:00Z"), 7, null), at("2026-11-01T23:00:00Z"));
});

Deno.test("validation and formatting", () => {
  assertEquals(validTimeZone("America/Chicago"), "America/Chicago");
  assertEquals(validTimeZone("Mars/Olympus_Mons"), null);
  assertEquals(validTimeZone(42), null);
  assertEquals(formatEventTime("2026-11-02T00:00:00Z", "America/Chicago"), "Sun, Nov 1, 6:00 PM");
  assertEquals(formatEventTime("2026-10-25T23:00:00Z", null), "Sun, 25 Oct 2026 23:00 UTC");
});

Deno.test("formatted times use plain spaces only", () => {
  const s = formatEventTime("2026-11-02T00:00:00Z", "America/Chicago");
  assertEquals(/[\u202F\u00A0]/.test(s), false);
});
