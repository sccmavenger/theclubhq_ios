# ClubHQ — Decision Log

Every non-trivial "how" decision is recorded here **before** it is acted on.
Format: context → decision → why → consequences / revisit trigger.
Open questions that need the owner live in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
Research backing these decisions: [`research/COMPETITIVE_ANALYSIS.md`](research/COMPETITIVE_ANALYSIS.md).

Status values: **Accepted** (in effect), **Provisional** (in effect, needs owner confirmation), **Superseded**.

---

## D-029 — Registration uses 6-digit email codes, not links — Accepted (2026-10-13)
- **Context:** The owner wants registration to work end to end in the app now, without the website. Email links need a web page plus Universal Links (Apple Team ID); codes need neither.
- **Research:** Code-based verification is the standard mobile pattern (Slack, Notion, Linear, banking apps). It survives email clients that open links in in-app browsers. iOS can autofill codes from Mail (`.oneTimeCode`). Supabase supports it natively: `{{ .Token }}` in the templates, `POST /auth/v1/verify` with `type: "email"` (sign-up) or `"recovery"`.
- **Decision:**
  - **Auth settings** (Management API):
    - 6-digit codes, 1-hour expiry, minimum password 8;
    - `site_url = https://teamclubhq.com`, redirect allow-list for the future link flow;
    - branded HTML templates and subjects (`supabase/templates/`).
  - **App screens:**
    - **Create Account** asks for name, email, password, and birth year (a neutral COPPA age screen; under-13s are turned away for 24 h);
    - then a **code screen** with auto-submit and a 60-second Resend timer;
    - signing in unconfirmed sends a fresh code;
    - **Forgot password** goes code → new password.
  - **Roles after confirmation** (unchanged chooser):
    - **coach** creates a team;
    - **parent** enters the coach's **10-character team code** and adds their child;
    - **player (13+)** enters the 8-character code a guardian or coach created.
  - **Fix:** guardians can set their child's birthdate (`set-player-birthdate`), which a 13+ player login requires.
  - **Sign in with Apple** is hidden (`AppConfig.signInWithAppleEnabled`) until the Apple provider is configured.
- **Verified against production:** 21 checks passing, covering all three role registrations, wrong-account and single-use code protections, and the RLS boundaries for players.
- **Blocker for real users:** Supabase must send through Resend (custom SMTP, sender `info@teamclubhq.com`). The built-in mailer only delivers to project team members, at 2 emails per hour.

## D-032 — Version 1.0 ships iPhone-only; App Store Connect filled via API — Accepted (2026-10-14)
- **Device family:** the project is `TARGETED_DEVICE_FAMILY = 1` (iPhone), matching uploaded builds 1–2. This supersedes D-022's iPhone + iPad. The iPad layout was never designed or tested; iPad users can still run the iPhone app. Apple then requires only iPhone screenshots.
- **App Store Connect** (app 6822555956), written by API with the team key (`the-hub-ios/.secrets`, Key ID QG9CVK8A7R):
  - **Listing:** subtitle, privacy URLs, categories Sports/Productivity, content rights, the age questionnaire (with override **13+**, consistent with no under-13 accounts), and the version 1.0 description, keywords, promotional text, support/marketing URLs, copyright, manual release.
  - **Build and review:** build 2 attached; App Review contact (Danny Guillory, +1 337 303 6453, dguilloryjr@msn.com) with the demo account and notes.
  - **Price and availability:** Free, United States only.
  - **Subscriptions:** "Coach Pro" group (22474078) with monthly $9.99 and yearly $69.99, 2-week free trial, US only, review screenshots.
  - **TestFlight:** beta app description, feedback email, beta review details, build 2 "What to Test"; build 2 added to external group "Ring 1" (5 testers), Beta App Review waiting.
  - **Screenshots:** 6 iPhone 6.9" screenshots (1320×2868, demo data), all processed.
- **Not settable by API (owner):** App Privacy questionnaire; Paid Apps Agreement, banking, and tax (subscriptions show "Missing Metadata" until these are done).

## D-031 — Sessions persist across launches (bug fix) — Accepted
- **Bug:** `AuthSession` was saved with the shared snake_case encoder (`user_id`) but read back expecting `userID`. Decoding always failed, so every cold launch signed the user out.
- **Fix:** explicit `CodingKeys`. Verified with a round-trip and a force-quit and cold relaunch in the simulator (the player stayed signed in).
- **Simulator walkthrough (2026-10-13), all passing:**
  - **Age screen:** blocks under-13 and blocks a second attempt with a different year.
  - **Parent:** create account → code → team code (typed loosely) → add child → family Home.
  - **Teen player:** parent sets birthdate → player code → Riley signs in unconfirmed → code screen → code → joins with a lowercase player code → player Home, RSVP, team chat only.

## D-030 — Deleting a user never fails on audit columns — Accepted
- **Bug found while testing:** 7 `created_by` / `paid_by` foreign keys to `auth.users` had no delete rule, so deleting any coach or parent failed and `delete-account` fell back to scrubbing.
- **Fix:** migration `20261013140000_user_delete_set_null.sql` changes them to `ON DELETE SET NULL` (records kept, pointer cleared). Verified: a coach who owns a team deletes their account, the auth user is gone, and the team is archived.

## D-028 — Production project is "TeamClubHQ" (Pro) — Accepted (2026-10-13)
- **Project:** `qpchhtakmxcfqtbjjpvi` in the GFoceDigital org (Pro plan, us-west-2, Postgres 17). It replaces the Free-plan project `vdrlbktsdgegqbpsicno` named in D-024; that one is unused.
- **Deployed 2026-10-13:**
  - 33 migrations: the prototype's 30 + mobile foundation + D-027 fix
  - 34 tables, all with RLS
  - 4 Edge Functions
  - a confirmed test account `coach@teamclubhq.com` owning "ClubHQ Test Team"
- **Verified end to end:**
  - the API with real JWTs: context, create team, event, roster, chat, inbox, dues;
  - a non-member account sees 0 rows on every team table, anonymous visitors see nothing, and `private.*` helpers aren't reachable via `/rest/v1/rpc`;
  - the iOS app signs in and reads and writes live data in the simulator.
- Mobile-api fan-out now runs in the background (`EdgeRuntime.waitUntil`). post-message returns in about 0.8–1.0 s (it was about 3 s), and the chat bubble appears immediately on the device.

## D-027 — RLS helper functions are executable by `authenticated` — Accepted
- **Bug found while deploying:** the prototype's hardening migration revoked `USAGE`/`EXECUTE` on `private.*` from `authenticated`. Policies run as the caller, so every helper-based policy failed with "permission denied for function can_access_team". The prototype's direct table access couldn't have worked either.
- **Fix:** migration `20261013130000_grant_rls_helpers.sql` grants `USAGE` on `private` and `EXECUTE` on the boolean helpers to `authenticated` only. This follows Supabase's recommended pattern: `private` isn't an exposed Data API schema, so the helpers can't be called over HTTP (verified: `/rest/v1/rpc/can_access_team` returns 404). `anon` and the signup trigger stay locked down.

## D-026 — App identity on the owned domain — Provisional (OQ-05)
- **Bundle ID:** `com.teamclubhq.app`. **Coach Pro product IDs:** `com.teamclubhq.pro.monthly`, `com.teamclubhq.pro.yearly`. Product IDs can never be reused or renamed once created in App Store Connect, which is why they're fixed now.
- **URL scheme:** `clubhq://` is registered in Info.plist. Universal Links (`applinks:teamclubhq.com`) are wired in the site's AASA file and get enabled once the Apple Team ID exists.
- **DNS:** the domain stays registered at GoDaddy; nameservers move to Cloudflare, which hosts the site on Pages and holds the email DNS. Steps are in `site/README.md`.
- **Email links:** sign-up and reset emails redirect to `https://teamclubhq.com/auth/callback`. The page hands the session (kept in the URL fragment, never sent to a server) to `clubhq://auth-callback`; the app stores it and, for resets, asks for a new password.

## D-025 — teamclubhq.com is the product domain — Accepted
- **Context:** The owner owns `teamclubhq.com` (2026-10-13). All `clubhq.app` placeholders were replaced.
- **Decision — what the domain serves** (a small static site, hosted separately from Supabase, which doesn't host websites):
  | Path | Purpose |
  |---|---|
  | `/` | Marketing page + App Store link |
  | `/join/<token>` | Invite landing page: opens the app (Universal Link) or sends to the App Store |
  | `/.well-known/apple-app-site-association` | Universal Links for `/join/*` and `/auth/*` (needs the Apple Team ID, OQ-05) |
  | `/auth/callback` | Email confirmation / password reset → hands off to the app |
  | `/payments/return` | Return page after Stripe onboarding / checkout |
  | `/privacy`, `/terms`, `/support` | Required by App Review |
- **Email:** auth and notification emails are sent from `teamclubhq.com` through a custom SMTP provider (e.g. Resend), with SPF/DKIM/DMARC DNS records. Supabase's built-in mailer is rate-limited to a handful of emails per hour and isn't meant for production.
- **Hosting recommendation:** Cloudflare Pages (free, global CDN, DNS in the same place). Vercel or Netlify work equally well.

## D-024 — Greenfield production backend; the web app is retired (owner, 2026-10-13) — Accepted
- **Context:** The owner confirmed the web app was a proof of concept and no longer exists. The production backend is a **new, empty Supabase project** (`vdrlbktsdgegqbpsicno`, "ClubHQ"), targeting millions of users.
- **Supersedes:** D-002's "two clients" and D-003's "additive only, keep the web app working". D-021's web-originated push concern no longer applies, but the dispatcher stays (cron is still useful).
- **Decision:**
  1. Author a **complete v1 schema** as ordered migrations. Port the prototype's proven RLS model (`private.*` helpers, per-team roles, guardian links) and fold in the mobile additions.
  2. Move the server responsibilities the web app used to have into Edge Functions: event/RSVP reminders (cron), the ICS calendar feed, and the invite landing page / universal links.
  3. Environments: **staging + production** projects. Migrations in git, deployed with the Supabase CLI from GitHub Actions. Production runs on **Pro or higher** with PITR backups; the Free plan pauses inactive projects and has no backups.
- **Consequence:** The migration files under `supabase/migrations/` will be reorganized into a baseline before the first deploy.

## D-001 — "ManageEngine" means SportsEngine — Provisional
- **Context:** The brief named "TeamSnap or ManageEngine" as competitors. ManageEngine is a Zoho IT-operations product with no youth-sports offering.
- **Decision:** Treat it as **SportsEngine** (NBC Sports Next), the #2 incumbent next to TeamSnap.
- **Revisit:** If a different product was meant (OQ-01).

## D-002 — Ship a native SwiftUI iOS app, not a wrapped web app — Accepted
- **Context:** The existing product (`athlete-align-suite`) is a TanStack Start web/PWA app built in Lovable. The goal is a mobile app for players, coaches, and parents that can make money.
- **Options:** (a) Capacitor/WebView wrapper around the PWA, (b) React Native rewrite, (c) native SwiftUI on the same Supabase backend.
- **Decision:** (c) Native SwiftUI, iPhone first (iPad works through adaptive layouts).
- **Why:** StoreKit 2 subscriptions, APNs push, Sign in with Apple, widgets/Live Activities later, and Liquid Glass UI are first-class only natively. Apple's guideline 4.2 rejects thin web wrappers. The ClubHQ Xcode project already exists. The PWA keeps covering Android and desktop until an Android app is warranted.
- **Consequences:** Two clients (web + iOS) share one database. Any business rule that only lives in the web server functions must be ported (see D-005).

## D-003 — Reuse the existing Supabase schema; changes are additive only — Accepted
- **Decision:** No breaking changes to existing tables, policies, or enums. New capability is added with new tables/columns/policies and follows the conventions in the web repo's `AGENTS.md` (enum additions in their own migration file, RLS helpers in the `private` schema, `IF NOT EXISTS` guards).
- **Why:** The web app is live and must keep working. A shared schema means a coach can use web and iOS interchangeably.
- **Where:** `supabase/migrations/` in this repo, timestamped after the web repo's last migration so they can be copied into the web repo or applied via the Supabase MCP.

## D-004 — No third-party Swift packages; a thin in-house Supabase client — Accepted
- **Context:** The Xcode project has no Swift Package dependencies. The official `supabase-swift` SDK is excellent but adds a dependency graph (and package resolution has to be configured in the project).
- **Decision:** Implement a small typed client over Supabase's stable HTTP APIs: GoTrue (auth), PostgREST (tables/RPC), Edge Functions, Storage. About 400 lines, fully async/await, Keychain-backed session.
- **Why:** The app needs a small, well-understood surface. Zero dependencies means no supply-chain risk, fast builds, and nothing to break on Xcode upgrades.
- **Revisit trigger:** When we need Realtime websockets (live chat typing/presence) or offline sync, adopt `supabase-swift` and swap the implementation behind the `ClubHQBackend` protocol. Callers do not change.

## D-005 — Privileged/aggregate logic goes through one Edge Function, `mobile-api` — Accepted
- **Context:** Many web flows use the service-role client inside TanStack server functions: creating a team (granting `head_coach`), accepting invites, creating the team chat thread, reading other members' names (profiles RLS is own-row only), and notification fan-out. An iOS client cannot do these under RLS.
- **Decision:** One Supabase Edge Function, `mobile-api`, with an `action` router. It verifies the caller's JWT, then ports the exact authorization logic from the web server functions. Plain RLS-safe reads and writes (events, RSVPs, players, attendance, announcements) go straight to PostgREST.
- **Why:** One deployable unit, one auth check, one place to audit. It mirrors the web server functions action-for-action, so behavior matches across clients.
- **Revisit:** Split into multiple functions if cold starts or ownership boundaries become a problem.

## D-006 — Built-in Demo Mode — Accepted
- **Decision:** The app ships with an in-memory `DemoBackend` behind the same `ClubHQBackend` protocol. It is used automatically when Supabase credentials are not configured, and can be chosen from the sign-in screen ("Explore the demo").
- **Why:** (1) The app is runnable today, before the backend migrations are deployed. (2) App Review needs a working demo. (3) Sales demos for clubs. (4) Deterministic data for SwiftUI previews and unit tests.

## D-007 — Three personas, five roles — Accepted
- **Personas in the app:** **Coach** (`head_coach`, `assistant_coach`, `team_manager`), **Parent/Guardian** (`parent`), **Player** (new `player` role).
- **Decision:** Capability-based UI. Each screen asks the current team membership what the user *can do* (`canManageRoster`, `canPostAnnouncements`, `canRSVP(for:)`, ...) instead of branching on role names everywhere.
- **Schema impact:** New enum value `player`; `players.user_id` links a roster entry to a player's own login.

## D-008 — Minors: COPPA-first player accounts — Accepted
- **Decision:**
  - Players **under 13** never get their own login. They are parent-managed roster entries (the existing model).
  - Players **13+** can get their own login only through a **player invite code generated by their guardian or head coach** for that specific roster entry. `mobile-api` refuses the claim if the roster birthdate is missing or under 13.
  - No third-party analytics or ad SDKs anywhere in the app. First-party only.
- **Why:** The amended COPPA rule is enforceable as of 2026-04-22. A guardian-initiated invite is a clean consent trail, and guardians stay linked to and in control of the player record.
- **Revisit:** Add Apple's Declared Age Range API for the self-reported age gate once the account flow is finalized (OQ-06).

## D-009 — Safety rule: no private adult↔minor messaging — Accepted
- **Decision:** Players can read and post only in **team-wide** threads (team chat and announcements), where coaches and guardians can see everything. The app does not offer direct/group thread creation to players, and `mobile-api` rejects it server-side.
- **Why:** A SafeSport-style "two-adult rule" is a real selling point for clubs and a liability reducer. Competitors don't enforce it.

## D-010 — Monetization model — Accepted (prices Provisional)
Grounded in research section 9. The core principle: **the free tier is genuinely complete and has no ads, ever.** We never paywall RSVP, calendar sync, chat, or availability, the most resented paywalls in the category.

| Stream | Channel | v1 status |
|---|---|---|
| **Team dues / registration payments** with a transparent per-checkout fee | Stripe Connect Express (real-world service → Apple guideline 3.1.3(e): IAP not allowed, 0% Apple fee) | **Built** (schema + Edge Function + iOS UI); needs Stripe keys |
| **Coach Pro** subscription | StoreKit 2 auto-renewable (guideline 3.1.1) | **Built** (StoreKit config for local testing + server verification endpoint) |
| **Family+ / Team Pass** (replays, highlights, stats) | StoreKit 2 | **Deferred** until video/stats features exist. Selling it before the content exists would be a billing trap |
| **Local team sponsorships** (ClubHQ keeps 10–15%) | Sold on the web only (3.1.3(g)); shown in-app as a team sponsor card, never targeted, never tracked | **Schema + display built**, sales flow is web (future) |
| **Club per-player SaaS** | Web, B2B | Future (needs club dashboard) |
| Fundraising, merch partners | Web / partners | Future, pending legal review |

## D-011 — Prices (Provisional — OQ-03)
- **Coach Pro:** $9.99/month or $69.99/year, 14-day free trial, covers up to **3 teams** as head coach.
- **Free:** 1 team as head coach, unlimited roster, everything coordination-related.
- **Pro unlocks:** additional teams (2–3), season attendance and availability reports, roster export (share sheet), dues payment reminders, custom team color, priority support. Future Pro items: practice planner, payment plans, forms/waivers.
- **Dues fee:** **2.9% + $0.79 per checkout, all-in**, paid by the family, shown before paying. This undercuts TeamSnap and SportsEngine (3.25% + $1.50) and Spond (3.29% + $1.00). Implemented as `application_fee_amount` on a Stripe destination charge; the rate lives in one place (`mobile-api` constants) so it is easy to change.

## D-012 — Push notifications go directly to APNs from Supabase — Accepted
- **Decision:** iOS registers its APNs device token in a new `device_tokens` table. `mobile-api`'s notification fan-out sends APNs pushes using a token-based (.p8) JWT. No Firebase.
- **Why:** One fewer vendor, and no third-party SDK touching minors' data (D-008).
- **Needs:** APNs key ID, team ID, and .p8 key as function secrets (OQ-04).

## D-013 — Multi-sport from day one — Accepted
- **Context:** The web app hard-codes basketball positions. TeamSnap competes across sports.
- **Decision:** Add `teams.sport` (default `basketball`, so existing rows don't change). The app ships position lists for basketball, soccer, baseball, softball, volleyball, football, hockey, lacrosse, plus "other" with free text.

## D-014 — Account deletion in-app — Accepted
- **Why:** App Store guideline 5.1.1(v) requires it for apps with account creation.
- **Decision:** Account → Delete Account → `mobile-api` `delete-account`. It removes roles, parent links, device tokens, and the auth user. Rosters a deleted coach created are kept if other staff remain; otherwise the team is archived.

## D-015 — Authentication: email/password + Sign in with Apple — Accepted
- **Decision:** Email/password matches the web app, so the same accounts work everywhere (the web app's "same accounts" choice). Sign in with Apple uses Supabase's `id_token` grant with a SHA-256 nonce.
- **Needs:** Apple provider enabled in Supabase Auth with the app's bundle ID (OQ-05).

## D-016 — Chat freshness via polling in v1 — Accepted
- **Decision:** Chat polls every 5 s while a thread is on screen and refreshes on foreground/pull-to-refresh. Push covers background.
- **Revisit:** Realtime websockets with `supabase-swift` (see D-004).

## D-017 — iOS 27 deployment target kept for now — Provisional
- **Context:** The project was created targeting iOS 27. iOS 27 shipped in September 2026, so adoption is still ramping.
- **Decision:** Keep iOS 27 during development. The code avoids iOS 27-only APIs where practical, so lowering to iOS 26 before launch is a small change (OQ-07).

## D-018 — Architecture pattern — Accepted
- `@Observable` app-level `AppModel` (session, context, selected team) injected via the environment. Feature views own lightweight `@State` and call the backend protocol directly via async/await (no Combine, per the project style guide). There is no per-screen view-model layer: the protocol boundary already gives testability, and a parallel VM hierarchy is overhead at this size.
- Swift Testing for unit tests against `DemoBackend` and the pure logic (fee math, RSVP cutoff, age gate, date decoding).

## D-019 — RSVP cutoff default — Accepted
- Matches the web app (PRD US-02): if `rsvp_cutoff_at` is null, RSVPs lock **4 hours before** start. Enforced in the UI and by the existing server logic.

## D-021 — APNs delivery is a separate dispatcher over `notification_sends` — Accepted
- **Context:** The web app's fan-out (`enqueueTeamNotification`) writes `notification_sends` rows and sends *web* push. If only `mobile-api` sent APNs, an announcement posted from the web would never reach an iPhone.
- **Decision:** New column `notification_sends.apns_sent_at` plus an `apns-dispatch` Edge Function that pushes every un-dispatched send to the recipient's `device_tokens`. It is invoked (a) right after `mobile-api` fans out, and (b) every minute by `pg_cron` to pick up web-originated sends. No web code changes are required.

## D-022 — iOS-only target (iPhone + iPad) — Accepted
- **Context:** The Xcode template created a multiplatform target (iOS, macOS, visionOS). The product is a mobile app, and native macOS would need a separate UIKit-free code path.
- **Decision:** `SUPPORTED_PLATFORMS = iphoneos iphonesimulator`, `TARGETED_DEVICE_FAMILY = 1,2`. Apple-silicon Macs can still run it as an iPad app. Desktop users have the web app.

## D-023 — App icon: "Home Court" (owner-selected 2026-10-13) — Accepted
- Five concepts in `design/app-icon/` (contact sheet: `ClubHQ-icon-concepts.png`). The owner chose **A · Home Court**: a white house with a center-court circle on a blue gradient. It reads as "HQ / home base", is sport-neutral, and is distinct from TeamSnap's orange.
- Drawn entirely from custom vector paths. The SF Symbols license forbids symbols in app icons.
- Installed as `AppIcon.appiconset` with light, dark, and tinted variants. Layered SVGs are in `design/app-icon/A-home-court/layers/` for an Icon Composer `.icon` file later (Liquid Glass specular/refraction tuning).
- The in-app `BrandMark` draws the same artwork natively. The app accent color is set to the icon blue (`#2457F5`, dark `#5B8CFF`).

## D-020 — Notification sends: read-state updates go through `mobile-api` — Accepted
- **Context:** The web migration history drops the recipient UPDATE policy on `notification_sends`.
- **Decision:** iOS marks inbox items read through `mobile-api` (service role, scoped to `recipient_user_id = caller`), not by re-adding an UPDATE policy.
