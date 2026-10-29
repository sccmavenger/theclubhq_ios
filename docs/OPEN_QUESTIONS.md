# ClubHQ — Open Questions for the Owner

For each question I made a working assumption so the work could continue (see `DECISIONS.md`).
Answering one may change the linked decision.

| # | Question | Working assumption | Blocks |
|---|---|---|---|
| OQ-01 | "ManageEngine": did you mean **SportsEngine**? | Yes (D-001) | Nothing |
| OQ-02 | ✅ **Answered:** the web app is retired. Production is the new **TeamClubHQ** project (Pro) | D-024, D-028 | — |
| OQ-15 | ✅ **Done 2026-10-13:** Resend is connected. Sender is "ClubHQ" <info@teamclubhq.com>, limit 500 emails/hour, verified with a real send to `delivered@resend.dev` | — | — |
| OQ-16 | `teamclubhq.com` has **no inbox (no MX record)**, so replies to info@ and support@ bounce. Set up mail hosting (Google Workspace, Microsoft 365, or Cloudflare Email Routing forwarding to an existing inbox) | No inbox | Support, App Review contact |
| OQ-17 | Check the **Resend plan** before launch. The free tier is 100 emails/day and 3,000/month; Pro ($20/mo) is 50,000/month | Free tier assumed | Launch volume |
| OQ-13 | **Rotate the credentials shared in chat:** reset the TeamClubHQ database password and delete the `ClubHQ setup` access token, then update `.env.local` | Pending owner | Security hygiene |
| OQ-14 | Delete the unused Free-plan project `vdrlbktsdgegqbpsicno`? | Leave it for now | Nothing |
| OQ-03 | Approve pricing: Coach Pro **$9.99/mo or $69.99/yr** (14-day trial, up to 3 teams); dues fee **2.9% + $0.79** per checkout paid by families | Approved provisionally (D-011) | App Store Connect products |
| OQ-04 | ✅ **Answered 2026-10-28:** APNs key "ClubHQ Push" (Key ID `32TXHR58JG`, Team `CB4AAVWWUD`, sandbox + production) is in the gitignored `.secrets/` folder and set as Supabase secrets. Push verified on the owner's iPhone | — | — |
| OQ-05 | Final **bundle ID** (currently an Xcode placeholder) and permission to enable Sign in with Apple + Push capabilities on it | e.g. `app.clubhq.ios` | Signing, push, SIWA, TestFlight |
| OQ-06 | Legal review of the COPPA approach (no logins under 13; guardian-issued codes for 13+) and Texas SB 2420 / Declared Age Range API timing | Approach in D-008; Age Range API next release | App Store submission |
| OQ-07 | ✅ **Answered 2026-10-20:** minimum iOS lowered to **26.0** (from build 7) | — | — |
| OQ-08 | A **Stripe** account with Connect enabled, under which business entity? | You'll create one | Dues payments |
| OQ-09 | ✅ **Answered 2026-10-13:** the owner owns **teamclubhq.com**. Remaining: where to host it (recommended: Cloudflare Pages), and creating the `support@` mailbox | See D-025 | Invites, App Review |
| OQ-10 | ✅ **Closed 2026-10-23:** there is no web app (the Lovable project was deleted), so there's nothing to bring to parity | — | — |
| OQ-11 | Trademark check on the "ClubHQ" name before spending on marketing | Not checked | Branding |
| OQ-18 | Can a club pay ClubHQ directly (invoice or card) for Pro on all its teams? | Likely, under 3.1.3(c) Enterprise Services or the 2025 US external-link rules; confirm before building club billing. Grants and pilots are fine either way | Club billing |
| OQ-19 | Update the **App Store Connect privacy label**: Product Interaction → Analytics, linked to the user, not used for tracking (D-041) | Owner, in ASC → App Privacy (no API) | The build with usage events |
| OQ-20 | ✅ **Answered 2026-10-25:** the portal lives at **teamclubhq.com/adminportal**. Optional: Cloudflare Access in front of that path | MFA protects it today | Nothing (hardening) |
| OQ-12 | Turn on the included StoreKit configuration for local purchase testing? (Edit Scheme → Run → Options → StoreKit Configuration → `StoreKit/ClubHQ.storekit`) | Off; the paywall has a fallback and Demo Mode has a "Demo: unlock" button | Local purchase testing |
