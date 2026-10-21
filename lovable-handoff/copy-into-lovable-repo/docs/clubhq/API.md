# ClubHQ Web — Backend Contract

**Use `src/lib/clubhq/api.ts`. It already implements everything below.** This document explains what each call does so you can wire up the UI, and it is the reference if you need to debug.

The backend is a production Supabase project shared with the ClubHQ iPhone app. **It is read-only from your point of view as a builder:**
- no migrations, tables, policies, Edge Functions, buckets, or cron;
- no Lovable Cloud;
- no service-role key.

## Connection

| Setting | Value |
|---|---|
| Supabase URL | `https://qpchhtakmxcfqtbjjpvi.supabase.co` |
| Publishable key | `sb_publishable_zH1AESb-lq1S8bIyeaPeyw_TN-YYD5o` (public by design; RLS protects data) |
| CORS | Auth, PostgREST, and `mobile-api` all accept browser requests from any origin |
| Auth | Email + password. Sign-up confirmation and password reset use **6-digit emailed codes** (`verifyOtp`), never links |

These values are hard-coded in `api.ts`. Don't move them into Lovable environment variables or a Lovable-managed Supabase integration.

## Two transports

1. **PostgREST** (`supabase.from(table)`) for plain reads and writes that Row Level Security allows.
2. **`mobile-api` Edge Function** for anything privileged or aggregated: `POST /functions/v1/mobile-api` with JSON `{ "action": "<name>", ...params }` and headers `apikey` + `Authorization: Bearer <user access token>`.
   - Responses are snake_case JSON.
   - Errors are `{ "error": { "code": "...", "message": "..." } }` with an HTTP status.
   - Every action requires a signed-in user.

## Auth (supabase-js)

| `api.ts` | Supabase call | Notes |
|---|---|---|
| `signIn(email, password)` | `auth.signInWithPassword` | `invalid_credentials`, `email_not_confirmed` |
| `signUp(name, email, password)` | `auth.signUp({ options: { data: { full_name } } })` | Returns `"confirm_email"` (normal) or `"signed_in"` |
| `verifyEmailCode(email, code, isRecovery)` | `auth.verifyOtp({ type: "email" \| "recovery" })` | Signs the user in |
| `resendSignupCode(email)` | `auth.resend({ type: "signup" })` | Rate-limited (`over_email_send_rate_limit`) |
| `sendPasswordReset(email)` | `auth.resetPasswordForEmail` | The email contains a 6-digit code |
| `updatePassword(pw)` | `auth.updateUser({ password })` | Minimum 8 characters |
| `signOut()` | `auth.signOut()` | |
| `deleteAccount()` | `mobile-api delete-account`, then local sign-out | |

## `mobile-api` actions

| Action (`api.ts` fn) | Params | Returns | Who | Notable errors |
|---|---|---|---|---|
| `context` (`loadContext`) | — | `UserContext` | any user | — |
| `update-profile` (`updateProfile`) | `full_name` (1–120) | ok | self | — |
| `create-team` (`createTeam`) | `team_name`, `sport`, `age_group?`, `season?`, `org_type` club\|independent, `org_name?` | `{ team_id, org_id }` | any user | `upgrade_required` 402 (2nd team without Pro), `team_limit` 402 (4th) |
| `update-team` (`updateTeamColor`) | `team_id`, `brand_color` "#RRGGBB"\|null | ok | head coach | `upgrade_required` (color needs Pro) |
| `create-invite` (`createInvite`) | `team_id` | `{ token, expires_at }` | head coach | `forbidden` |
| `lookup-invite` (`lookupInvite`) | `token` | `{ valid, team?, already_on_team? }` | any user | `invalid_input` (< 8 chars) |
| `claim-invite` (`claimInvite`) | `token`, `child{ first_name, last_name, jersey_number?, position?, birthdate?, parent_relationship, contacts[{relationship, name?, phone, email?}] }` | `{ team_id, player_id }` | any user | `not_found` 404, `expired` 410, `invalid_input` |
| `create-player-invite` (`createPlayerInvite`) | `player_id` | `{ code, expires_at }` | head coach or that child's guardian | `already_claimed` 409, `birthdate_required` 422, `too_young` 422 |
| `claim-player-invite` (`claimPlayerInvite`) | `code` | `{ team_id, player_id }` | the player's own account | `expired` 410, `too_young` 422, `forbidden` (a guardian used it) |
| `set-player-birthdate` (`setPlayerBirthdate`) | `player_id`, `birthdate` YYYY-MM-DD | ok | head coach or guardian | `invalid_input` (future date) |
| `team-members` (`teamMembers`) | `team_id` | `{ members: TeamMember[] }` | member | `forbidden` |
| `list-threads` (`threads`) | `team_id` | `{ threads: MessageThread[] }` | member (RLS filters audience) | — |
| `team-chat` (`teamChatThreadId`) | `team_id` | `{ thread_id }` | member | — |
| `create-thread` (`createThread`) | `team_id`, `audience` both\|parents\|staff, `title?`, `body` (1–4000) | `{ thread_id }` | staff | `forbidden` |
| `list-messages` (`threadDetail`) | `thread_id`, `since?` | `ThreadDetail` (marks the thread read) | thread member | `not_found` |
| `post-message` (`postMessage`) | `thread_id`, `body` (1–4000) | `{ id, created_at }` | thread member (players: team threads only) | `forbidden` |
| `delete-message` (`deleteMessage`) | `message_id` | ok | author or head coach | `forbidden` |
| `set-mute` (`setMute`) | `thread_id`, `muted` | ok | self | — |
| `create-announcement` (`createAnnouncement`) | `team_id`, `title` (1–140), `body` (1–4000) | `{ id }` | head coach | `forbidden` |
| `save-event` (`saveEvent`) | `team_id`, `title`, `event_type`, `starts_at`, `ends_at?`, `location?`, `location_address?`, `notes?`, `opponent?`, `home_away?`, `event_id?` (update) or `repeat_weeks?` 0–26 (create) | `{ event_ids }` | head coach | `forbidden`, `invalid_input` (end ≤ start) |
| `cancel-event` (`cancelEvent`) | `event_id` | ok | head coach | `forbidden` |
| `set-rsvp` (`setRSVP`) | `event_id`, `player_id`, `status` yes\|no\|maybe, `note?` (≤ 280) | ok | guardian of the player, or the player | `rsvp_locked` 409, `cancelled` 409, `forbidden` 403 |
| `inbox` (`inbox`) | — | `{ items: InboxItem[] }` (100 newest) | self | — |
| `mark-read` (`markRead`) | `id` or `all: true` | ok | self | — |
| `list-dues` (`dues`) | `team_id` | `DuesOverview` (guardians see only their kids' items) | member | `forbidden` |
| `create-dues` (`createDues`) | `team_id`, `title`, `description?`, `amount_cents` 100–500000, `due_date?` | `{ request_id }` | head coach | `invalid_input` (empty roster) |
| `set-dues-status` (`setDuesStatus`) | `item_id`, `status` unpaid\|paid\|waived | ok | head coach | `conflict` 409 (processing) |
| `remind-unpaid` (`remindUnpaid`) | `request_id` | `{ reminded }` | head coach, Pro team | `upgrade_required` |
| `connect-payments` (`connectPayments`) | `team_id` | `{ url }` (Stripe onboarding) | head coach | `not_configured` 503 until Stripe is live |
| `refresh-payments` (`refreshPayments`) | `team_id` | `{ payments_enabled, payments_connected }` | staff | — |
| `checkout` (`checkout`) | `item_ids` (≤ 20, one team) | `CheckoutSession` | guardian of those players | `payments_disabled` 409, `conflict` 409, `forbidden` |
| `delete-account` (`deleteAccount`) | — | ok | self | — |

Don't call `register-device`, `unregister-device`, or `sync-subscription`. They are iOS-only (APNs and App Store).

## PostgREST (direct table access under RLS)

| `api.ts` fn | Table & operation |
|---|---|
| `roster(teamId)` | `players` select, `team_id = X`, `archived_at is null`, order last, first |
| `savePlayer(draft)` | `players` insert (with `team_id`, `created_by`) or update by `id`. Head coach |
| `archivePlayer(id)` | `players` update `archived_at = now`. Head coach |
| `emergencyContacts(playerId)` | `player_emergency_contacts` select, order `created_at` |
| `events(teamIds, from, to?)` | `events` select, `team_id in (…)`, `starts_at >= from` (`< to`), order `starts_at`, limit 200 |
| `eventDetail(id)` | `events` by id + `rsvps` + `attendance` for the event + `roster(team)` |
| `myRSVPs(eventIds)` | `rsvps` select, `event_id in (…)` (RLS: staff see all; families see their own kids) |
| `setAttendance(eventId, entries)` | `attendance` upsert on `(event_id, player_id)` with `marked_by`. Head coach |
| `setScore(eventId, home, away)` | `events` update `home_score`, `away_score`, `result`. Head coach |
| `teamAttendance(teamId)` | `attendance` select with `events!inner(team_id)` filter, limit 5000 |
| `announcements(teamId)` | `announcements` select, newest first, limit 50 |
| `sponsors(teamId)` | `team_sponsors` active today (never throws) |

## Error codes the UI should know

| Code | Meaning | UI |
|---|---|---|
| `unauthorized` | Session gone | Sign out → `/welcome`, toast |
| `network` | Offline / fetch failed | Inline "Couldn't refresh. Pull to try again." |
| `forbidden` | Not allowed (RLS or role) | Show message |
| `invalid_input` | Validation failed | Show message inline |
| `not_found`, `expired` | Missing / expired invite, event, code | Show message |
| `rsvp_locked`, `cancelled` | RSVP closed | Show message, refetch event |
| `upgrade_required`, `team_limit` | Plan limit | Explanatory text, **no purchase button** |
| `already_claimed`, `birthdate_required`, `too_young` | Player-account rules | Show message |
| `conflict` | Card payment in progress | Show message |
| `payments_disabled`, `not_configured`, `payment_error` | Stripe not ready | Show message |
| Auth codes (`invalid_credentials`, `email_not_confirmed`, `otp_expired`, `over_email_send_rate_limit`, `over_request_rate_limit`, `weak_password`, `user_already_exists`, `email_address_invalid`, `signup_disabled`) | Supabase Auth | `api.ts` already maps them to friendly text |

## Notifications on the web
The server writes an inbox row (`notification_sends`) for every recipient of announcements, new events, event changes and cancellations, messages, and dues requests. **The web app shows these in `/inbox`** and in the bell badge. Web push isn't available; email notifications are a planned server feature. Don't build either.

## Verified
`api.ts` was type-checked under `strict` against `@supabase/supabase-js` v2. Its read paths were exercised against production, signed in as a demo parent: context, events, RSVPs, event detail, roster, members, threads, team chat, announcements, inbox, dues, sponsors, invite lookup, emergency contacts, and error mapping.
