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
- **App Privacy** (matches `ClubHQ/PrivacyInfo.xcprivacy`): Data Linked to You → Name, Email Address, Phone Number, User ID, Other User Content, Purchase History — all for **App Functionality**. **No tracking.**
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

Build **7** adds Report/Block in chat (guideline 1.2). The description and review notes in
`docs/app-store/metadata.json` no longer mention Stripe card payments or Coach Pro, since both are off in 1.0
(guideline 2.3.1). Paste both into App Store Connect. The 6 screenshots in `design/app-store-screenshots/`
are fine; don't use `docs/app-store/screenshots/iphone-6.9/07-paywall.png`. Minimum iOS is now **26.0** (OQ-07).

Before pressing **Add for Review → Submit**:
1. Account Holder accepts the updated Apple Developer Program License Agreement (Business page).
2. ✅ Done 2026-10-14: `teamclubhq.com` is live on Cloudflare Pages (project `teamclubhq`, DNS on Cloudflare, Microsoft 365 email records kept as DNS only). Redeploy by uploading `site/` (minus README and `.htaccess`) in Pages → Create deployment.
3. `info@teamclubhq.com` receives mail (OQ-16), or change the support address.

Regenerate screenshots: build Debug for an iPhone 17 Pro Max simulator and launch with
`-ScreenshotPersona coach|parent -ScreenshotTab home|schedule|team|messages -ScreenshotOpen chat|event`
(DEBUG-only hooks in `MyApp.swift` and `MainTabView.swift`).
