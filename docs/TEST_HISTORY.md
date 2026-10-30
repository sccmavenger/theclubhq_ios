# Test run history

One line per run of `scripts/test/run.mjs` (newest last). Reports live in `build/test-reports/` (not committed).

| When (UTC) | Tier | Commit | Result | Suites | Notes |
|---|---|---|---|---|---|
| 2026-10-30 13:56 | quick | a14dbe0+ | FAIL | 1 pass, 1 fail, 1 blocked, 0 to-do | FAIL server-unit |
| 2026-10-30 13:58 | quick | a14dbe0+ | PASS (with blocked suites) | 2 pass, 0 fail, 1 blocked, 0 to-do |  |
| 2026-10-30 14:04 | regression | d09540a+ | FAIL | 2 pass, 2 fail, 0 blocked, 0 to-do | FAIL live-d044-0; FAIL live-d044-1 |
| 2026-10-30 14:07 | regression | d09540a+ | FAIL | 2 pass, 1 fail, 0 blocked, 0 to-do | FAIL live-d044-1 |
| 2026-10-30 14:09 | regression | d09540a+ | PASS | 1 pass, 0 fail, 0 blocked, 0 to-do |  |
| 2026-10-30 14:10 | regression | d09540a+ | PASS | 2 pass, 0 fail, 0 blocked, 0 to-do |  |
| 2026-10-30 14:15 | full | dddacf1 | FAIL | 14 pass, 1 fail, 0 blocked, 2 to-do | FAIL live-d047; app-unit 67/67 + app-ui 8/8 run in Xcode (75/75); exploratory pass by AI simulator helper |
| 2026-10-30 14:36 | regression | dddacf1+ | FAIL | 5 pass, 1 fail, 0 blocked, 0 to-do | FAIL security |
| 2026-10-30 14:40 | regression | dddacf1+ | PASS | 2 pass, 0 fail, 0 blocked, 0 to-do |  |
| 2026-10-30 14:42 | regression | dddacf1+ | PASS | 1 pass, 0 fail, 0 blocked, 0 to-do |  |
| 2026-10-30 14:42 | full | dddacf1+ | PASS | 15 pass, 0 fail, 0 blocked, 2 to-do | app-unit 70/70 + app-ui 9/9 in Xcode (79/79); exploratory pass by AI simulator helper: 8 findings, all fixed (D-052); real-iPhone checklist pending owner on build 28 |
