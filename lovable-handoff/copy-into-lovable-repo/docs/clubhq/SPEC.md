# ClubHQ Web — Product Spec

The web version of the **ClubHQ** iPhone app, for **Android phones and computers**. It is the same product on the same production backend. A coach, parent, or player can sign in on either and see the same teams, events, RSVPs, chat, and payments.

> **Read this first:** these docs answer the questions you'd normally ask. Where they're silent, follow the order in [Resolving questions](#resolving-questions). **Don't stop to ask the owner.**

## Contents
1. [Scope](#1-scope)
2. [Non-negotiables](#2-non-negotiables)
3. [Tech & hosting](#3-tech--hosting)
4. [App shell & navigation](#4-app-shell--navigation)
5. [Global state](#5-global-state)
6. [Screens](#6-screens)
7. [Business rules](#7-business-rules)
8. [Errors, loading, empty states](#8-errors-loading-empty-states)
9. [Out of scope](#9-out-of-scope)
10. [Milestones](#10-milestones)
11. [Resolving questions](#resolving-questions)

---

## 1. Scope

**Product:** an ad-free youth-sports team app for coaches, parents/guardians, and players 13+. It covers schedules, RSVPs, attendance, team chat, announcements, and team dues.

**Primary user of the web app:** a **parent on an Android phone** who got a team code or invite link from their coach. The secondary users are coaches and players who prefer a browser.

**Goal:** feature parity with the iPhone app (every screen in §6), with these iOS-only exceptions: push notifications, Sign in with Apple, App Store subscriptions, and Demo Mode (see §9).

**Personas** (one person can hold different roles on different teams):

| Persona | Who | Primary jobs |
|---|---|---|
| Coach | `head_coach`, `assistant_coach`, `team_manager` (plus `program_director`, `super_admin`) | Roster, schedule, attendance, announcements, dues |
| Parent / Guardian | `parent` (linked to one or more children) | Know where to be, RSVP per child, pay, stay informed |
| Player (13+) | `player` (own login, linked to their roster entry) | Schedule, RSVP for self, team chat |

## 2. Non-negotiables

1. **The backend is fixed.** Use only the functions in `src/lib/clubhq/api.ts`.
   - Do not create Supabase tables, migrations, RLS policies, Edge Functions, storage buckets, or cron jobs.
   - Do not enable Lovable Cloud or connect a Lovable-managed Supabase project.
   - The iPhone app depends on this exact backend.
2. **Never use a service-role key or any secret.** The publishable key in `api.ts` is the only credential.
3. **Field names stay snake_case**, as defined in `src/lib/clubhq/types.ts`. Don't rename or remap.
4. **Business rules come from `src/lib/clubhq/rules.ts`.** Import them; don't re-implement them.
5. **No ads, analytics, trackers, third-party scripts, or cookies beyond Supabase auth storage.** This includes Google Analytics, PostHog, Hotjar, Sentry with PII, and embedded fonts from third-party CDNs. Minors use this app (COPPA).
6. **Nothing a parent needs is ever behind a paywall.** Never show upgrade prompts. `COACH_PRO_PURCHASES_ENABLED` is `false`.
7. **Two-adult safety rule.** Players never start conversations and can post only in team-wide threads. The server enforces this; the UI must not offer it.
8. **Under-13s never get accounts.** Keep the neutral birth-year screen on sign-up (§6.1).

## 3. Tech & hosting

| Item | Choice |
|---|---|
| Framework | Lovable's default: Vite + React + TypeScript + Tailwind + shadcn/ui |
| Routing | `react-router-dom` |
| Data | `@tanstack/react-query` wrapping the `api.ts` functions. Invalidate the relevant queries after every mutation |
| Backend client | `@supabase/supabase-js` v2 via `src/lib/clubhq/api.ts` (already configured) |
| Icons | `lucide-react` (mapping in `DESIGN.md`) |
| Toasts | `sonner` (already in the template) |
| Production domain | **`https://app.teamclubhq.com`**. The bare `teamclubhq.com` is a separate static site — don't touch it |
| Layout | Mobile-first. Must be excellent at 360–430 px wide (Android Chrome). Comfortable on desktop |
| PWA | Add a web app manifest (name "ClubHQ", short name "ClubHQ", theme `#2457F5`, icons from `public/icons/`, `display: standalone`, `start_url: /`) so Android users can "Add to Home screen". **No service worker, no web push** |
| Dark mode | Follow the system (`prefers-color-scheme`). Both themes must meet WCAG AA contrast |
| Time zones | Show all timestamps in the browser's local time zone. Date-only fields use `rules.ts` helpers (never through UTC) |
| Accessibility | Real `<button>`/`<a>` elements, labels on every input, visible focus rings, 44 px minimum tap targets, `aria-pressed` on RSVP buttons, `aria-label` on icon-only buttons |

## 4. App shell & navigation

### 4.1 Routes

| Route | Screen | Access |
|---|---|---|
| `/welcome` | Sign in / Create account (§6.1) | Signed out |
| `/verify` | Enter 6-digit code (`?email=…&purpose=signup\|recovery`) | Signed out |
| `/forgot` | Forgot password (§6.1) | Signed out |
| `/new-password` | Set a new password after a recovery code | Signed in |
| `/join/:token` | Invite link landing (§6.2) | Anyone |
| `/onboarding` | "How are you joining ClubHQ?" (§6.3) | Signed in |
| `/onboarding/parent` | Join a team with a team code (§6.3) | Signed in |
| `/onboarding/coach` | Create a team (§6.3) | Signed in |
| `/onboarding/player` | Player code (§6.3) | Signed in |
| `/` | Home (§6.4) | Signed in with ≥ 1 team |
| `/schedule` | Schedule (§6.5) | ″ |
| `/events/new` | New event (§6.7) | Head coach |
| `/events/:id` | Event detail (§6.6) | ″ |
| `/events/:id/edit` | Edit event (§6.7) | Head coach |
| `/team` | Team hub (§6.8) | ″ |
| `/team/players/new` | Add player (§6.10) | Head coach |
| `/team/players/:id` | Player profile (§6.9) | ″ |
| `/team/players/:id/edit` | Edit player (§6.10) | Head coach |
| `/team/invite` | Invite families (§6.11) | Head coach |
| `/team/announcements` | Announcements (§6.12) | ″ |
| `/team/dues` | Dues & payments (§6.15) | Staff or guardian |
| `/team/dues/:requestId` | Dues request detail (§6.15) | Head coach |
| `/team/report` | Season report (§6.16) | Staff |
| `/team/settings` | Team settings (§6.17) | Head coach |
| `/messages` | Conversations (§6.13) | ″ |
| `/messages/:threadId` | Chat (§6.14) | ″ |
| `/inbox` | Notifications (§6.18) | ″ |
| `/more` | Account & settings (§6.19) | Signed in |
| `/event/:id` → `/events/:id`, `/team/messages/:id` → `/messages/:id`, `/notifications` → `/inbox`, `/parent` → `/team/announcements` | Redirects (server-generated link paths) | — |
| `*` | Not found with a "Go home" button | — |

### 4.2 Route guards
- **No session:** send to `/welcome`. Preserve the intended path, and the `/join/:token` token, and return there after sign-in.
- **Session, but context has 0 teams:** send to `/onboarding` (except `/join/*`, `/more`, `/new-password`).
- **Session and ≥ 1 team** on `/welcome`: send to `/`.
- **A role-gated route the user can't use:** redirect to the closest allowed parent (e.g. `/team`) with a toast "You don't have access to that."

### 4.3 Layout
- **Under 1024 px:** sticky top bar plus a **bottom tab bar** with five tabs: **Home** (`house`), **Schedule** (`calendar`), **Team** (`users`), **Messages** (`messages-square`), **More** (`ellipsis`). Respect `env(safe-area-inset-bottom)`.
- **1024 px and up:** a left sidebar with the same five items, and content max-width 760 px, centered.
- **Top bar contents:**
  - the page title;
  - the **team switcher** on Home, Team, and Messages. It's a dropdown of all teams with sport icons when there are 2+ teams; otherwise a static label with the team name;
  - the **bell** on Home: opens `/inbox`, shows a dot badge when unread > 0, and has the `aria-label` "Notifications, N unread".
- The selected team's `brand_color` (`teamTint`) tints the active tab, primary buttons, and accents. It falls back to `#2457F5`.

## 5. Global state

| State | Source | Notes |
|---|---|---|
| Session | `supabase.auth` (persisted in localStorage key `clubhq-auth`) | Listen to `onAuthStateChange`. `setUnauthorizedHandler` → sign out → `/welcome` with toast "Your session ended. Please sign in again." |
| Context | `api.loadContext()`, query key `["context"]` | Reload after sign-in, joining/creating a team, profile or team color changes |
| Selected team | localStorage `clubhq.selectedTeamId` | If missing or not in context, use `context.teams[0]` |
| Capabilities | `rules.capabilities(selectedTeam)` | Screens check capabilities, never role names |
| Pending invite token | sessionStorage `clubhq.pendingInviteToken` | Set by `/join/:token`; prefills `/onboarding/parent`; cleared after a successful join |

**Polling** (only while the tab is visible — pause when `document.visibilityState === "hidden"`):
- open chat: every 5 s;
- inbox unread count: every 60 s;
- everything else: refresh on window focus (React Query default) and on pull-to-refresh / a "Refresh" button.

## 6. Screens

Copy in **quotes** is exact. Match it.

### 6.1 Welcome, sign in, create account (`/welcome`)
- **Header:** the ClubHQ brand mark (76 px, see `DESIGN.md`), "ClubHQ", and "Schedules, RSVPs, chat, and team payments — in one ad‑free app for coaches, parents, and players."
- **Card with a segmented control:** **Sign In** | **Create Account**.
- **Sign In:** Email and Password (with a show/hide eye toggle), a **Sign In** button, and a "Forgot password?" link to `/forgot`.
  - The button is enabled when the email contains "@" and "." and the password is non-empty.
- **Create Account:** Full name, Email, "Password (8+ characters)", and "Birth year (YYYY)" (numeric, 4 digits; `rules.parseBirthYear`).
  - The button is enabled when the email is valid, the password is ≥ 8 characters, the name is non-empty, and the birth year is valid.
  - Hint text: "Coaches, parents, and players (13+) all start here. You'll pick your role next."
  - Under the button: "By creating an account you agree to the Terms and Privacy Policy." (links).
- **Submitting Create Account:**
  1. If `rules.ageGateBlocks(year)`, show `AGE_GATE_MESSAGE` in red and stop. Never reveal the age cutoff anywhere else.
  2. Call `api.signUp`. On `"confirm_email"`, go to `/verify?email=…&purpose=signup`. On `"signed_in"`, load context.
- **Submitting Sign In:** `api.signIn`.
  - If the error code is `email_not_confirmed`, call `api.resendSignupCode(email)` and go to `/verify?purpose=signup`.
- **Email handling:** trim and lowercase emails before every auth call.
- **Footer:** "Privacy" and "Terms" links (`PRIVACY_URL`, `TERMS_URL`).
- **Not included:** demo mode and social sign-in.

**Verify code (`/verify`)**
- Envelope icon (a key icon for recovery). Title: "Check your email" (recovery: "Reset your password").
- Text: "We sent a 6-digit code to **{email}**. Enter it below."
- One large centered numeric input: `inputmode="numeric"`, `autocomplete="one-time-code"`, digits only, max 6.
- **Auto-submits at 6 digits.** **Continue** button. "Resend code in {n}s" countdown from 60, then a "Resend code" link. The resend calls `resendSignupCode`, or `sendPasswordReset` for recovery.
- Helper text: "Don't see it? Check spam or promotions for mail from info@teamclubhq.com."
- On a wrong code, clear the input and show the error.
- On success: recovery goes to `/new-password`; signup loads context and routes per §4.2.

**Forgot password (`/forgot`):** Email field. Footer: "We'll email you a code to reset your password." **Send Code** → `api.sendPasswordReset` → `/verify?purpose=recovery`.

**New password (`/new-password`):** "Choose a new password" with a password field (≥ 8). **Save** → `api.updatePassword`, toast "Password updated", then go to `/`.

### 6.2 Invite link landing (`/join/:token`)
Coaches share `https://app.teamclubhq.com/join/<CODE>` (and the iPhone app shares the code itself). `lookup-invite` **requires a signed-in user**, so:

1. Save the token (`rules.parseInviteToken(param)`) to sessionStorage `clubhq.pendingInviteToken`.
2. **Signed out:** show the brand mark and "You're invited to join a team". Lead: "Your coach uses ClubHQ for the schedule, RSVPs, and team chat. Create a free account to add your child." Buttons:
   - **Create Account** → `/welcome` (Create Account tab);
   - **I already have an account** → `/welcome` (Sign In tab);
   - small text: "On an iPhone? Get the app" linking to `APP_STORE_URL`.
3. **Signed in:** go straight to `/onboarding/parent` (the token is prefilled and looked up automatically).

### 6.3 Onboarding (`/onboarding`)
Title: "Welcome, {first name}". **Sign Out** in the top bar. Heading: "How are you joining ClubHQ?" Three option cards with icon, title, and detail:
- "I'm a parent or guardian": "Enter the team code from your coach and add your child." → `/onboarding/parent`
- "I'm a coach": "Create your team in under a minute. Free, no ads." → `/onboarding/coach`
- "I'm a player (13+)": "Enter the code your parent or coach gave you." → `/onboarding/player`

The same list is reused from More → "Add or Join a Team".

**Join a team: parent (`/onboarding/parent`)**
- **Team code section:**
  - Input "Team code (e.g. ABCDE FGHJK)": monospace, uppercase display, autocorrect off. It also accepts a pasted link or invite message (`rules.parseInviteToken`).
  - **Find Team** button, enabled when `isPlausibleInviteToken`.
  - Footer: "Get the code from your coach. Coaches find it in ClubHQ → Team → + → Invite Families. You can also paste the whole invite message."
  - Auto-look-up on load when a pending token exists.
- **Invalid lookup** (`valid:false`): amber warning "This invite is expired or invalid. Ask your coach for a new link."
- **Valid lookup:** a team card (sport icon, name, "age group · season"). If `already_on_team`, also show the note "You're already on this team — you can add another child."
- **"Your child" section:**
  - First name, Last name, and "Jersey number (optional)";
  - Position: a select of `POSITIONS[sport]` plus "Not sure", or free text when the list is empty;
  - an "Add birthdate" toggle that reveals a date input (max today);
  - "You are their": a select of Mother/Father/Guardian/Other (default Guardian).
- **"Emergency contact" section:**
  - Name (prefilled with the user's full name), Phone (`type="tel"`), "Email (optional)", and Relationship (default Guardian);
  - footer: "Required so coaches can reach a guardian during practices and games."
- **Join {team name}** button, enabled by `isNewChildValid`. Footer: "Your child's info is visible only to their team's coaches and is never sold or used for ads."
- **On success:** clear the pending token, set the selected team to the returned id, reload context, go to `/`, and show the toast "You're on {team name}!"

**Create a team: coach (`/onboarding/coach`)**
- **"Team" section:** "Team name (e.g. Mayhem Elite 14U)" (required), Sport (select of `SPORTS` with labels and icons, default Basketball), "Age group (optional)", and "Season (optional, e.g. Fall 2026)".
- "Part of a club or league" toggle that reveals "Club name". Footer: "Club tools (multi-team admin, registration) are coming soon. Your team works the same either way."
- **Create Team**, enabled when the team name is non-empty.
- **Success:** select the new team, reload context, and go to `/`.
- **Errors:** `upgrade_required` → "The free plan includes one team as head coach. Coach Pro (in the ClubHQ iPhone app) lets you run up to 3." `team_limit` → show the server message. Never show a purchase button.

**Player code (`/onboarding/player`)**
- Input "8-character code" (monospace, uppercase). Footer: "Player accounts are for ages 13 and up. Your parent or coach creates the code from your player profile."
- **Join My Team**, enabled at ≥ 6 characters. Success → select the team, reload, `/`.
- Errors show the server message. For example, `forbidden`: "Sign in with the player's own account to use this code."

### 6.4 Home (`/`)
Title: `rules.greeting(full_name, email)`. Layout depends on `primaryPersona` of the selected team.

**Data loaded** (reload on team change or focus):
- **events:**
  - parents: all teams where they're a guardian;
  - coaches and players: the selected team only;
  - range: start of today → +14 days;
  - coaches see cancelled events; others don't.
- **RSVPs** for those events (`myRSVPs`).
- **Roster** (coach only, for counts). Load it before showing counts so they never flash 0.
- **Inbox unread count**, **latest announcement** (first of `announcements`), **first sponsor**, and **dues**.
  - coach: count of unpaid items;
  - parent: sum of unpaid `amount_cents` across all guardian teams.
  - These secondary loads must never blank the page on failure.

**Coach layout**
1. **"Up next":** the next non-cancelled event of the selected team as an `EventSummaryRow` (links to detail), followed by an `RSVPSummaryBar` (Going / Maybe / Out / No reply, from `rsvpCounts`).
   - Empty state: calendar icon, "Nothing scheduled", "Add your first practice or game — families get notified automatically.", and an **Add Event** button.
2. **"Needs attention":**
   - "{n} haven't RSVP'd" (orange) or "Everyone has responded" (green), with the event title as detail;
   - dues: "{n} unpaid payments" (orange) or "Dues are all caught up" (green), detail "Track dues and mark payments as paid", linking to `/team/dues`;
   - when the roster is empty: "Invite your families" / "Share one link — parents add their own kids" → `/team/invite`.
3. **"Quick actions":** a 4-button grid: **Event** (`/events/new`), **Post** (announcement composer), **Invite** (`/team/invite`), **Dues** (`/team/dues`).

**Parent ("family") layout**
1. If the amount due > 0: an orange card "{$X} due" with detail "See what's due and who it's for" → `/team/dues`.
2. **"Coming up"** (add "· all your kids' teams" when guardian of 2+ teams): up to 8 upcoming events that aren't past. Each event is its own card:
   - an `EventSummaryRow`, showing the team name when there are 2+ teams;
   - **one RSVP row per child** in that team's `rsvpPlayers`, with the child's first name;
   - each row shows "Needs response" (orange) when unanswered, or "RSVP closed" with a lock when `!isRsvpOpen`;
   - below that, the 3-button **RSVPPicker**.
   - Tapping an RSVP updates optimistically, calls `setRSVP`, then refetches the RSVPs.
   - Empty: "No upcoming events in the next two weeks."
3. **"Latest announcement":** title, body (4 lines), relative time.

**Player layout**
1. **"Up next":** the next non-past, non-cancelled event, then an RSVP row labelled "Are you in?" for `player_self`.
2. A **Team chat** row → `/messages/{teamChatThreadId}`, with the subtitle "Coaches, parents, and players".
3. **Latest announcement.**

**All personas:** when a sponsor exists, show a sponsor card ("Team sponsor", name, tagline; opens `link_url` in a new tab). Footer: "Team sponsors support your team directly. ClubHQ never shows ads or tracks you."

### 6.5 Schedule (`/schedule`)
- **Upcoming | Past** segmented control. With 2+ teams, a "Show all my teams" toggle (default on).
- **Upcoming** = `events(teamIds, startOfToday)`. **Past** = `events(teamIds, startOfToday − 180 days, now)` filtered by `isPast`, newest day first.
- Group by local calendar day. The section header is `relativeDayLabel`. Rows are `EventSummaryRow`s (team name shown when multiple teams are visible).
- Head coach: a **+ New Event** button → `/events/new`.
- **Empty:** "No upcoming events" / "No past events", with "Tap + to schedule a practice or game." (head coach) or "Your coach hasn't scheduled anything yet."

### 6.6 Event detail (`/events/:id`)
Load with `api.eventDetail`. The team comes from context (`event.team_id`).

- **Header card:**
  - tags: event type (tinted), "Cancelled" (red), and the score (`scoreLine`, green if it starts with "W");
  - title (`eventDisplayTitle`) and the team name.
- **Details:**
  - date (full weekday, month, day, year) with `timeRangeLabel`;
  - location as a link to `mapsUrl` (new tab), with the address underneath;
  - notes.
- **"Your RSVP"** (when the user has `rsvpPlayers` and the event isn't cancelled):
  - one row per player, labelled "You" for `player_self`, otherwise the first name;
  - footer: "RSVPs close {cutoff, e.g. Oct 21, 2:00 PM}." or "RSVPs are closed. Message your coach if plans change."
- **"Availability"** (staff only):
  - an `RSVPSummaryBar`, then every roster player: jersey badge, full name, RSVP note in quotes (if any);
  - the trailing slot shows the attendance tag if taken, else the RSVP icon in its color, else "No reply".
- **Team chat** link row (same component as Home).
- **"Manage" menu** (head coach):
  - **Edit Event**;
  - **Enter Score** (games only);
  - **Take Attendance** / **Done Taking Attendance**;
  - **Cancel Event** (destructive; hidden if already cancelled).
- **Take Attendance:** the Availability section becomes "Attendance".
  - Each player gets a select of Present/Late/Absent/Excused, prefilled with `attendancePrefill`.
  - **Save Attendance** → `setAttendance` → exit the mode → reload.
- **Enter Score:** a dialog titled "Final Score" with two number steppers (0–300), one labelled with the team name and one with the opponent (or "Opponent").
  - Prefill from the existing score, from the team's perspective.
  - On save, convert back to home/away (if away: home = theirs, away = ours) → `setScore`.
- **Cancel Event:** a confirm dialog "Cancel this event?" with "Everyone on the team will be notified." Confirm → `cancelEvent` → reload.

### 6.7 Event editor (`/events/new`, `/events/:id/edit`)
Title: "New Event" or "Edit Event". Start from `newEventDraft` or `eventDraftFrom`.

- **Type:** a segmented control (Practice / Game / Event). For games, add "Opponent" and a Home/Away select.
- **Title:** placeholder "Title (optional)" for games, "Title (e.g. Practice)" otherwise.
- **"When":** Starts (`datetime-local`) and Ends (`datetime-local`, min = start).
  - Moving the start keeps the duration (`moveEventStart`).
  - New events only: a "Repeats weekly" stepper 0–26 with the label "Doesn't repeat" or "Repeats weekly · {n+1} events".
- **"Where":** "Venue (e.g. Rec-Plex North)" and "Address (for directions)".
- **"Notes":** a textarea, placeholder "What to bring, jersey color, arrival time…".
- **Add** / **Save**, disabled when `!isEventDraftValid`. Calls `saveEvent`, invalidates events, and navigates back.

### 6.8 Team hub (`/team`)
- **Header card:** a tinted square with the sport icon, the team name, "Sport · age group · season", and role tags (hide "Guardian" when the user has linked children). Add a "Pro" tag (purple, sparkles) when `is_pro`.
- **Links:**
  - **Announcements**;
  - **Dues & Payments** (head coach) or **Payments** (other staff or guardians);
  - **Season Report** (staff);
  - **Team Settings** (head coach).
- **"Roster · {count}":** each player shows a jersey badge, full name, position, and a "Your child" or "You" tag → `/team/players/:id`.
  - Empty, head coach: "Invite families with a link" / "Parents add their own kids — no typing rosters." → `/team/invite`.
  - Empty, others: "No players yet."
- **"People":** `teamMembers`, each with an initials avatar (tinted for staff) and `memberRoleSummary`.
- **"+" menu** (head coach): **Invite Families**, **Add Player**, **Post Announcement**.

### 6.9 Player profile (`/team/players/:id`)
- **Header:** an initials avatar (64 px, tinted), full name, "#{jersey} · {position}", and a "Has player login" tag (green) when `user_id` is set.
- **Visible to staff or this child's guardian:**
  - **"Details":** Age (from birthdate) and "Coach notes" (staff only). Hide the section when it's empty.
  - **"Emergency contacts":** name (or relationship), relationship, a `tel:` link with the phone, and a `mailto:` "Email". Empty: "None on file".
- **"Player account"** section, shown when (head coach OR this child's guardian) AND the player has no login:
  - no birthdate: a date input (default 14 years ago) and **Save birthdate** → `setPlayerBirthdate`;
  - age < 13: info text "{First} can have their own login at 13. Until then, you RSVP and follow the team for them.";
  - otherwise: **Create player login code** → `createPlayerInvite`. Then show the code large and monospace, with "{First} enters this code in ClubHQ under “I'm a player”. Expires {date}.", plus **Copy** and **Share** buttons (`navigator.share` with a clipboard fallback). Share text: "Your ClubHQ player code for {team}: {code}".
  - Footer: "For players 13 and older. Players see the schedule, RSVP for themselves, and use team chat — they can't send private messages."
- **Manage menu** (head coach): **Edit** → `/team/players/:id/edit`; **Remove from Roster** → confirm "Remove {first} from the roster?" with "Their history (attendance, payments) is kept." → `archivePlayer` → back to `/team`.

### 6.10 Player editor (`/team/players/new`, `/team/players/:id/edit`)
- **"Player" section:** First name, Last name, and Jersey number. Position: a select of `POSITIONS[sport]` plus "None", or free text for "other". A Birthdate toggle with a date input.
- **"Coach notes":** a textarea "Private notes". Footer: "Visible to team staff only."
- **Save**, enabled when the names are non-empty → `savePlayer`.

### 6.11 Invite families (`/team/invite`)
- **Content:** an icon, "Invite your families", and "Share your team code in your group text or email. Parents create an account, enter the code, and add their child — no roster typing."
- **Code card:** `createInvite` → "Team code" label, then the code large and monospace (`spacedTeamCode`).
- **Buttons:**
  - **Share Invite:** `navigator.share({ text: inviteShareText(team, token) })`, falling back to copying to the clipboard with the toast "Invite copied";
  - **Copy Link:** copies `https://app.teamclubhq.com/join/{token}`.
- Below: "Code works until {expires_at date}."

### 6.12 Announcements (`/team/announcements`)
- A list of title, body, and date/time. Empty: "No announcements yet".
- Head coach: **New** → composer dialog "Announcement" with Title, Message (textarea), and the footer "Everyone on the team gets this in their inbox." **Post** (enabled when both are filled) → `createAnnouncement`.

### 6.13 Messages (`/messages`)
- **Pinned "Team chat" row:** a tinted round icon, "Team chat", and "Coaches, parents, and players". Opens via `teamChatThreadId`.
- **"Threads":** the other threads (`!isTeamChat`). Each row shows:
  - an audience icon (`lock` for staff, `users-round` for parents, `users` for both);
  - `threadDisplayTitle`, a muted bell-off icon when muted, and the relative time of the last message;
  - "{author}: {last message}" (2 lines) and the audience label;
  - an unread dot.
- **Player-only accounts:** an info row with a shield icon: "Players can chat with the whole team. Coaches and parents can see team chat."
- **Staff:** **New Thread** → dialog with:
  - "Subject";
  - "Who can see this": `AUDIENCE_LABELS`, default "Parents & staff", with `AUDIENCE_HELP` as helper text;
  - "Message".
  - **Send** → `createThread` → navigate to the new thread.

### 6.14 Chat (`/messages/:threadId`)
- **Header:** thread title and a **Mute/Unmute** toggle (`setMute`). Read the initial mute state from `threads(team_id)`.
- **Messages:**
  - oldest at the top, auto-scrolled to the bottom; a day separator (`relativeDayLabel`) when the day changes;
  - mine: right-aligned, accent background, white text;
  - others: left-aligned, muted surface, with the author name above the first message of a run;
  - time under each bubble; deleted messages in italic "[deleted]".
- **Per-message menu** (long-press on touch, "⋯" button on hover):
  - **Copy**;
  - **Delete** (mine, or any when `can_moderate`) → `deleteMessage`;
  - **Report** (others' messages) → open `reportMessageMailto`;
  - **Block {name}** (others) → confirm "Block {name}?" with "You won't see their messages on this device. Report them so we can review it." and the buttons **Block** and **Block and Report**.
  - Blocked author ids live in localStorage `BLOCKED_AUTHORS_STORAGE_KEY`; hide their messages. Add **Unblock all members** in the header menu when any are blocked.
- **Composer:** an auto-growing textarea (1–5 lines), placeholder "Message", and a send button.
  - Enter sends; Shift+Enter adds a newline.
  - Optimistic bubble, then refetch. On error, restore the text and show it.
  - When `can_post` is false, replace the composer with "You can read this conversation but not reply."
- **Empty:** "No messages yet" / "Say hi to the team."
- **Polling:** `CHAT_POLL_MS` while visible.

### 6.15 Dues & payments (`/team/dues`, `/team/dues/:requestId`)
Load with `api.dues(team.id)`.

**Coach (head coach)**
- When `CARD_PAYMENTS_ENABLED` (currently **false**, so build it but keep it hidden):
  - a payments setup card: "Card payments are on" (green), or "Get paid by card" / "Finish setting up payouts" with **Set Up Payments** / **Continue Setup** → `connectPayments` → open the URL in the same tab;
  - footer: "Families pay 2.9% + $0.79 per checkout on top of the amount due; your team receives the full amount. You can also mark cash or Venmo payments as paid."
- **One card per request:** title, amount, a green progress bar (`duesProgress`), "{collected} of {expected} collected", and "Due {date}". Links to the detail page.
- **Empty:** "No payment requests" / "Create a request for season dues, tournament fees, or uniforms. Every family gets notified." with a **New Request** button.
- **New Request** dialog "New Payment Request":
  - "What's it for? (e.g. Fall season dues)", "Amount per player" (`parseCents`, decimal keypad), and "Details (optional)";
  - a "Due date" toggle (default on, +14 days, min today);
  - when the amount is valid, show "Family pays {amount + fee}" and "Your team receives {amount}", with the footer "Applies to every active player on the roster. You can waive individual players afterwards.";
  - **Send**, enabled when the title is set and the amount is ≥ 100 cents → `createDues`.
- **Request detail:**
  - description, "Per player", and "Collected";
  - for `is_pro` teams: **Remind {n} unpaid** → `remindUnpaid` → "Reminder sent to {n} families." For non-Pro teams, hide the button (no upsell);
  - **"Players":** each name with a status tag that opens a menu: **Mark Paid (cash/Venmo)**, **Waive**, **Mark Unpaid** → `setDuesStatus`. The menu is disabled while "processing".

**Family (guardian; also staff who aren't head coach see this view)**
- **"Due":** unpaid items, each selectable (checkbox circle), with the request title, child name, "Due {date}" or red "Past due", and the amount. All unpaid items start selected.
  - When card payments are off, the footer reads "Card payments aren't set up for this team yet — pay your coach directly for now."
- When `CARD_PAYMENTS_ENABLED` and `payments_enabled`:
  - a **Review & Pay** button opens a dialog listing each item, then "Subtotal", "Service fee (2.9% + $0.79 per checkout)", and a bold "Total";
  - footer: "You'll finish on a secure Stripe checkout page. Your team receives {subtotal}.";
  - **Pay {total}** → `checkout` → `window.location.href = url`.
- **"History":** settled items with status tags.
- **Empty:** "Nothing due" / "You're all paid up for {team}."

### 6.16 Season report (`/team/report`, staff)
- **"Season record":** big Wins (green), Losses (red), and Ties (gray), from the last 6 months of events (`seasonRecord`).
- For `is_pro` teams: **"Attendance · {n} events tracked"**, where n = the number of distinct `event_id`s in `teamAttendance`.
  - Rows from `attendanceSummaries`: name, rate percent (colored by `attendanceRateTone`), a progress bar, and "{p} present · {l} late · {a} absent · {e} excused".
  - Footer: "Late counts as attended. Excused absences don't count against the rate."
  - **Export** button → download `"{team} attendance.csv"` from `attendanceCsv`.
- Non-Pro teams: show only the record. No upsell.

### 6.17 Team settings (`/team/settings`, head coach)
- **"Team color":** for `is_pro` teams, 8 swatches from `TEAM_COLOR_PALETTE` (checkmark on the current one) and a "Use default color" option → `updateTeamColor` → reload context.
- Non-Pro: the text "Custom team colors are included with Coach Pro." No purchase button.

### 6.18 Notifications inbox (`/inbox`)
- Title "Notifications" and a **Mark All Read** button (disabled when nothing is unread) → `markRead(null)`.
- **Rows:**
  - a kind icon (`DESIGN.md`), accent-colored when unread;
  - the subject (bold when unread), the body (3 lines), and a relative time;
  - an unread dot.
- Tapping a row → `markRead(id)` → navigate to `routeForLinkPath(link_path)` if it maps, otherwise stay and refetch.
- **Empty:** "You're all caught up".

### 6.19 More (`/more`)
- **"Profile":** "Your name" (saves on blur or Enter → `updateProfile` → reload context) and the email (read-only).
- **"My teams":** each team with its sport icon, name, roles (`ROLE_LABELS`), and a checkmark on the selected one; clicking selects it. Then "Add or Join a Team" → the onboarding list.
- **"Plan"** (only when the user is a head coach somewhere or `is_coach_pro`):
  - "Coach Pro is active" (purple, sparkles), or "Current plan: Free";
  - footer when free: "Free plan: one team as head coach with unlimited players, scheduling, RSVPs, chat, and payments. No ads, ever.";
  - when Pro: "Manage Coach Pro in the ClubHQ iPhone app's Settings → Subscriptions."
- **"Get the app":** "Using an iPhone? Get ClubHQ for iPhone" → `APP_STORE_URL`. Also a note: "Tip: add ClubHQ to your home screen from your browser menu for one-tap access."
- **"Privacy & help":** Privacy Policy, Terms of Service, and Contact Support (`mailto:info@teamclubhq.com`). Footer: "ClubHQ has no ads and no third-party trackers. We never sell your family's data."
- **Sign Out** (confirm "Sign out of ClubHQ?").
- **Delete Account** (destructive confirm):
  - title "Delete your account?";
  - message: "This removes your login, your team memberships, and your links to players. Teams where you're the only head coach are archived. This can't be undone. Active App Store subscriptions must be cancelled on your iPhone.";
  - confirm → `deleteAccount` → `/welcome`.

## 7. Business rules
All of these are implemented in `src/lib/clubhq/rules.ts`. Use them.

| Rule | Function |
|---|---|
| Which screens and actions a user gets | `capabilities(team)` |
| RSVP closes 4 h before start unless `rsvp_cutoff_at` is set; cancelled events can't be RSVP'd (the server also enforces this, error `rsvp_locked`) | `effectiveRsvpCutoff`, `isRsvpOpen` |
| Past events | `isPast` |
| "vs Hawks" / "@ Hawks" | `eventDisplayTitle` |
| "W 54–48" from our perspective | `scoreLine`, `resultFromScore` |
| Event default title | `resolvedEventTitle` |
| RSVP counts (archived players excluded) | `rsvpCounts` |
| Attendance prefill & rate | `attendancePrefill`, `attendanceSummaries` |
| Team code parsing | `parseInviteToken` |
| Age gate & 13+ player accounts | `parseBirthYear`, `ageGateBlocks`, `ageFromBirthdate`, `canHaveOwnAccount` |
| Fees and money | `duesFeeCents`, `formatMoney`, `parseCents`, `duesProgress` |
| Free = 1 team as head coach, Pro = 3 | `canCreateAnotherTeam` (the server enforces this too) |
| Calendar days vs timestamps | `formatDateOnly`, `parseDateOnly` |
| Notification links | `routeForLinkPath` |

**Optimistic UI:** RSVP taps, chat sends, and dues status changes update immediately, then reconcile with the refetch. Roll back with a toast on error.

## 8. Errors, loading, empty states
- **Errors** are `ApiError` with `code` and a user-ready `message`. Show the message:
  - forms: inline in red;
  - one-off actions: a toast.
- Handle these codes specially:
  - `unauthorized` → sign out;
  - `upgrade_required` → the text in §6.3 (never a purchase button);
  - `rsvp_locked` → show the message and refetch.
- **Network failures on list screens:** a muted inline row "Couldn't refresh. Pull to try again." Keep the stale data visible.
- **Loading:** skeleton rows the first time; keep the existing content during refetches.
- **Buttons** that run async work show a spinner in place of the label, keep their size, and ignore double taps.
- Empty-state copy is listed per screen in §6.

## 9. Out of scope (don't build)
| Item | Why / what to do instead |
|---|---|
| Push / web push notifications, service workers | Not supported by the backend for web. The inbox (§6.18) plus the bell badge covers it |
| Sign in with Apple / Google | Not configured on the backend |
| Buying or managing Coach Pro | App Store only. Show status read-only |
| Demo mode | iPhone-only sales tool |
| Calendar subscription (ICS) | No server endpoint exists yet. Don't add a "Subscribe" button |
| Editing or deleting announcements, editing messages | Not in the iPhone app either |
| Direct/group messages between members | Not in v1 (server-side rules exist but no UI) |
| Admin/club dashboards, roster import, photos, signups | Future roadmap |
| Changing email, password strength meters, 2FA | Not in v1 |
| i18n | English (US) only for now; keep strings in components |

## 10. Milestones
Build in this order. Finish each one completely (including empty/error states) before starting the next. **Don't stop between milestones to ask for confirmation.**

1. **Foundation:** `api.ts`/`rules.ts`/`types.ts` in place, theme & design tokens (`DESIGN.md`), manifest & icons, app shell (tabs/sidebar, top bar, team switcher), auth context, route guards, React Query setup.
2. **Accounts:** §6.1 (welcome, verify, forgot, new password).
3. **Onboarding:** §6.2 and §6.3 (invite landing, parent join, coach create, player code).
4. **Home + Schedule + Event detail:** §6.4, §6.5, §6.6 (with RSVP).
5. **Coach scheduling:** §6.7 and the coach parts of §6.6 (attendance, score, cancel).
6. **Team:** §6.8–§6.12 and §6.17.
7. **Messages:** §6.13 and §6.14.
8. **Money & reports:** §6.15 and §6.16.
9. **Inbox & More:** §6.18 and §6.19.
10. **Polish:** walk `ACCEPTANCE.md` top to bottom and fix every failure; check 360 px, desktop, and dark mode.

## Resolving questions
When something isn't specified, decide in this order. **Don't ask the owner.**

1. **This spec and `API.md` / `DESIGN.md`.**
2. **The iPhone app's source** in `docs/clubhq/ios-reference/`. It is the behavioral reference: find the matching SwiftUI view and do what it does. Swift `Features/X/XView.swift` maps to §6.
3. **The server source** in `docs/clubhq/server-reference/mobile-api.ts.txt`. It shows exact validation, permissions, and error messages for every action.
4. **The App Store screenshots** in `docs/clubhq/screenshots/`, for look and density.
5. **Still unclear?** Choose the simplest option consistent with the above, implement it, and append one line to `docs/clubhq/ASSUMPTIONS.md` ("- §6.x: assumed … because …"). Keep going.
