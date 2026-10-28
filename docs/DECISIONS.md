# ClubHQ — Decision Log

Every non-trivial "how" decision is recorded here **before** it is acted on.
Format: context → decision → why → consequences / revisit trigger.
Open questions that need the owner live in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
Research backing these decisions: [`research/COMPETITIVE_ANALYSIS.md`](research/COMPETITIVE_ANALYSIS.md).

Status values: **Accepted** (in effect), **Provisional** (in effect, needs owner confirmation), **Superseded**.

---

## D-041 — Internal admin portal before public launch (owner-approved 2026-10-24) — Accepted
- **Context:** The owner needs analytics, insights and customer management. Today there is only Supabase Studio, reports arrive by email, blocks live on one phone, and nothing records activity.
- **Decision:** A web portal at teamclubhq.com/adminportal (`site/adminportal/`) for the owner and future support staff, gated by a new `platform_admins` table, an emailed sign-in code and required TOTP MFA (AAL2, checked in SQL and in `admin-api`). Reads are `admin_*` SQL functions under the admin's JWT; writes go through the audited `admin-api` Edge Function. Admins see chat content **only** as report snapshots, so the in-app `super_admin` role (which reads every thread) is not used. Pro becomes "App Store subscription **or** an admin grant" (`pro_grants`). Usage analytics are first-party (`usage_events`, `user_activity_days`). The public launch waits for Phase 1. Full plan: [`ADMIN_PORTAL.md`](ADMIN_PORTAL.md).
- **Why:** At 100 teams the owner can know every customer personally, so per-team views and support tools matter more than aggregate analytics. A portal outside the App Store binary keeps admin code away from customers and App Review. First-party analytics keep the privacy story simple for a youth-sports app.
- **Consequences:** The App Store privacy label gains Product Interaction (OQ-19). Broadcast and warning pushes need the APNs key (OQ-04). Club billing outside IAP needs a guideline check (OQ-18). The club director portal reuses this data model (roadmap #10).

## D-040 — Rebrand to the HQ-arrow identity in 1.0.1 (owner-approved 2026-10-23) — Accepted
- **Context:** The owner replaced the alpha "Home Court" look (D-023) with a designed brand kit, `Marketing/Claude Code Brand Kit/`. 1.0 (build 17) is in App Review, so the rebrand ships as **1.0.1** on branch `rebrand-1.0.1`.
- **Decision:** New icon, mark, wordmark and palette (navy `#0B1E3A`, cyan `#00C2FF`, orange `#FF8A00`). AccentColor `#0077C2` / dark `#007CBF`, so white text on the accent (own chat bubbles, prominent buttons) stays ≥ 4.5:1. Brand kit: tokens in `docs/brand/clubhq-tokens.json`.
  - The app icon, `Colors/` and `Logos/` are merged into the existing `Assets.xcassets`. `BrandTheme.swift` adds `Color.Brand`, `Image.Brand` and `BrandCTAButtonStyle`.
  - `BrandMark` now shows the mark on a navy tile. The sign-in header uses the lockup.
  - The orange CTA style is used only for the one primary action on the sign-in and onboarding forms. It dims when disabled. The welcome tour button keeps the team's own color.
  - Unchanged: team tints, the RSVP/attendance/dues semantic colors, and system grouped backgrounds.
- **Consequences:** Marketing screenshots and the kit's social/App Store art must be regenerated from the rebranded build. The first `TeamView` swatch (`#2457F5`, the old brand blue) waits on the owner.

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

## D-039 — Apple Intelligence: on-device helpers with a human in the loop (2026-10-23) — Accepted
- **Context:** The owner asked for an Apple Intelligence roadmap. The app deploys to iOS 26, which has the on-device `SystemLanguageModel` (4K context, works offline, no usage limits). iOS 27 adds `PrivateCloudComputeLanguageModel` (32K context, network required, daily cap), image input, and the Evaluations framework, so those sit behind `#available(iOS 27.0, *)`. The app had no App Intents yet.
- **Decision:** Follow the phased track in [`ROADMAP.md`](ROADMAP.md#apple-intelligence-track) under these rules:
  - **Optional, never required.** Every AI entry point checks `IntelligenceStatus` and hides itself, or explains how to turn Apple Intelligence on. The manual path always remains.
  - **A human approves.** The model drafts; a person reviews, then saves or sends. No automatic saves, posts or moderation.
  - **Minors' content stays on the device.** Anything that reads chat (where players may post) uses the on-device model only, never PCC. No AI features in player-facing screens. This keeps the two-adult rule (D-009) and the COPPA position simple.
  - **Apple models only.** No third-party LLM: it would cost money per use and reopen privacy questions. PCC is allowed for long, non-chat documents (tournament PDFs), with an on-device retry when it fails.
  - **Structured output** through `@Generable` types, not JSON parsing. Prompt changes are scored against the evaluation fixtures before shipping.
  - **Pricing follows the strategy rule.** Parent-facing helpers are free; coach time-savers can be Coach Pro.
- **Consequences:** No App Privacy change is expected (on-device and PCC processing isn't collection by ClubHQ); re-check when Phase 1 ships. App Intents entity IDs are the server UUIDs, so saved shortcuts survive reinstalls and devices.

## D-038 — Connection hiccups: one safe retry, honest error text (2026-10-23) — Accepted
- **Report:** the owner tested the GroupMe → ClubHQ family flow on TestFlight 13 (head coach joining his own team as a parent). Tapping **Join** showed "You appear to be offline."
- **What the logs show:**
  - The invite lookup succeeded at 16:28:18 UTC, and every `mobile-api` call from the phone returned 200.
  - The `claim-invite` request never reached Supabase: nothing in the gateway or function logs, no token refresh, no new player.
  - So the failure was on the phone's connection, and the app's own code did not cancel the request.
  - A simulator test (POSTs after 20, 65 and 125 s idle) did not reproduce a stale-connection failure, so the exact cause on the phone is unconfirmed.
- **Problems found in the app:**
  - Any transport error was shown as "offline", hiding which error it was.
  - iOS re-sends only idempotent requests (GETs) after a dropped connection, so a POST like Join failed on the first hiccup.
- **Decision:**
  - **One retry:** `SupabaseClient` retries once, 0.8 s later, for errors where the request most likely never arrived: connection lost, not connected, cannot connect, cannot find host, DNS failure. Timeouts are not retried, because the server may have acted.
  - **Error text:** "offline" only when iOS reports no internet; otherwise "Couldn't reach ClubHQ… (Error <URLError code>)", so the next report says exactly what failed.
  - **Join is safe to repeat:** `claim-invite` treats a same-named child the caller already guards as the same join and returns it, instead of a duplicate warning or a second child. Another family's same-named child still gets the warning.
- **Verified:**
  - **Live check:** `supabase/tests/d038_live_check.mjs` 7/7 (the owner's head-coach-as-parent case, a repeated Join, no duplicate child, other families still warned).
  - **Simulated failures:** a stubbed URLProtocol showed one dropped connection recovering, a second failure reporting -1005, offline text only for real offline, and no retry on timeout.

## D-037 — Weekly repeats keep their local time across Daylight Saving (2026-10-23) — Accepted
- **Problem (found while testing D-036):** `save-event` made weekly repeats by adding exactly 7×24 hours in UTC. A 6:00 PM Central practice became 5:00 PM after Daylight Saving ended (Nov 1, 2026), and in spring it would become 7:00 PM. Notifications also printed times in UTC ("Sun, 25 Oct 2026 23:00 UTC").
- **Decision:**
  - **Time zone source:** the app sends the phone's IANA time zone (`time_zone`, e.g. `America/Chicago`) with `save-event` and `cancel-event`.
  - **Repeats:** the server adds whole days on the local wall clock in that zone (`_shared/time.ts`), keeping the same duration, so every week starts at the same local time.
  - **Remembered per team:** the zone is stored on the team (`teams.time_zone`, set whenever a head coach saves with a valid zone). Older builds that don't send one (1.0 in review, TestFlight 12) use the team's zone, and fall back to the old fixed-7-day behavior only for teams that have never saved from a new build.
  - **Notifications:** event times in notifications use the same zone ("Sun, Oct 25, 6:00 PM").
- **Why on the server:** the server already makes the repeats, and other clients get the fix without duplicating the logic. Zones are validated with `Intl.DateTimeFormat`, and unknown zones are ignored rather than rejected.
- **Existing events aren't rewritten:** nothing marks which rows belong to one series, so a coach whose repeats already shifted edits or recreates them. On 2026-10-23 no production event was affected: the two real teams' future events were all entered individually and sit at normal local times.
- **Verified 2026-10-23:**
  - **Deployment:** migration `20261023150000_team_time_zone` and `mobile-api`.
  - **Unit tests:** `supabase/tests/time_test.ts` 8/8, covering the Chicago fall and spring changes, Auckland, Kolkata, a skipped spring hour, the no-zone fallback, and formatting.
  - **Live check:** `supabase/tests/d037_live_check.mjs` 8/8. Repeats stay at 6:00 PM across Nov 1; the zone is remembered and then used for a request without one; an unknown zone is ignored; notifications and cancel notices read "Sun, Oct 25, 6:00 PM"; a team with no zone keeps the old step.
  - **ICU spacing:** production's ICU puts U+202F before "PM" (local Deno doesn't), so formatted times are normalized to plain spaces.
  - **D-036 live check:** still 49/49.

## D-036 — Moving a team off GroupMe: guide, chat photos, calendar feed, season-long team code (2026-10-23) — Accepted
- **Context:** The owner coaches a 6th-grade boys' basketball team that runs on GroupMe and wants a clean move to ClubHQ. Planning found four gaps that would keep GroupMe alive or make the move fail: coaches have no script for the move; chat has no photos (GroupMe's main use); there's no way to put the schedule in a phone calendar; and the team code expires after 30 days, so a link pinned in GroupMe stops working mid-season.
- **Coach guide ("Move from GroupMe"):** Team → + and the Invite Families sheet open a four-step guide: announce, remind, switch day, wrap up. Each step has a ready message (team name, invite link, code and the switch date filled in) with Copy and Share, plus a checkmark the coach taps. Tips cover the duplicate-child trap (one parent joins first, then sends a co-parent invite), inviting in person at pickup, and answering GroupMe questions with a pointer only. The switch date and checkmarks are stored per team on the device (`UserDefaults`, like the setup checklist). The guide makes no claims about GroupMe menus beyond what Microsoft documents: only the group's owner or admins can rename it, and ending a group deletes it permanently ([support](https://support.microsoft.com/en-us/groupme/manage-group-settings-in-groupme)).
- **Chat photos:**
  - **Storage:** a new private bucket `chat-photos` (JPEG only, 10 MB cap), with no `storage.objects` policies. Only the service role touches it, so every rule lives in `mobile-api` (D-005).
  - **Upload:** `create-photo-upload` checks the caller can post in the thread (the same two-adult rule as text, D-009) and returns a signed upload URL for `<team>/<thread>/<user>/<random>.jpg`. The app `PUT`s the bytes there, the contract `uploadToSignedUrl` uses in storage-js 2.118.
  - **Posting:** `post-message` accepts an `image_path`, but only one under the caller's own folder for that thread that actually exists in the bucket.
  - **Display:** `list-messages` returns 1-hour signed URLs, and the app caches the downloaded image by message ID, because the 5-second poll gets fresh URLs each time.
  - **Privacy:** before upload, the app downsizes to 1,600 px on the long edge and re-encodes through ImageIO with no metadata, so GPS and EXIF never leave the phone. Deleting a photo message also deletes the file. One limit, seen in testing: a signed URL someone already received can still be served from Supabase's CDN cache until it expires (at most 1 hour), even though the file is gone from the bucket and no new URL is ever issued.
  - **Forged paths:** clients can also write `messages` through PostgREST, so a trigger (`private.check_message_image_path`) makes the database refuse any `image_path` outside `<thread's team>/<thread>/<author>/`, and refuses any change to it after posting.
  - **Schema:** `messages` gains `image_path`, `image_width` and `image_height`. The body check now allows an empty body when there's a photo. This only relaxes the constraint, so old clients are unaffected (D-003).
- **Calendar feed:**
  - **Feed:** every user gets one secret, revocable feed URL (`calendar_feeds`, service-role only). A new `calendar-feed` Edge Function (`verify_jwt = false`, because calendar apps send no auth) serves an RFC 5545 calendar of every team the user belongs to, from 60 days back onward. Cancelled events stay in the feed, marked `STATUS:CANCELLED`, so calendars remove them instead of keeping stale copies. The feed has no player names, RSVPs or contacts.
  - **App:** Schedule → Calendar sync. "Subscribe in Calendar" opens the `webcal://` form, which iOS turns into a subscribe prompt. Apple's iPhone guide says you can subscribe to an .ics calendar by tapping a link to it. "Copy Link" covers Google Calendar, which can only subscribe by URL from a computer browser ([Google](https://support.google.com/calendar/answer/37100)). "Reset Link" rotates the token, and the old URL returns 404.
  - **Why not the existing `calendar_tokens` table:** it came from the retired web app, has 0 rows, and is per team (one subscription per team, and the token is readable through RLS). A family with kids on two teams should subscribe once, so the new table is per user. The old table is left untouched.
  - **Refresh:** each calendar app decides how often it refreshes. We send `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` of 1 hour as a hint only, and the copy promises nothing more. Push and the inbox remain the real-time path.
- **Team code lasts the season:** team codes (not co-parent invites) now last 365 days, and opening Invite Families pushes the date out again. A one-time migration extends codes already live. Because a long-lived code is shared in group chats, the head coach gets "Reset Code" (`reset-invite`): old links stop working, and families who already joined aren't affected.
- **Privacy disclosures:** `PrivacyInfo.xcprivacy` adds Photos or Videos (linked, App Functionality, no tracking). `NSPhotoLibraryAddUsageDescription` is added because the photo viewer's share sheet offers Save Image. The privacy policy (teamclubhq.com/privacy, deployed 2026-10-23) describes chat photos and the calendar link. App Privacy in App Store Connect isn't settable by API (D-032); the owner added and published **Photos or Videos** (linked, App Functionality, no tracking) on 2026-10-23.
- **Deployed 2026-10-23:** migration `20261023140000_chat_photos_calendar_feeds` (recorded in `schema_migrations`), `mobile-api` v8, and `calendar-feed` v1 (`verify_jwt = false`). The two team codes already live were extended to 2027-10-23. Verified live by `supabase/tests/d036_live_check.mjs` with throwaway accounts and a throwaway team: **41/41 passing**, then everything was deleted. The checks cover:
  - **Team code:** lasts a year; reset works and the old code dies.
  - **Calendar feed:** works with no auth headers and is `text/calendar`; cancelled events, escaping, CRLF and 75-octet folding are correct; no child names; an outsider's feed is empty; a reset URL returns 404.
  - **Photos:** signed upload works; a photo can't be posted before upload, and the bucket refuses non-JPEGs; outsiders are refused, and so is someone else's path; a forged PostgREST insert is blocked by the trigger; delete removes the file.
  - **On device:** a RunCodeSnippet run confirmed `ChatPhoto.make` strips GPS, TIFF and EXIF details and applies orientation (3000×2000 rotated → 1067×1600).
- **Hands-on testing round (2026-10-23):** `supabase/tests/qa_fixture.mjs` builds a throwaway production team ("QA Mavericks 6th": coach, parent, child, events, one cancelled) and tears it down again.
  - **Swift client vs production (RunCodeSnippet):** invites, reset, calendar feed and rotation, a 12 MP HEIC encoded to 1600×1200 in 0.28 s, photo post with and without caption, the coach downloading the photo, incremental polls, and coach moderation delete.
  - **Simulator, signed in to production as parent, then coach:** sign-in; picker → attach → caption → send (optimistic bubble, then the server copy); full-screen viewer, Share → Save Image (iOS showed our usage string, no crash); long-press delete (file removed from storage). Calendar Sync → Subscribe opened Apple Calendar's subscribe screen with our feed, and it listed the events with local times and locations. Then the GroupMe guide (Copy → clipboard and checkmark, both persisting across relaunch; Share sheet), Reset Code (old code revoked in the database), and the guide link from the invite sheet. The file uploaded from the simulator photo library had no GPS, camera model, or date in its metadata.
  - **Bugs found and fixed:**
    1. **No photo appeared in the real app.** `JSONCoding` uses `convertFromSnakeCase`, so `image_url` maps to `imageUrl`; the property was `imageURL`, so it silently decoded as nil. Renamed to `imageUrl` to match `logoUrl`/`linkUrl`.
    2. **Feed caching kept a reset link alive.** The feed's `Cache-Control: max-age=300` let URLSession (and potentially calendar apps) keep serving a reset link for 5 minutes; it's now `private, no-cache`.
    3. **Cancelled events were labeled twice.** Apple Calendar labels `STATUS:CANCELLED` events "CANCELED:" itself, so our "Cancelled:" prefix doubled it; the prefix is dropped.
    4. **Guide step text was cut off.** Step 4 was truncated in the List; fixed with `fixedSize(horizontal: false, vertical: true)`.
    5. **Guide boxes vanished in dark mode.** The message box was invisible in dark mode; it now uses `tertiarySystemGroupedBackground`.
    6. **Photo viewer controls were hard to read.** Its title and controls rendered light-on-black; the viewer now forces dark mode.
  - **Live check:** now 49/49, adding a 13+ player login, player photo posts, and parents-only/staff-only thread restrictions.
- **Found, not fixed (pre-existing):** `save-event` repeats weekly events in fixed 7×24-hour UTC steps, so a 6:00 PM practice becomes 5:00 PM after Daylight Saving ends (seen on Nov 1, 2026 in both the app and Apple Calendar). The fix needs the coach's time zone. Tracked as a follow-up.
- **Old app builds:** they keep working. They ignore the new message fields, and text posting is unchanged. A photo-only message shows in old builds as an empty bubble until they update.

## D-035 — Co-parents share one child; coaches hear when families join (2026-10-23) — Accepted
- **Problem:** both parents using the team code created two "Jordan Smith" players, splitting RSVPs, dues, and attendance. Coaches also had no signal that families were joining.
- **Co-parent invites:** a guardian of the child, or the head coach, creates one from the child's profile (Invite Co-Parent). It's a `team_invites` row with the new nullable `player_id`; claiming it links the second guardian to the existing player instead of creating one. `create-invite` never reuses these as the team code.
- **Why not match by name:** the team code is shared in group texts, so linking to an existing child by name would let any family on the team attach themselves to someone else's minor. The link only comes from someone already trusted with that child.
- **Safety net:** `claim-invite` on the team code returns `possible_duplicate` (409) when an active player with the same first and last name exists. The app explains co-parent invites and offers "Add as a Different Child", which re-sends with `allow_duplicate`.
- **Coach notification:** each claim fans out a `family_joined` notification (inbox + push) to staff, linking to the Team tab.
- **Deployed 2026-10-23:** both migrations (recorded in `supabase_migrations.schema_migrations`) and `mobile-api` v7. Verified live with throwaway QA accounts and team (21/21 checks: duplicate warning, co-parent create/reuse/claim, permissions, team code never returns a co-parent invite, coach-only `family_joined` notices), then deleted.
- **Compatibility:** additive migrations only (D-003). Old app builds ignore `player` in `lookup-invite`, and NotificationKind already decodes unknown kinds. There is no web client today (the Lovable project was deleted); any future client gets this behavior from `mobile-api`, which never returns a co-parent invite as the team code.

## D-034 — Making Coach Pro purchasable (2026-10-22) — Accepted
**Owner's goal:** a coach can subscribe to Coach Pro. The owner delegated the "how."

**What was wrong (diagnosed 2026-10-22):**
1. **Apple won't sell the products yet.** Both subscriptions are `MISSING_METADATA` in App Store Connect, yet every product-level field is complete. Verified via API: en-US localization, the group localization ("Coach Pro"), US price ($9.99 / $69.99), US availability, a 2-week free-trial intro offer, and App Review screenshots that finished processing. Apple's forums and setup guides name two causes for this state: a missing group localization (not the case here) and the account-level **Paid Apps Agreement, banking, and tax**. Only the Account Holder can complete those in App Store Connect → Business; the API can't. StoreKit returns no products, even in TestFlight sandbox, until they're active.
2. **The server couldn't verify any purchase.** `sync-subscription` called the App Store Server API with `APPSTORE_*` secrets that were never set (Supabase secrets list has none). That API needs an *In-App Purchase* key, which is a separate, web-only key type.
3. **Apple had nowhere to send renewals and refunds.** The App Store Server Notifications URL was unset.
4. **The app hard-disabled every upgrade path** (`coachProPurchasesEnabled = false`). The paywall also hard-coded "$9.99/month or $69.99/year · 14-day free trial" and listed "Priority support", which we don't offer.

**Decisions:**
- **Verify Apple's signatures ourselves (no In-App Purchase key needed).** `_shared/appstore.ts` verifies every signed transaction, renewal record, and notification the way Apple's App Store Server Library `SignedDataVerifier` does:
  - The x5c chain must end in the **pinned Apple Root CA – G3**. It was downloaded from apple.com, and its SHA-256 `63:34:3A:BF:…:3E:91:79` matches Apple's published root list.
  - The intermediate must carry OID `1.2.840.113635.100.6.2.1` and the leaf `1.2.840.113635.100.6.11.1`.
  - Each certificate must be valid at the payload's `signedDate`, and the ES256 signature must verify with the leaf key.
  - The payload must name bundle `com.teamclubhq.app`, and in Production, App Apple ID 6822555956.

  Status comes from the verified fields: revoked → active → grace period → billing retry → expired. Older out-of-order updates can't overwrite a newer renewal. If an In-App Purchase key is ever added (`APPSTORE_KEY_ID` / `APPSTORE_ISSUER_ID` / `APPSTORE_PRIVATE_KEY`), the server also re-fetches the latest status from Apple. Tests: `supabase/tests/appstore_verify_test.ts` (8 passing) uses a locally generated chain shaped like Apple's, and covers a tampered payload, a look-alike root, a missing OID, an expired leaf, and garbage input (400). The live endpoints reject a non-Apple chain with 403 "Not signed by Apple."
- **App Store Server Notifications V2** are set for Production and Sandbox to `…/functions/v1/appstore-notifications`, configured via API and read back. This covers renewals, expirations, billing problems, and refunds.
- **Pro appears only when Apple actually sells it.** `coachProPurchasesEnabled` is now a kill switch (on). Upgrade prompts require `SubscriptionStore.productsAvailable` (StoreKit returned the products, rechecked whenever the app comes to the foreground), and they never appear in demo mode, which has no account to attach a subscription to. So the same build is safe today (no prompts, identical to 1.0 behavior; verified in the simulator) and lights up automatically once Apple starts selling. The app also re-sends its current entitlement to the server after sign-in and on launch.
- **Paywall copy:** removed the hard-coded price/trial line (StoreKit shows localized prices and shows the trial only to eligible people; guideline 3.1.2) and "Priority support" (not a real benefit).
- **Terms and Support** (teamclubhq.com) describe Coach Pro: optional, sold through Apple, price, auto-renewal, how to cancel, refunds through Apple. The paywall links Terms of Use and Privacy and shows Restore Purchases.
- **Release plan:** leave 1.0 (build 9, no purchases) in review so its queue position isn't lost again. *(2026-10-23: owner chose to swap in build 15, then build 17, which resubmitted 1.0, still without purchases. 2026-10-25: the never-released version was renamed **1.0.1** and resubmitted with build 18, the rebrand, still without purchases, so Coach Pro moves to the next version.)* Subscriptions must be submitted together with an app version the first time, so Coach Pro ships in the release after the first one (originally planned as 1.0.1): once the agreement is active and the subscriptions read `READY_TO_SUBMIT`, run `node scripts/asc/swap-review-build.mjs <build> --with-coach-pro`. It submits both subscriptions and adds the staged Coach Pro paragraph and review notes (`metadata.json`). The listing must not mention Pro before then (2.3.1).
- **Local testing:** `StoreKit/ClubHQ.storekit` plus the shared scheme give Xcode runs a local store with the same products. In this session Xcode didn't pick up the newly added scheme setting, so the purchase sheet wasn't exercised locally. The end-to-end check is a TestFlight sandbox purchase (free) after the agreement is active.

**Owner action required:** App Store Connect → **Business** → accept the **Paid Apps Agreement** and complete **banking** and **tax** (plus any updated Program License Agreement shown there).

## D-033 — Venmo & Cash App buttons for dues (owner-selected 2026-10-22) — Accepted
- **Context:** Card payments through Stripe Connect (D-010) aren't on yet, and many teams already collect by Venmo or Cash App. The owner chose "Option C": coaches add their handles and families get one-tap pay buttons.
- **Decision:** Two nullable columns on `teams`: `venmo_username` and `cashapp_cashtag`. They're stored bare (no @ or $) and set by the head coach through `update-team` (Team Settings → Payments, or Dues & Payments → How families pay you). Free on every plan. Pasted links are normalized on the device and the server (`PaymentHandles` / `paymentHandle()`); the rules are Venmo 5–30 `[A-Za-z0-9_-]` and Cash App 1–20 letters/digits with at least one letter.
- Families see "Pay $X with Venmo" (`https://venmo.com/<user>?txn=pay&amount=&note=`, amount + note "<team>: <request> – <player>") and "Pay $X with Cash App" (`https://cash.app/$<tag>/<amount>`, amount only; the Cash App link has no note parameter). Both are universal links: they open the app if installed, the website otherwise.
- **Limits:** Neither service has an API that confirms receipt, so the coach still taps **Mark Paid**. ClubHQ earns nothing on these payments, and the money goes to the coach's personal account. App Store: paying for real-world services outside IAP is allowed (3.1.3(e)).
- **Later:** a parent "I sent it" button that flags the item for the coach to confirm.

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

## D-023 — App icon: "Home Court" (owner-selected 2026-10-13) — Superseded by D-040
- Five concepts in `design/app-icon/` (contact sheet: `ClubHQ-icon-concepts.png`). The owner chose **A · Home Court**: a white house with a center-court circle on a blue gradient. It reads as "HQ / home base", is sport-neutral, and is distinct from TeamSnap's orange.
- Drawn entirely from custom vector paths. The SF Symbols license forbids symbols in app icons.
- Installed as `AppIcon.appiconset` with light, dark, and tinted variants. Layered SVGs are in `design/app-icon/A-home-court/layers/` for an Icon Composer `.icon` file later (Liquid Glass specular/refraction tuning).
- The in-app `BrandMark` draws the same artwork natively. The app accent color was the icon blue (`#2457F5`, dark `#5B8CFF`); since D-040 it is `#0077C2` / dark `#007CBF`.

## D-020 — Notification sends: read-state updates go through `mobile-api` — Accepted
- **Context:** The web migration history drops the recipient UPDATE policy on `notification_sends`.
- **Decision:** iOS marks inbox items read through `mobile-api` (service role, scoped to `recipient_user_id = caller`), not by re-adding an UPDATE policy.
