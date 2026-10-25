# ClubHQ Admin Portal: plan

Written 2026-10-24 from an interview with the owner. Decision record: [D-041](DECISIONS.md).
Status of each piece is tracked in the [launch gate](#launch-gate) table below.

## The ten decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Who it's for | **Internal ops console first** (the owner, later a support hire). The **club director portal** (a director sees every team in the club and messages them all) comes after. Clubs are a first-class object from day one so the director portal is a narrower view of the same data, not a rebuild. |
| 2 | What it shows | All of it: signups, team activation and engagement, revenue, at-risk and power-user teams, alerts, feature adoption, acquisition source. Build order below. |
| 3 | Scale | 0 teams today; goal 100+ teams (≈1,500–3,000 people) in six months. Small enough to know every team personally, so **per-team views come before aggregate charts**. Plain SQL on the existing database; no analytics warehouse. |
| 4 | Where | **A web portal**, phone-friendly, installable on the iPhone home screen, with **web push alerts**. No admin code ships inside the App Store app. |
| 5 | Actions | All of them: support fixes, account control, billing grants, read-only "view as", broadcasts. With guardrails (below). |
| 6 | Privacy | **Admins see chat content only when it's reported.** Enforced by the database, not just the UI. Counts ("240 messages this week") are fine; bodies are not. |
| 7 | Support | **Email** stays the channel. The portal finds a person by email address and shows everything about them. In-app tickets can come later. |
| 8 | Entitlements | **Pro = an App Store subscription _or_ a grant issued from the portal** (beta testers, ambassadors, club pilots, later club billing). |
| 9 | Analytics | **First-party usage events in our own Supabase database.** No third-party SDK. The App Store privacy label gains "Product Interaction · Analytics · Linked to you · Not used for tracking". |
| 10 | Launch | **The public launch waits** until Phase 1 of the portal and the app-side changes are done, so the first real teams are visible from day one and no history is lost. |

## How competitors do it (context)

- **Internal side** (not published, inferred from how SaaS companies at their stage usually work): a product-analytics tool (Amplitude, Mixpanel, PostHog), billing data (Stripe, RevenueCat, App Store), a support desk (Zendesk, Intercom), and a custom admin tool (often Retool or in-house) to look up a user or team, fix data, comp plans and impersonate.
- **Customer-facing side:** TeamSnap for Clubs & Leagues, SportsEngine HQ, LeagueApps, TeamLinkt and now GameChanger for Basketball Clubs sell a director dashboard (all teams, registration, payments, reports, club-wide messaging). For them it's a revenue line. ClubHQ's version is Phase 4.

## What already existed (found while planning)

These pieces were already in the backend, which made Phase 1 smaller than expected:

| Already there | Where |
|---|---|
| App Store Server Notifications v2, signature-verified | `functions/appstore-notifications`, `_shared/appstore.ts` |
| Purchases tagged with the user's account (`appAccountToken` = user id) | `PaywallView.swift`, `recordTransaction` |
| `app_store_subscriptions` table and `user_has_coach_pro` / `team_is_pro` | `20261013120100_mobile_foundation.sql` |
| Clubs: `organizations` (type `club` / `independent`), `program_director` role, team → org | original schema |
| An `audit_logs` table (empty, unused) | original schema |
| Complimentary Pro already anticipated in the Account screen | `AccountView.swift` |

What was missing: reports and blocks only lived in email and on one phone; nobody could act as an admin without also gaining chat access (`super_admin` reads every thread, so the portal deliberately does **not** use it); no usage or activity data; no way to grant Pro; no suspension; no alerts.

## Launch gate

Status key: ✅ done · 🔨 in progress · ⬜ not started · 👤 owner task.

| # | Item | Where | Status |
|---|---|---|---|
| **App** | | | |
| 1 | Reports go to the server (message and conversation reports), email kept as fallback | `ChatView`, `mobile-api report-content` | ⬜ |
| 2 | Blocks sync to the server and follow the user across devices; blocked authors are filtered server-side | `ChatView`, `mobile-api block-user` | ⬜ |
| 3 | Usage events (UI-only moments) batched to the server | `Core/Analytics/UsageTracker.swift`, `mobile-api track` | ⬜ |
| 4 | "How did you hear about ClubHQ?" on Create Team; how each user arrived (`signup_via`) recorded server-side | `CreateTeamView`, `create-team` / `claim-*` | ⬜ |
| 5 | Suspended accounts get a clear message instead of generic errors | `BackendError` | ⬜ |
| 6 | Privacy manifest declares Product Interaction (analytics, linked, not tracking) | `PrivacyInfo.xcprivacy` | ⬜ |
| 7 | App Store Connect privacy label updated to match | ASC → App Privacy | 👤 |
| **Backend** | | | |
| 8 | Admin roles (`platform_admins`: owner / support), separate from in-app roles | migration `20261024120000_admin_portal.sql` | ⬜ |
| 9 | Chat privacy enforced in the database: admin reads go through `admin_*` SQL functions that never select message bodies; report snapshots are the only content admins see | same | ⬜ |
| 10 | Every admin action audited (who, what, when, before/after) | `audit_logs` + `admin-api` | ⬜ |
| 11 | Pro grants (user / team / club, expiry, reason) honored by `user_has_coach_pro` and `team_is_pro` | same | ⬜ |
| 12 | Activity: one row per user per active day; mutating API calls logged as usage events automatically | `mobile-api` | ⬜ |
| 13 | Subscription history (`app_store_events`) and trial flag for revenue metrics | `_shared/appstore.ts` | ⬜ |
| 14 | Suspension (flag + auth ban) and scheduled deletion with a 7-day grace period | `admin-api` | ⬜ |
| **Portal (Phase 1)** | | | |
| 15 | Sign-in with emailed code + required authenticator-app MFA (AAL2 enforced server-side) | `admin/` | ⬜ |
| 16 | Overview: KPIs, weekly signups / active teams, open reports, revenue snapshot | `admin/` | ⬜ |
| 17 | Teams list with health signals, sortable, "going quiet" first | `admin/` | ⬜ |
| 18 | Team and user profiles, search by email or name, read-only "view as" | `admin/` | ⬜ |
| 19 | Moderation queue with 24-hour clock; remove, warn, suspend, dismiss | `admin/` | ⬜ |
| 20 | Actions with guardrails (typed confirmations, grace period, previews) | `admin/` + `admin-api` | ⬜ |
| 21 | Web push alerts: new report, new team, subscription changes | `_shared/webpush.ts` | ⬜ |
| 22 | Hosting: Cloudflare Pages project `clubhq-admin` | `scripts/deploy-admin.sh` | ⬜ |
| 23 | Custom domain `admin.teamclubhq.com` + Cloudflare Access in front | Cloudflare dashboard | 👤 (optional hardening, see below) |
| 24 | APNs key so broadcasts and warnings reach phones | OQ-04 | 👤 |

## Build order after launch

| Phase | What | Notes |
|---|---|---|
| **2 · Revenue** | Subscriber list, trial → paid conversion, cancellations, refunds, MRR trend | Data is collected from Phase 1 on (`app_store_events`). Prices are list prices; Apple's proceeds report is the source of truth for payouts. |
| **3 · Insights** | Team health score, feature-adoption charts, acquisition breakdowns by sport and region, segment broadcasts, weekly email digest | Starts as rules ("no events and no messages in 14 days"), not a model. |
| **4 · Club director portal** | Directors sign in, see their club's teams, message every team | Same data, scoped by `organizations` + `program_director`. Starts in-app (roadmap #10); the web portal can host a director view later. |
| Later | In-app "Contact Support" tickets; user-granted temporary support access (privacy option c); more admins | |

## Architecture

```
 Browser / home-screen web app (admin/)          Supabase (TeamClubHQ)
 ┌─────────────────────────────────────┐        ┌──────────────────────────────────────────┐
 │ Sign in: email code → TOTP (AAL2)   │──auth─▶│ GoTrue                                    │
 │ Reads:   rpc/admin_* (user JWT)     │──rest─▶│ admin_* SQL functions (SECURITY DEFINER) │
 │ Writes:  functions/v1/admin-api     │──fn───▶│ admin-api ── service role, audited        │
 │ Service worker: web push            │◀─push──│ _shared/webpush.ts ◀── mobile-api,        │
 └─────────────────────────────────────┘        │                         appstore-notifications│
                                                └──────────────────────────────────────────┘
```

- **Reads** go straight to PostgREST RPCs under the admin's own JWT. Every `admin_*` function starts with `private.require_platform_admin()`, which checks the `platform_admins` row **and** that the session is AAL2 (MFA verified). None of them select `messages.body` or `image_path`; the only content an admin can read is the snapshot stored in `content_reports` when someone reports it. Because these functions run under the admin's JWT, a bug in portal code can't widen access.
- **Writes** go to the `admin-api` Edge Function. It re-checks role and AAL2, applies the change with the service role, and writes an `audit_logs` row (actor, action, target, before/after). Owner-only actions: delete-now, merge accounts, manage admins, grants on clubs.
- **Why not `super_admin`:** the existing `super_admin` app role can read every thread (`private.can_read_thread`). Admins are kept out of `user_roles` entirely.
- **Alerts:** web push (VAPID, RFC 8291 encryption) to `admin_push_subscriptions`. iPhone delivers web push to web apps added to the Home Screen (iOS 16.4+).
- **Portal code:** static HTML/JS with no build step and no third-party scripts. The CSP allows only our Supabase project. `noindex`, no framing.

## Data model (migration `20261024120000_admin_portal.sql`)

| Table | Purpose |
|---|---|
| `platform_admins` | `email`, `user_id` (claimed at first sign-in), `role` (`owner` / `support`), `added_by`, `removed_at` |
| `content_reports` | Reporter, team, thread, message, author; **snapshot** of the reported text/photo path; reason, note; `status` (`open` / `actioned` / `dismissed`), resolution, resolver, timestamps |
| `user_blocks` | `blocker_id`, `blocked_id`, `created_at` |
| `pro_grants` | Exactly one of `user_id` / `team_id` / `org_id`; `reason`, `starts_at`, `expires_at`, `revoked_at`, `created_by` |
| `usage_events` | `user_id`, `team_id`, `name`, `source` (`app` / `server`), small `props`, `app_version`, `created_at` |
| `user_activity_days` | `(user_id, day)`, so DAU/WAU/MAU and "last seen" need no client change |
| `app_store_events` | Every App Store notification: type, subtype, product, user, environment |
| `account_deletions` | Scheduled deletions with a grace period; `legal` = immediate |
| `admin_broadcasts` | What was sent, to whom (segment), recipient counts, who sent it |
| `admin_push_subscriptions` | Web-push endpoints for admins, with the alert types each wants |
| `profiles` + | `acquisition_source`, `signup_via`, `suspended_at`, `suspended_reason`, `last_seen_at`, `app_version` |
| `app_store_subscriptions` + | `in_trial`, `created_at` |

## Screens

| Screen | Shows | Actions |
|---|---|---|
| **Overview** | Users, teams, active teams (7 d), new signups (7 d), open reports (oldest age), Pro (paid / granted), est. MRR; 12-week charts for signups and active teams | Process due deletions |
| **Teams** | Every team: club, sport, staff, families, players, last activity, events in the next 14 days, messages in the last 7 days, Pro; filter "going quiet" | Open team |
| **Team** | Details, club, staff and families, roster size, invite link, activity counts, threads (titles and counts only), dues summary, grants, audit trail | Rename, archive / restore, reset invite code, grant Pro, move a player |
| **People** | Search by email or name | Open person |
| **Person** | Account, sign-in and last-seen dates, app version, how they arrived, teams and roles, children, devices, subscription, grants, reports by / about them, blocks, audit trail | Edit name, send password-reset code, suspend / unsuspend, warn, grant Pro, schedule deletion / cancel, delete now (owner), merge into another account (owner), view as |
| **View as** | Read-only: their teams, children, upcoming events with their RSVPs, dues owed, notification subjects. No chats | — (the view itself is audited) |
| **Moderation** | Open reports with a 24-hour clock, reported snapshot, reporter note, author history | Remove content, warn author, suspend author, dismiss; all with a note |
| **Grants** | Active and expired grants | Create, revoke |
| **Broadcast** | Compose title and body, choose segment (everyone, coaches, head coaches, parents, players, Pro coaches, a team, a club), see recipient count and how many have push | Send test to me, send (typed confirmation) |
| **Audit log** | Every admin action | Filter |
| **Settings** | Admins (owner), this device's alerts | Add / remove admin, enable alerts |

## Guardrails

- **Audit log** on every write, plus "view as" and photo views on reports.
- **Typed confirmation** (the person's email or team name) for suspend, delete, merge and broadcast-to-everyone.
- **Deletion grace period:** "Schedule deletion" suspends now and deletes after 7 days; it can be cancelled. "Delete now" is owner-only, for legal requests.
- **Read-only "view as"**: it's a separate page built from read functions; there is no way to post as the user.
- **Broadcasts:** preview, recipient count, test-send to yourself first.
- **Roles:** Owner can do everything. Support can't delete, merge, manage admins or issue grants longer than 90 days.
- **MFA required** for every admin request (AAL2 checked in SQL and in `admin-api`).
- **Session:** the portal signs out after 12 hours.

## Security notes and owner hardening steps

1. **Add the custom domain** `admin.teamclubhq.com` to the Pages project `clubhq-admin` (Cloudflare → Workers & Pages → clubhq-admin → Custom domains).
2. **Optional: put Cloudflare Access in front** (Zero Trust → Access → Applications → Self-hosted → `admin.teamclubhq.com` and `clubhq-admin.pages.dev`, allow only your email). MFA and the admin table already protect the data; Access also hides the login page itself.
3. **Rotate credentials shared in chat** (OQ-13) before launch; the portal doesn't need any new long-lived secret except the VAPID key pair, stored as Edge Function secrets.

## Open questions

| # | Question | Working answer |
|---|---|---|
| OQ-18 | Can a club pay ClubHQ directly (invoice or card) for Pro on all its teams? | Likely yes, in two ways. Guideline 3.1.3(c), Enterprise Services, allows non-IAP payment when the purchase is made by an organization for its members. And since May 2025, US-storefront apps may also link to an outside purchase page (3.1.1(a)). Confirm against the current guidelines before building club billing. Free grants and pilots are fine either way. |
| OQ-19 | Update the App Store Connect privacy label (Product Interaction → Analytics, linked, not tracking) | Owner, in ASC → App Privacy. There's no API for it. |
| OQ-20 | Custom domain + Cloudflare Access for the portal | Owner, in the Cloudflare dashboard (steps above). |
