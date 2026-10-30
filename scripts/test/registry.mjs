// The coverage map for regression testing (docs/TESTING.md). Two lists:
//   SUITES   — every test suite the runner knows, the tier it belongs to, and how to run it.
//   FEATURES — every shipped feature, the suites that protect it, and the files that belong to it.
// When you add a feature, add it to FEATURES with its suites and paths. When you add a test
// file, add it to SUITES and list it under the features it covers. `run.mjs map` shows both,
// and flags features that have no automated test.

/**
 * Tiers, cumulative:
 *   quick      — offline, a few minutes: build, app unit tests, server unit tests.
 *   regression — quick + live server checks against production (throwaway accounts) + the
 *                security probe + UI tap-throughs + a cleanup check. Before every TestFlight build.
 *   full       — regression + the exploratory pass and the human checklist in docs/TESTING.md.
 *                Before every App Store submission.
 */
export const TIERS = ["quick", "regression", "full"];

export const SUITES = [
  // ----- quick ---------------------------------------------------------------------------
  { id: "app-build", tier: "quick", kind: "xcode-build", title: "App builds (Debug, simulator)" },
  { id: "app-unit", tier: "quick", kind: "xcode-test", target: "ClubHQTests", title: "App unit tests (Swift Testing)" },
  { id: "server-unit", tier: "quick", kind: "deno-test", path: "supabase/tests/", title: "Server unit tests (Deno)" },

  // ----- regression ------------------------------------------------------------------------
  { id: "app-ui", tier: "regression", kind: "xcode-test", target: "ClubHQUITests", title: "UI tap-throughs (Demo mode)" },
  { id: "live-core", tier: "regression", kind: "live", file: "supabase/tests/core_flows_live_check.mjs", title: "Everyday flows: announcements, RSVPs, dues, members" },
  { id: "live-d036", tier: "regression", kind: "live", file: "supabase/tests/d036_live_check.mjs", title: "Chat photos, calendar feed, season team code (D-036)" },
  { id: "live-d037", tier: "regression", kind: "live", file: "supabase/tests/d037_live_check.mjs", title: "Weekly repeats across Daylight Saving (D-037)" },
  { id: "live-d038", tier: "regression", kind: "live", file: "supabase/tests/d038_live_check.mjs", title: "Joining a team survives retries (D-038)" },
  { id: "live-d041", tier: "regression", kind: "live", file: "supabase/tests/d041_live_check.mjs", title: "Admin portal, reports, blocks (D-041)" },
  { id: "live-d042", tier: "regression", kind: "live", file: "supabase/tests/d042_live_check.mjs", title: "Schedule import: sheets and CNR league (D-042, D-043)" },
  { id: "live-d044-0", tier: "regression", kind: "live", file: "supabase/tests/d044_phase0_check.mjs", title: "Clubs phase 0 (D-044)" },
  { id: "live-d044-1", tier: "regression", kind: "live", file: "supabase/tests/d044_phase1_check.mjs", title: "Clubs phase 1 (D-044)" },
  { id: "live-d045", tier: "regression", kind: "live", file: "supabase/tests/d045_live_check.mjs", title: "Push reminders (D-045)" },
  { id: "live-d046", tier: "regression", kind: "live", file: "supabase/tests/d046_live_check.mjs", title: "Deleting a team (D-046)" },
  { id: "live-d053", tier: "regression", kind: "live", file: "supabase/tests/d053_club_portal_check.mjs", title: "Club portal server: directors, team page, history, club event edits (D-053)" },
  { id: "ui-club-portal", tier: "regression", kind: "live", file: "supabase/tests/club_portal_ui_check.mjs", title: "Club portal in Chrome, against the live site (D-053)" },
  { id: "live-d047", tier: "regression", kind: "live", file: "supabase/tests/d047_live_check.mjs", title: "Team calendar import (D-047)" },
  { id: "security", tier: "regression", kind: "live", file: "supabase/tests/security_probe_check.mjs", title: "Security probe: 50+ attacks (D-050)" },
  { id: "prod-hygiene", tier: "regression", kind: "hygiene", title: "No test accounts or teams left in production" },

  // ----- full ------------------------------------------------------------------------------
  { id: "exploratory", tier: "full", kind: "manual", title: "Exploratory pass on the simulator (AI helper or a person) — docs/TESTING.md §5" },
  { id: "checklist", tier: "full", kind: "manual", title: "Release checklist on a real iPhone — docs/TESTING.md §6" },
];

/** Every shipped feature. `paths` are path prefixes; a change under one marks the feature as touched. */
export const FEATURES = [
  { id: "auth", name: "Sign-in, sign-up, email codes, password reset", decisions: ["D-029"],
    suites: ["app-unit", "app-ui", "security"], paths: ["ClubHQ/Features/Auth/", "ClubHQ/Core/Networking/"] },
  { id: "demo", name: "Demo mode (Coach, Parent, Player)", decisions: ["D-006"],
    suites: ["app-ui", "app-unit"], paths: ["ClubHQ/Core/Backend/DemoBackend.swift", "ClubHQ/Core/Backend/DemoWorld.swift"] },
  { id: "join", name: "Team codes, joining, co-parents, player logins", decisions: ["D-008", "D-035", "D-036", "D-038", "D-048"],
    suites: ["live-d036", "live-d038", "security"], paths: ["ClubHQ/Features/Onboarding/", "supabase/functions/mobile-api/"] },
  { id: "safety", name: "Child safety: two-adult rule, reports, blocks", decisions: ["D-009", "D-041", "D-050"],
    suites: ["security", "live-d041", "app-unit"], paths: ["ClubHQ/Features/Messages/ReportSheet.swift", "supabase/migrations/"] },
  { id: "chat", name: "Team chat, threads, photos", decisions: ["D-036"],
    suites: ["live-d036", "app-ui", "security"], paths: ["ClubHQ/Features/Messages/", "ClubHQ/Core/Models/ChatPhoto.swift"] },
  { id: "schedule", name: "Events, repeats, cancellations, Past tab", decisions: ["D-037"],
    suites: ["live-d037", "app-ui", "security"], paths: ["ClubHQ/Features/Schedule/EventEditorView.swift", "ClubHQ/Features/Schedule/ScheduleView.swift", "ClubHQ/Features/Schedule/EventDetailView.swift", "supabase/functions/_shared/time.ts"] },
  { id: "rsvp", name: "RSVPs and cutoffs", decisions: [],
    suites: ["live-core", "app-ui", "security"], paths: ["ClubHQ/Features/Home/", "ClubHQ/Features/Schedule/EventDetailView.swift"] },
  { id: "announcements", name: "Announcements", decisions: [],
    suites: ["live-core", "security"], paths: ["ClubHQ/Features/Team/TeamView.swift"] },
  { id: "dues", name: "Dues, Venmo and Cash App", decisions: ["D-033"],
    suites: ["live-core", "security"], paths: ["ClubHQ/Features/Money/"] },
  { id: "calendar-feed", name: "Calendar sync (subscribe link)", decisions: ["D-036"],
    suites: ["live-d036", "security"], paths: ["ClubHQ/Features/Schedule/CalendarSyncView.swift", "supabase/functions/calendar-feed/"] },
  { id: "import", name: "Schedule import: sheets, CNR league, team calendars", decisions: ["D-042", "D-043", "D-047"],
    suites: ["live-d042", "live-d047", "server-unit", "app-unit"], paths: ["ClubHQ/Features/Schedule/ScheduleImport", "supabase/functions/_shared/sheetImport.ts", "supabase/functions/_shared/cnrLeague.ts", "supabase/functions/_shared/icalImport.ts", "supabase/functions/_shared/scheduleImport.ts"] },
  { id: "clubs", name: "Clubs: directors, club teams, club announcements and events", decisions: ["D-044", "D-051", "D-053"],
    suites: ["live-d044-0", "live-d044-1", "live-d053", "security", "app-unit"], paths: ["ClubHQ/Features/Club/", "ClubHQ/Core/Models/ClubModels.swift"] },
  { id: "delete-team", name: "Deleting a team", decisions: ["D-046"],
    suites: ["live-d046", "app-unit"], paths: ["ClubHQ/Features/Team/DeleteTeamView.swift"] },
  { id: "push", name: "Push notifications, reminders, notification taps", decisions: ["D-012", "D-045"],
    suites: ["live-d045", "server-unit", "app-unit"], paths: ["ClubHQ/Core/Push/", "supabase/functions/_shared/reminders.ts", "supabase/functions/_shared/notify.ts"] },
  { id: "club-portal", name: "Club portal (directors on the web)", decisions: ["D-053"],
    suites: ["live-d053", "ui-club-portal", "security"], paths: ["site/club/"] },
  { id: "admin", name: "Admin portal", decisions: ["D-041"],
    suites: ["live-d041"], paths: ["site/adminportal/", "supabase/functions/admin-api/"] },
  { id: "pro", name: "Coach Pro limits and purchases", decisions: ["D-010", "D-011", "D-034"],
    suites: ["server-unit", "security"], paths: ["ClubHQ/Core/Store/", "ClubHQ/Features/Paywall/", "supabase/functions/_shared/appstore.ts"] },
  { id: "colors", name: "Team colors, readable in light and dark", decisions: ["D-049"],
    suites: ["app-unit"], paths: ["ClubHQ/Features/Shared/UIComponents.swift", "ClubHQ/Assets.xcassets/"] },
  { id: "intents", name: "Shortcuts: Open Event", decisions: ["D-039"],
    suites: ["app-unit"], paths: ["ClubHQ/Core/Intents/"] },
  { id: "groupme", name: "Move from GroupMe guide", decisions: ["D-036"],
    suites: ["app-ui"], paths: ["ClubHQ/Features/Team/MoveFromGroupMeView.swift"] },
];
