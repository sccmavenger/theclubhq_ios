# ClubHQ — App Store Connect & TestFlight

**Account:** Apple Developer, *individual* team "Danny Guillory" (`CB4AAVWWUD`).
**Bundle ID:** `com.teamclubhq.app` (registered with Push Notifications).
**Builds:** archived and uploaded by Claude from Xcode with automatic signing.

> Individual accounts show your personal name as the App Store seller. To show
> "ClubHQ" / a company name instead, enroll an organization (needs a D-U-N-S number) and
> transfer the app later. Not needed for TestFlight.

## 1. Create the app record (owner, about 2 minutes)
App Store Connect → **Apps** → **+** → **New App**:

| Field | Value |
|---|---|
| Platforms | **iOS** |
| Name | **ClubHQ Team** ("ClubHQ" was taken). Created 2026-10-13, Apple ID 6822555956 |
| Primary Language | English (U.S.) |
| Bundle ID | **com.teamclubhq.app** (listed as "XC com teamclubhq app") |
| SKU | **com.teamclubhq.app** |
| User Access | Full Access |

## 2. Upload a build (Claude)
`xcodebuild -exportArchive … -exportOptionsPlist build/ExportOptions.plist` uploads the archive. Build numbers are managed automatically. Processing takes about 5–30 minutes.

## 3. TestFlight
**Internal testing** (you plus anyone added under Users and Access, up to 100 people, no review): TestFlight → Internal Testing → **+** group "ClubHQ Team" → add yourself → enable automatic distribution. Install the **TestFlight** app on your iPhone and accept the invite.

**External testing** (anyone by email or public link, up to 10,000; the first build needs Beta App Review, usually under 24 h). TestFlight → External Testing → **+** group "Beta Families", then fill in **Test Information**:

| Field | Value |
|---|---|
| Beta App Description | ClubHQ is an ad-free team app for youth sports. Coaches create a team and share a team code; parents join with the code and add their kids; players 13+ get their own login from a parent or coach. Try: create an account (you'll get a 6-digit email code), then create a team or join one. |
| Feedback Email | an inbox you actually read (teamclubhq.com has no mailbox yet, OQ-16) |
| Privacy Policy URL | https://teamclubhq.com/privacy (deploy `site/` first, see site/README.md) |
| Sign-in required | **Yes** — User: `coach@teamclubhq.com` · Password: `ClubHQ-Coach-2026!` |
| Review notes | Sign in with the account above to see a team with a practice, roster, and chat. New accounts verify email with a 6-digit code sent from info@teamclubhq.com. Payments (Stripe) and Coach Pro purchases are not enabled in this beta. |

Then **Enable Public Link** and share it.

## 4. Before App Store release (later)
- **App Privacy** (matches `ClubHQ/PrivacyInfo.xcprivacy`): Data Linked to You → Name, Email Address, Phone Number, User ID, **Photos or Videos** (chat photos, D-036), Other User Content, Purchase History — all for **App Functionality**; plus **Product Interaction** for **Analytics** (first-party usage events, D-041; owner must add it in ASC before the build that sends them ships, OQ-19). **No tracking.** App Privacy can't be edited through the API (owner edits it in App Store Connect); Photos or Videos was added and published by the owner on 2026-10-23.
- **Age rating:** answer the questionnaire honestly (user-generated content/chat → expect **13+**). Not in the Kids category.
- **Category:** Sports. **Copyright:** © 2026 Danny Guillory.
- **Screenshots:** 6.9" iPhone and 13" iPad.
- **In-App Purchases:** create subscription group "Coach Pro" with `com.teamclubhq.pro.monthly` ($9.99) and `com.teamclubhq.pro.yearly` ($69.99), 2-week free trial.
- **Paid Apps agreement**, banking, and tax: required before subscriptions can be sold.

## 5. Submission status (2026-10-14)
Ready in App Store Connect for version 1.0: build **4** attached (iPhone-only), 6 screenshots
(`design/app-store-screenshots/`, 1206 × 2622), description, keywords, URLs, review notes,
age rating 13+, Sports category, App Privacy published, free, US-only availability, manual release.
Mac and Vision Pro availability are off.

1.0 ships **without purchases**: `AppConfig.coachProPurchasesEnabled` and
`AppConfig.cardPaymentsEnabled` are `false`, which hides the Coach Pro paywall and the Stripe setup.
Turn them on in a later version once the Paid Apps Agreement is signed, the subscriptions are approved
(they must be submitted together with an app version), and Stripe is live.

**2026-10-20: submitted for review** (build 7, review submission `61685382-e8c1-4528-9a56-6bc9bdcae07e`,
manual release). Done through the App Store Connect API using the key in `~/GitHub/the-hub-ios/.secrets/`
and `~/GitHub/the-hub-ios/scripts/asc.py` (version 1.0 id `0588d610-4e32-4a8a-b5fe-431122f3c402`).

**2026-10-22: resubmitted with build 8** (adds Venmo & Cash App pay buttons, D-033). The owner asked
to ship build 8 instead, so the build 7 submission was canceled and a new one was submitted. Release is
now **automatic after approval** (`releaseType = AFTER_APPROVAL`). The review notes' PAYMENTS paragraph
explains the external Venmo/Cash App links (3.1.3(e)). Scripts: `scripts/asc/`.

**2026-10-22 (evening): resubmitted with build 9** after a pre-review audit. Changes: Coach Pro
leftovers hidden while purchases are off (plan section, empty Team color section, Season Report
link, second-team error text); visible "Report a Concern" in chat and Report on announcements
(1.2); "coming soon" and a placeholder demo link removed; the reviewer team ("ClubHQ Test Team")
seeded with upcoming events, a 10-player roster, chat, announcements, and dues; Terms, Privacy,
and Support pages updated to match 1.0 and deployed to Cloudflare Pages (`scripts/deploy-site.sh`). Release stays automatic after approval. Swap a build into review with
`node scripts/asc/swap-review-build.mjs <build>`. If xcodebuild export fails with "Failed to
Use Accounts", pass `-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`
with the ASC key.

**2026-10-23: resubmitted with build 15** at the owner's request, replacing build 9 (this
resets the review queue position). Build 15 adds chat photos, calendar sync, the GroupMe guide,
Daylight Saving-safe repeats, confirmation dialogs anchored to their buttons, and a more
reliable team join (D-036 to D-038). Still no purchases; release stays automatic after approval.
Later the same day, **build 17** replaced it in review (adds the Open Event shortcut and Apple
Intelligence groundwork, D-039). Builds 1–15 are expired; only 16 (never distributed) and 17 remain.

**2026-10-24: 1.0.1 build 18 to TestFlight** (the HQ-arrow rebrand, D-040, from branch `rebrand-1.0.1`).
It's in internal testing and waiting for Beta App Review for the external "Beta Families" group. It is not
attached to any App Store version. 1.0 (build 17) is still waiting for review and was not touched.

**2026-10-29: 2.0 (build 25), fresh start** at the owner's request. The 1.0.1 submission (build 18) was **withdrawn from App Review** and the App Store version renamed **2.0** (the app has never been released). Build 25 is attached to 2.0 but **not submitted**. It's on TestFlight internal (Ring 0); builds 18–24 are expired, so 25 is the only active build. The production database was reset and seeded with the demo world (`docs/DEMO_TEAM.md`). 

**2026-10-29: 2.0 prepared for review (not submitted).** A draft review submission (`acf57f4c-…`) holds version 2.0 + build 25 and reads **READY_FOR_REVIEW**; Apple accepted the item with no missing-metadata errors. To send it: App Store Connect → 2.0 → **Submit for Review** (or PATCH the review submission with `submitted: true`).
- **Reviewer sign-in:** head coach info+aces-coach-tamara-reed@teamclubhq.com (Arch City Aces 14U Volleyball, no Coach Pro). The notes also list a parent, a 14-year-old player, the club director, and a spare account on no team (info+appreview-spare@teamclubhq.com) for trying join, create, Delete Team and Delete Account. All use the demo password. Team code **USEETF5FCK** is now stable across re-seeds. The full notes are in `docs/app-review-notes-2.0.txt`. Never use the Avengers team for review or screenshots (Marvel names, guideline 5.2).
- **Listing:** the description now covers clubs, schedule import and reminders, and no longer names GroupMe (2.3.7). Screenshots (7 × 6.9") match the current UI. Age rating is 13+ (chat and user content declared). Encryption exempt.
- **Site:** the privacy policy covers club directors, imported schedules, in-app reminder switches and the 30-day restore window for deleted teams. The Terms add an explicit zero-tolerance clause for objectionable content and abusive users (1.2). The sample calendar `webcal://teamclubhq.com/samples/team-calendar.ics` (practices through June 2027) is quoted in the notes, and the live import preview read 86 events from it.
- **Coach Pro is not in 2.0.** Both subscriptions are still MISSING_METADATA (Paid Apps Agreement, D-034), so the app shows no Pro wording. **Don't activate the Paid Apps Agreement while 2.0 is in review:** the products would start loading in the review sandbox without being submitted (2.1). Their review notes now name the Aces coach for the release that ships Pro.
- **Day of submission:** re-seed first (`node scripts/seed-demo.mjs --wipe`) so the reviewer sees four weeks of upcoming events. Logins and team codes stay the same.

**2026-10-29: 1.0.1 build 24 to TestFlight** (internal only) from `main`: team calendar import from any iCal link (D-047). Uploaded with the ASC API key (`-authenticationKeyPath`), since the Xcode account export failed ("Failed to Use Accounts"). Not attached to the version in review.

**2026-10-29: 1.0.1 build 23 to TestFlight** (internal only), branch `clubs`: Delete Team (D-046). Not attached to the version in review.

**2026-10-29: 1.0.1 build 22 to TestFlight** (internal only) from branch `clubs` (includes `reminders`): event reminders and RSVP nudges with switches (D-045), clubs Phase 0 + 1 (D-044). Not attached to the version in review.

**2026-10-28: 1.0.1 build 21 to TestFlight** (internal only) from `schedule-import`: Keep Games, Remove from List; the
Finished group; email-wrapped links. Not attached to the version in review.

**2026-10-28: 1.0.1 build 20 to TestFlight** (internal only) from `schedule-import`: adds the CNR league import (D-043)
and the sheet reader fixes from the owner's test. Not attached to the version in review.

**2026-10-28: 1.0.1 build 19 to TestFlight** (internal testing only, for the owner) from branch `schedule-import`:
tournament schedule import (D-042) plus the admin-portal app changes (D-041). It is **not** attached to the 1.0.1
version in review; build 18 stays in review.

**2026-10-25: the first release is now 1.0.1 (build 18, the HQ-arrow rebrand)**, at the owner's
request. 1.0 was never approved, so its submission was cancelled and the same App Store version
was renamed 1.0.1 (`--version-string`). The screenshots were replaced with the six captioned 6.9"
shots from `Marketing/Claude Code Brand Kit/07-App-Store/` as a single
`APP_IPHONE_67` set (`--screenshots`); the old 6.1" and 6.7" sets showed the pre-rebrand UI and a
"Pay securely in ClubHQ" card that 1.0 doesn't have. The description and review notes now cover
chat photos, calendar sync and the GroupMe guide. Still no purchases; release is automatic after
approval. Builds 1–17 are expired; only 18 remains.

Build **7** adds Report/Block in chat (guideline 1.2). The description and review notes in
`docs/app-store/metadata.json` no longer mention Stripe card payments or Coach Pro, since both are off in 1.0
(guideline 2.3.1). Paste both into App Store Connect. The 6 screenshots in `design/app-store-screenshots/`
are fine; don't use `docs/app-store/screenshots/iphone-6.9/07-paywall.png`. Minimum iOS is now **26.0** (OQ-07).

Before pressing **Add for Review → Submit**:
1. Account Holder accepts the updated Apple Developer Program License Agreement (Business page).
2. ✅ Done 2026-10-14: `teamclubhq.com` is live on Cloudflare Pages (project `teamclubhq`, DNS on Cloudflare, Microsoft 365 email records kept as DNS only). Redeploy with `scripts/deploy-site.sh` (wrangler; excludes README and `.htaccess`).
3. `info@teamclubhq.com` receives mail (OQ-16), or change the support address.

Regenerate screenshots: build Debug for an iPhone 17 Pro Max simulator and launch with
`-ScreenshotPersona coach|parent -ScreenshotTab home|schedule|team|messages -ScreenshotOpen chat|event|tour`
(DEBUG-only hooks in `MyApp.swift` and `MainTabView.swift`).
