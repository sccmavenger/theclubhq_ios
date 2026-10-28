# ClubHQ for iPhone

An ad-free youth-sports team app for **coaches, parents, and players**: schedules, RSVPs,
attendance, team chat, announcements, and team dues. No ads, no trackers, and families'
data is never sold.

<table>
  <tr>
    <td align="center"><img src="design/readme/1-parent-home.png" width="200" alt="Parent home: every child's events across teams with one-tap RSVP"><br><sub>Parents: every kid, every team</sub></td>
    <td align="center"><img src="design/readme/2-coach-home.png" width="200" alt="Coach home: next event RSVP counts, what needs attention, quick actions"><br><sub>Coaches: what needs attention</sub></td>
    <td align="center"><img src="design/readme/3-schedule.png" width="200" alt="Schedule across all of a family's teams"><br><sub>One schedule for all teams</sub></td>
    <td align="center"><img src="design/readme/4-event.png" width="200" alt="Event detail with location and RSVP"><br><sub>Event details and RSVP</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="design/readme/5-chat.png" width="200" alt="Team chat"><br><sub>Team chat</sub></td>
    <td align="center"><img src="design/readme/6-team.png" width="200" alt="Team hub with roster, announcements, dues, settings"><br><sub>Team hub and roster</sub></td>
    <td align="center"><img src="design/readme/7-welcome-tour.png" width="200" alt="First-run welcome tour for a parent"><br><sub>First-run welcome tour</sub></td>
    <td></td>
  </tr>
</table>

## What it does
**Coaches**
- Schedule practices and games; families are notified automatically.
- See who's coming (Going / Maybe / Out / No reply) and take attendance.
- Post announcements, run team chat, and message families.
- Collect dues: families get one-tap Venmo or Cash App buttons, and coaches mark payments paid.
- Invite families with one code or link that lasts the season (Reset Code if it leaks). Parents add their own kids, so there's no roster typing.
- A "Get your team ready" checklist walks new coaches through setup, and coaches get a notification each time a family joins.
- **Move from GroupMe:** a four-step guide with ready-to-paste messages (invite link, team code and switch date filled in) to move a team off GroupMe.
- Weekly repeating events keep their local time across Daylight Saving.

**Parents**
- One home screen for every child on every team, with one-tap RSVP.
- Push alerts for schedule changes, announcements, and messages.
- See what's due and pay the coach directly.
- **Co-parents** join the same child from an invite on the child's profile, so the roster doesn't get duplicates.

**Players (13+)**
- Their own login for the schedule, self-RSVP, and team chat. Players can't start private conversations.

**Everyone**
- **Photos in team chat.** They're resized on the phone, and location and other metadata are removed before upload.
- **Calendar sync:** one private feed covering every team you're on, for Apple Calendar or Google Calendar (Schedule → Calendar sync).
- An **"Open Event"** action in the Shortcuts app.
- A short role-specific welcome tour on first launch (replay it from More → Show App Tour). Invite links on teamclubhq.com open the app directly.

## Status (2026-10-23)
- **App Store:** version 1.0 (build 17) is waiting for App Review, and it releases automatically once approved. Card payments and Coach Pro are off in 1.0. Coach Pro ships in 1.0.1 once the Paid Apps Agreement is active.
- **TestFlight:** build 17 is live for the external group.
- **Next:** see [`docs/ROADMAP.md`](docs/ROADMAP.md), which includes an Apple Intelligence track. Phase 0 groundwork is done; on-device schedule import from screenshots, PDFs or text comes next.

## Run it
1. Open `ClubHQ.xcodeproj` in Xcode 27 and pick an iPhone simulator (iOS 27).
2. Build & Run. The sign-in screen offers **Demo Mode**: pick Coach, Parent, or Player to explore a seeded team with no account. Switch roles any time under More → Demo mode.

Debug builds accept launch arguments for screenshots:
`-ScreenshotPersona coach|parent|player -ScreenshotTab home|schedule|team|messages -ScreenshotOpen chat|event|tour`
(see [`docs/APP_STORE.md`](docs/APP_STORE.md)).

Unit tests (Swift Testing) live in `ClubHQTests`: Product → Test, or ⌘U.

To test Coach Pro purchases locally: Edit Scheme → Run → Options → StoreKit Configuration → `StoreKit/ClubHQ.storekit`.

## How it's built
- **SwiftUI**, iOS 27, no third-party dependencies. `AppModel` holds the session and teams; views talk to the `ClubHQBackend` protocol, which has a live `SupabaseBackend` and an in-memory `DemoBackend` used for Demo Mode, previews, and tests.
- **Supabase** backend (`supabase/`): Postgres with row-level security, plus Edge Functions. `mobile-api` handles privileged actions (teams, invites, dues, chat photos, notifications), `calendar-feed` serves each user's calendar subscription, `apns-dispatch` sends push notifications, and webhooks handle Stripe and the App Store.
- **teamclubhq.com** (`site/`) on Cloudflare Pages serves the privacy, terms, and support pages and the invite landing page, and enables universal links.
- The iPhone app is the only customer client; an earlier web prototype is retired. Staff use the **admin portal** at teamclubhq.com/adminportal (`site/adminportal/`) with MFA; see [`docs/ADMIN_PORTAL.md`](docs/ADMIN_PORTAL.md).

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Backend and releases
- **Backend:** migrations in `supabase/migrations/`, functions in `supabase/functions/`. The runbook is [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Credentials live in a gitignored `.env.local`.
- **Website:** `scripts/deploy-site.sh` publishes `site/` to Cloudflare Pages.
- **App Store and TestFlight:** [`docs/APP_STORE.md`](docs/APP_STORE.md) and the scripts in `scripts/asc/`.

## Docs
| Doc | What's in it |
|---|---|
| [`docs/PRODUCT_STRATEGY.md`](docs/PRODUCT_STRATEGY.md) | Positioning vs TeamSnap, personas, revenue model, roadmap |
| [`docs/research/COMPETITIVE_ANALYSIS.md`](docs/research/COMPETITIVE_ANALYSIS.md) | Competitor, pricing, App Store, and COPPA research |
| [`docs/ADMIN_PORTAL.md`](docs/ADMIN_PORTAL.md) | Internal admin portal: decisions, launch gate, data model, screens |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's next, including the Apple Intelligence track and its status |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every "how" decision and why |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Open questions for the owner |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Backend rollout runbook |
| [`docs/APP_STORE.md`](docs/APP_STORE.md) | App Store listing, TestFlight, and review notes |
| `design/app-icon/` | Icon concepts; A · Home Court is the chosen icon |
