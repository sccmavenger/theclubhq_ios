# ClubHQ testing: regression and full test passes

This is the repeatable process for checking that ClubHQ still works. It covers what's already
shipped (regression) and the whole app before a release (full pass). One command runs it, writes
a report, and adds a line to [`TEST_HISTORY.md`](TEST_HISTORY.md).

```
node scripts/test/run.mjs quick         # a few minutes, offline
node scripts/test/run.mjs regression    # ~25 minutes, includes live server checks
node scripts/test/run.mjs full          # regression + the hands-on passes in §5 and §6
```

## 1. The three levels

| Level | What runs | When | Time |
|---|---|---|---|
| **quick** | App builds; app unit tests; server unit tests | While building anything, and before every commit | ~5 min |
| **regression** | quick + UI tap-throughs (Demo mode) + every live server check + the security probe + a production cleanup check | **After every feature, and before every TestFlight build.** It must pass with nothing failed | ~25 min |
| **full** | regression + the exploratory pass (§5) + the real-iPhone checklist (§6) | Before every App Store submission, and after big changes (new major area, server rewrite, OS update) | ~1–2 h |

Each level includes the ones above it. The runner lists the §5/§6 steps as to-dos in the report;
mark them done in the report's note (`--note`) once they're finished.

## 2. Running it

From Terminal on the Mac, in the repo folder:

```
node scripts/test/run.mjs regression
node scripts/test/run.mjs regression --only live-core,security      # just some suites while fixing
node scripts/test/run.mjs regression --skip app-ui --note "UI tests 8/8 in Xcode"
node scripts/test/run.mjs map          # which tests protect which feature, and any gaps
node scripts/test/run.mjs affected     # what your changes touch, and the suites that cover it
```

- Live checks read `.env.local` (Supabase token) themselves. Without it they show as **BLOCKED**.
- The runner points at Xcode itself (`DEVELOPER_DIR`), because `xcode-select` on this Mac points at
  the Command Line Tools, which can't run the simulator.
- **When Claude runs it inside Xcode:** Xcode's coding assistant can't launch the simulator from a
  shell (the "Pseudo Terminal Setup Error"), so `app-unit` and `app-ui` show as BLOCKED there.
  Claude runs those two with Xcode's own test runner instead (same tests, same simulator) and
  records the counts with `--note`. From Terminal, or with ⌘U in Xcode, they run normally.

## 3. Reading the report

`build/test-reports/<date>-<level>/report.md` has two tables:

- **Suites:** ✅ PASS, ❌ FAIL (with the first failing check), ⏸ BLOCKED (couldn't run: say why in
  the note), 📝 TODO (hands-on steps). A log for each suite sits next to the report.
- **Features:** every shipped feature and whether its suites passed. This answers "did we break
  anything that already worked?" A FAIL here blocks the TestFlight build.

`docs/TEST_HISTORY.md` keeps one line per run, so you can see when something started failing.

## 4. Definition of done for a new feature

A feature isn't finished until:

1. **Unit tests** cover its logic: Swift Testing in `ClubHQTests/`, and Deno in `supabase/tests/*_test.ts`
   for server logic.
2. **A live check** covers its server actions end to end, if it has any: copy the pattern of
   `supabase/tests/core_flows_live_check.mjs`. Use throwaway `qa+<name>-<time>@teamclubhq.com`
   accounts and delete everything in a `finally` block. Name it `dNNN_live_check.mjs` after its decision.
3. **A UI test** covers its main tap path, if it adds a screen people use: add to
   `ClubHQUITests/ClubHQUITests.swift`, using Demo mode (and extend `DemoBackend` if needed).
4. **Permissions** are in the security probe if it adds who-can-do-what rules: add the attacks to
   `supabase/tests/security_probe_check.mjs`, and check it stops them.
5. **The coverage map** (`scripts/test/registry.mjs`) lists the new suites in `SUITES` and the feature
   in `FEATURES` (with its file paths). `run.mjs map` must show no gaps.
6. **`regression` passes**, and the run is in `TEST_HISTORY.md`.

## 5. Exploratory pass (part of `full`)

Automated tests check what we thought of. This pass looks for what we didn't. Either a person
or Claude's simulator helper (an AI agent that taps through the app on the iPhone simulator and
reports back) does it, on the latest build, in **both light and dark mode**:

- **Each role:** sign in (or Demo) as coach, parent, player and club director. Visit every tab and
  every row on Team, More and Club.
- **Try to break it:** empty fields; very long names (100+ characters) and emoji; double-tapping
  Save and Send; going back mid-flow; turning on airplane mode during Join, Send and Save, then off again.
- **Look:** text that's cut off or hard to read, things that overlap, buttons that do nothing, and
  wrong counts. Check the largest text size (Settings → Accessibility → Larger Text) on Home, an
  event and chat.
- **Record** each problem with a screenshot and the steps to reproduce. Fix or file it before release.

## 6. Release checklist on a real iPhone (part of `full`)

Things only a real phone shows. Use the TestFlight build.

- [ ] Push arrives for an announcement, a chat message and an event change; tapping it opens the right screen.
- [ ] Sign out → no more pushes for that account on this phone.
- [ ] Join a team from a link in Messages (universal link) and from a typed code.
- [ ] Chat photo: pick, send, open full screen; it has no location data.
- [ ] Calendar sync: subscribe in Apple Calendar; an event change shows up after the refresh.
- [ ] Venmo and Cash App buttons open those apps with the amount filled in.
- [ ] Shortcuts: "Open Event" opens the event.
- [ ] Light and dark mode on Home, Schedule, Team, Messages and More.

## 7. Rules for testing against production

- Live checks run against the real database with **throwaway accounts only** (`qa+…@teamclubhq.com`).
  They never touch the demo world (Avengers, Mavericks, Gateway Rise, the App Review accounts).
- Every check cleans up after itself. The `prod-hygiene` suite fails if anything is left behind.
- A check that needs a fixed state (a past event, a 500-message chat) creates it with SQL inside
  its own throwaway team.

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `unable to find utility "simctl"` | `xcode-select` points at Command Line Tools. The runner sets `DEVELOPER_DIR`; if you call `xcodebuild` yourself, `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. |
| `Pseudo Terminal Setup Error` | Running inside Xcode's coding assistant. Run app tests in Xcode (⌘U) or Terminal (§2). |
| A live check passes every line, then `fetch failed` | A network blip during cleanup. The runner counts it as passed if every assertion passed. Rerun if unsure. |
| A live check prints `SKIP … 429` | An outside service (Google Calendar, a sheet host) rate-limited repeated test fetches. Not a ClubHQ bug; rerun later. |
| `prod-hygiene` fails | A check crashed before its cleanup. Re-running that check cleans its own leftovers next time; otherwise delete the `qa+` users in Supabase → Authentication. |
| UI test can't find a button | A label changed. Update the test to the new text, or add an `accessibilityIdentifier`. |
