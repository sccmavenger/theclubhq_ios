// Event reminders and RSVP nudges (D-045): which reminder is due, and what it says.
//   npx deno test supabase/tests/reminders_test.ts
import { dueReminders, eventLabel, joinNames, localHour, reminderText, type ReminderEvent } from "../functions/_shared/reminders.ts";

function assertEquals(actual: unknown, expected: unknown, label = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\n     got ${a}`);
}
const TZ = "America/Chicago";
const H = 3600_000;
// Saturday Nov 7, 2026, 1:00 PM Central (CST, UTC-6) = 19:00Z.
const START = Date.parse("2026-11-07T19:00:00Z");
const ev = (over: Partial<ReminderEvent> = {}): ReminderEvent => ({
  id: "e1", team_id: "t1", title: "Practice", event_type: "practice", starts_at: new Date(START).toISOString(),
  rsvp_cutoff_at: null, location: "Orchard Farm High School Gym 1", opponent: null, home_away: null, ...over,
});

Deno.test("day-before reminder: 18–30 hours out, only 7 AM–9 PM team time", () => {
  // Friday 1:00 PM Central: 24 h before.
  assertEquals(dueReminders(ev(), START - 24 * H, TZ).includes("day_before"), true);
  // Friday 4:00 AM Central (33 h before): too early.
  assertEquals(dueReminders(ev(), START - 33 * H, TZ).includes("day_before"), false);
  // Friday 11:00 PM Central (14 h before): too late, and outside the window.
  assertEquals(dueReminders(ev(), START - 14 * H, TZ).includes("day_before"), false);
  // An 8:00 AM game: 7:00 AM the day before is 25 h out and allowed.
  const early = ev({ starts_at: "2026-11-07T14:00:00Z" });
  assertEquals(dueReminders(early, Date.parse("2026-11-06T13:00:00Z"), TZ).includes("day_before"), true);
  assertEquals(localHour(Date.parse("2026-11-06T13:00:00Z"), TZ), 7);
});

Deno.test("two-hour reminder: 1.5–2.5 hours out, any time of day", () => {
  assertEquals(dueReminders(ev(), START - 2 * H, TZ).includes("two_hours"), true);
  assertEquals(dueReminders(ev(), START - 3 * H, TZ).includes("two_hours"), false);
  assertEquals(dueReminders(ev(), START - 1 * H, TZ).includes("two_hours"), false);
  // A 7:00 AM game gets its reminder at 5:00 AM.
  const dawn = ev({ starts_at: "2026-11-07T13:00:00Z" });
  assertEquals(dueReminders(dawn, Date.parse("2026-11-07T11:00:00Z"), TZ).includes("two_hours"), true);
});

Deno.test("RSVP nudge: cutoff 1–24 hours away, 8 AM–8 PM", () => {
  // Default cutoff is 4 h before start (9:00 AM Saturday). Friday noon is 21 h before the cutoff.
  assertEquals(dueReminders(ev(), Date.parse("2026-11-06T18:00:00Z"), TZ).includes("rsvp_nudge"), true);
  // Friday 9:00 PM Central: quiet hours.
  assertEquals(dueReminders(ev(), Date.parse("2026-11-07T03:00:00Z"), TZ).includes("rsvp_nudge"), false);
  // Cutoff already passed.
  assertEquals(dueReminders(ev(), START - 2 * H, TZ).includes("rsvp_nudge"), false);
  // A custom cutoff two days before: nudge two days before that cutoff isn't due yet.
  const custom = ev({ rsvp_cutoff_at: "2026-11-05T18:00:00Z" });
  assertEquals(dueReminders(custom, Date.parse("2026-11-03T18:00:00Z"), TZ).includes("rsvp_nudge"), false);
  assertEquals(dueReminders(custom, Date.parse("2026-11-05T00:00:00Z"), TZ).includes("rsvp_nudge"), true, "6 PM the evening before the cutoff");
});

Deno.test("wording", () => {
  const game = ev({ event_type: "game", opponent: "Rise & Reign 6th Boys", home_away: "away", title: "Game" });
  assertEquals(eventLabel(game), "Game @ Rise & Reign 6th Boys");
  assertEquals(reminderText("day_before", game, START - 24 * H, TZ), {
    subject: "Tomorrow: Game @ Rise & Reign 6th Boys",
    body: "Sat, Nov 7, 1:00 PM · Orchard Farm High School Gym 1",
  });
  assertEquals(reminderText("day_before", ev(), START - 20 * H, TZ).subject, "Tomorrow: Practice");
  assertEquals(reminderText("two_hours", ev(), START - 2 * H, TZ).subject, "In 2 hours: Practice");
  assertEquals(reminderText("rsvp_nudge", game, START - 24 * H, TZ, ["Jordan"]).body, "Jordan hasn't responded for Sat, Nov 7, 1:00 PM. RSVPs close Sat, Nov 7, 9:00 AM.");
  assertEquals(reminderText("rsvp_nudge", game, START - 24 * H, TZ, ["Jordan", "Mia"]).body.startsWith("Jordan and Mia haven't responded"), true);
  assertEquals(joinNames(["A", "B", "C"]), "A, B and C");
});
