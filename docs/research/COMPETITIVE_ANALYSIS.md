# ClubHQ Competitive Analysis: Youth Sports Team Management

**Prepared:** 2026-10-13
**Scope:** Competitors, pricing, monetization benchmarks, complaint themes, Apple App Store payment rules, children's privacy (COPPA / Apple age rules), and recommendations for ClubHQ.

> **Name note:** The brief listed "ManageEngine". ManageEngine is a Zoho IT-management brand with no youth-sports product. This report assumes the intended competitor is **SportsEngine** (NBC Sports Next), the main TeamSnap rival in club/league management.

> **How reliable this is:** Many vendors (LeagueApps, PlayMetrics, TeamSnap clubs, SportsEngine Motion) don't publish prices. Where a number comes only from a third party or a competitor's comparison page, it is marked **(unverified)**. Several vendor pricing pages I fetched were cached or out of date. Check prices again before using them in a pitch deck. I found no real Reddit threads (r/youthsports, r/TeamSnap) through search, so the complaint themes come from App Store, Google Play, Trustpilot, Capterra and parent-forum reviews, plus press coverage.

---

## 1. Executive Summary

- **The market is splitting in two.** On the club/league side (B2B), TeamSnap ONE (launched Nov 2025), SportsEngine HQ, LeagueApps, PlayMetrics and TeamLinkt make most of their money from **payment processing on registration and dues**. On the independent-team side (B2C), TeamSnap single-team plans, Heja, BAND and Spond rely on **freemium subscriptions plus ads**. GameChanger is the outlier: it earns from **fan subscriptions** (streaming and stats) while staying free for coaches.
- **Payment take rates are the profit engine.** The industry standard is about **3.25% + $1.50 per transaction** (TeamSnap and SportsEngine) against a raw Stripe cost of **2.9% + $0.30**. The low-price challengers sit at **2.7% + $0.30** (TeamLinkt) and **3.29% + $1.00** (Spond US).
- **Parents' top complaints:** (1) ads in free tiers, especially pop-ups (TeamSnap, Heja, BAND); (2) basic features behind a paywall (RSVP tracking, calendar sync, stats, replays); (3) "too many apps": one team often runs TeamSnap, GameChanger, a fundraising app and a tournament app at once; (4) notification overload (Spond); (5) clunky multi-guardian and multi-kid handling (SportsEngine); (6) billing traps such as auto-renewals and accidental subscriptions (TeamSnap, GameChanger).
- **Apple rules work in ClubHQ's favor.** Team dues and registration fees are real-world services. Under Guideline 3.1.3(e) they **must** go through non-IAP payments such as Stripe, so Apple takes nothing. Digital subscriptions (coach Pro, family premium, replays/stats) need IAP. Since May 2025, US apps may also link out to web checkout with **0% Apple commission**. Apple proposed a 15% link-out fee in Aug 2026, which is still pending in court.
- **COPPA tightened.** The amended rule's compliance deadline was **April 22, 2026**. Sharing children's data with third parties for advertising now needs **separate verifiable parental consent**. Texas SB 2420 has been in force since **June 4, 2026**, and Apple's Declared Age Range API is available. ClubHQ should run **no third-party ads to player accounts at all**.

---

## 2. Competitor Profiles

### 2.1 TeamSnap (Single-team, TeamSnap ONE, TeamSnap for Clubs & Leagues)
- **Segment:** Both. It has single-team freemium plans and a quote-based club/league product. **TeamSnap ONE** launched on Nov 18, 2025. It is a rebuilt platform covering registration, communication, team management, built-in live streaming, highlights and training content (NFL FLAG, MLS, Jr. NBA, MLB, FC Barcelona, PLL). Clubs and leagues got it first. Families get ONE only through participating clubs and leagues, and the consumer app is due to be updated later. TeamSnap reports 30M users, 19,000+ organizations and 2M DAU in 2025.
  - https://www.teamsnap.com/blog/announcements/teamsnap-unveils-teamsnap-one-next-generation-platform-future-youth-sports-technology
  - https://youthsportsbusinessreport.com/teamsnap-hits-30-million-users-launches-unified-platform-and-expands-pro-partnerships/
- **Core features:** Schedule, chat, availability/RSVP, rosters, assignments, payments/dues, registration, live streaming (720p free, 1080p with TeamSnap+), replays, clips, drills. XbotGo Falcon auto-tracking camera integration (Aug 2026; camera is $799).
  - https://www.prnewswire.com/news-releases/teamsnap-and-xbotgos-integrated-live-streaming-experience-is-now-available-to-all-teamsnap-one-users-302857696.html
- **Pricing (single team, one subscription per team):** Free (fewer than 15 players, ads, no RSVP tracking); **Premium $18.99/mo or about $129.96/yr**; **Ultra $25.99/mo or about $165/yr** (unlimited roster). Paid tiers remove ads for owners and managers only. Clubs and leagues are quote-only. The App Store also lists "Ad Free" and "TeamSnap+ Content & Ad-Free" IAPs (TeamSnap+ price not published; **unverified**).
  - https://checkthat.ai/brands/teamsnap/pricing (third party; prices cross-checked against teamsnap.com plan descriptions)
  - https://teams-help.teamsnap.com/article/3015-what-is-teamsnap-and-what-does-it-include
- **Monetization:** Per-team subscriptions, ads in the free tier, payment processing, club/league SaaS, TeamSnap+ family subscription (replays, clips, at-home training), sponsorship features (Ultra marketed for "teams that sell sponsorships"), and pro-league content partnerships.
- **Payment fees:** TeamSnap for Business lists **3.25% + $1.50** per transaction (page may be dated). Classic PayPal payments cost about **5%** (PayPal's 2.9% + 30c plus TeamSnap's 2%). Registration has no admin fee, but processing fees apply and can be passed to families.
  - https://www.teamsnap.com/for-business/features/payments
  - https://helpme.teamsnap.com/article/1268-set-up-and-manage-classic-payments
- **Top complaints:** Pop-up ads and repeated upsells ("Way too many ads now!", Oct 2025); a very stripped free tier; per-team pricing with no multi-team discount; auto-renewing, non-refundable annual plans and easy accidental subscriptions; TeamSnap ONE missing features from the old version (Aug 2026 review: "no invoicing, no auto-rostering"); hard to use for non-technical parents.
  - https://www.trustpilot.com/review/teamsnap.com
  - https://www.capterra.com/p/123208/TeamSnap/reviews/
  - https://www.softwareadvice.com/registration/teamsnap-profile/reviews/

### 2.2 SportsEngine (NBC Sports Next)
- **Segment:** Clubs, leagues and governing bodies (strong ties to national governing bodies, such as USA Hockey memberships). It is a B2B system of record. The SportsEngine mobile app serves teams and families.
- **Core features:** Registration, payments, invoicing, membership cards, eligibility/background checks, websites, volunteer management ("Dibs"), rosters, schedules, stats and standings. Streaming comes through **SportsEngine Play**.
- **Pricing (HQ):** Free package; **Express about $79/mo ($799/yr)**; **Premium about $129/mo ($1,299/yr)**; **Pro $2,199/yr** (adds video streaming). Older listings say $69/mo or $749/yr. There is a minimum processing commitment: process at least $1,000/yr or pay a **$300 fee** at renewal.
  - https://www.capterra.com/p/134125/SportsEngine/
  - https://www.waresport.com/blog/sportsengine-pricing-2026-hidden-fees-vs-waresport (competitor source; **unverified**)
- **Payment fees:** Premium **3.25% + $1.50**; Pro **3.2% + $1.00** (official but older page). SportsEngine Motion: $295 setup plus **4.2% + $0.30** (**unverified**).
- **SportsEngine Play (streaming):** Launched Oct 2023 with Premier and All Access tiers at about **$9.99/mo or $79.99–$99.99/yr**. 2026 prices are **unverified**.
  - https://www.nbcsports.com/pressbox/press-releases/nbc-sports-next-breaks-ground-with-sportsengine-play-a-first-of-its-kind-streaming-service-for-youth-amateur-sports
- **Monetization:** Org SaaS, processing fees, setup and website design fees (reviewers report initial outlays over $6,000; **unverified**), streaming subscriptions, and ads in the app.
- **Top complaints:** Confusing, dated UI; the Dibs volunteer system; only the registering parent gets full access, which hurts divorced and co-parenting families; "don't notify" settings ignored; constant re-login; admin tools only work in a browser; known bugs that stay unfixed; streams that fail after paying $10/mo; support that sends parents back to their club; ads that can't be avoided at app open.
  - https://www.capterra.com/p/134125/SportsEngine/reviews/
  - https://justuseapp.com/en/app/499597400/sportsengine/reviews

### 2.3 GameChanger (DICK'S Sporting Goods)
- **Segment:** Teams of every kind (rec, travel, high school). Strongest in baseball and softball, now covering 10+ sports. It is scoring-first.
- **Core features:** Scorekeeping, live streaming, play-by-play, stats (150+ in baseball/softball), spray charts, AI highlights, team chat and schedule.
- **Pricing:** Free (team management, scoring, streaming; **5 free live baseball/softball streams**, unlimited for other sports); **Plus $9.99/mo or $39.99/yr**; **Premium $14.99/mo or $99.99/yr**; **Premium Family $24.99/mo or $179.99/yr (4 accounts)**; **Team Pass: Plus $239.99/season, Premium $449.99/season**. Premium is **free for coaches and staff**, and fans pay.
  - https://gc.com/pricing-family-plans
  - https://gc.com/pricing/team-pass
  - https://apps.apple.com/us/app/gamechanger/id1308415878
- **Monetization:** B2C fan subscriptions (the core model), team passes, and DICK'S retail synergy. This proves that **parents and grandparents pay to watch**.
- **Top complaints:** Streaming put behind a paywall ("$10 a month to watch a kid's softball game"); price increases (Premium went from $49.99 in 2022 to $99.99); the family plan feels too expensive; no cheap player account for teens; double charges and trouble cancelling (PissedConsumer 2.0 stars); crashes during games.
  - https://apps.apple.com/us/app/gamechanger/id1308415878?see-all=reviews&platform=iphone
  - https://gamechanger.pissedconsumer.com/review.html

### 2.4 Heja
- **Segment:** Independent teams and small clubs, popular in Europe and US youth soccer.
- **Core features:** Schedule, RSVP, chat, attendance, payment tracking, calendar sync (paid at times).
- **Pricing (US App Store):** Free (ad-supported); **Heja Plus $3.99/mo or $29.99/yr**; **Heja Pro $13.49/mo or $99.99/yr**; **Team Pro Max $18.99/mo or $139.99/yr**. Priced per team, with club deals by quote.
  - https://apps.apple.com/us/app/heja/id1157335714
- **Monetization:** Ads, per-team IAP subscriptions, a family-level "Plus" upsell, club deals.
- **Top complaints:** Aggressive ad load with ads that are hard to close and appear mid-RSVP. One scam-style "your device is infected" ad was reported. Calendar sync is paywalled; Heja reversed this once and then paywalled it again. Paying doesn't remove Heja's own promotions. Members resent being upsold.
  - https://apps.apple.com/us/app/heja/id1157335714?see-all=reviews
  - https://www.onclarity.com/leaderboard/insight/heja

### 2.5 Spond
- **Segment:** Clubs and groups, strong in Norway, the UK and Europe, expanding in the US. Spond Club adds multi-team web admin.
- **Core features:** Events, RSVP, availability, chat, payments, fundraising (some jurisdictions), club admin.
- **Pricing:** **Free app and free Spond Club.** It makes money on payments: **US $1.00 + 3.29%** per payment, **UK 20p + 2.5%**, **EU EUR 0.20 + 2.5%**. The fee is charged **per product**, not per checkout. Club pays by default, with an option to pass the fee on. A club website add-on costs about GBP 19/mo (**unverified**). It also earns from brand partnerships and a percentage of fundraising.
  - https://help.spond.com/app/en/articles/118091-payments-costs-in-the-spond-app
  - https://help.spond.com/en/articles/25998-spond-is-free-to-download-and-use
  - https://www.clubpal.app/compare/spond-alternative
- **Top complaints:** Notification overload: 50+ invites with no bulk accept, duplicate pushes plus emails, all-or-nothing settings. Calendar sync spam. Confusing split between event, group and DM messages. Member emails visible to 200+ strangers. AI-only support.
  - https://apps.apple.com/us/app/spond/id755596884?see-all=reviews
  - https://leweslenny.substack.com/p/to-spond-or-not-to-spond

### 2.6 BAND (NAVER)
- **Segment:** A general group app (schools, churches, teams), not built for sports.
- **Core features:** Posts with read receipts, chat, calendar, polls, live streaming, fee collection (added 2022).
- **Pricing and monetization:** Free with ads. IAPs include **Ad-free 30 days $1.99** and **100GB storage $16.99 for 6 months or $33.99/yr** (App Store, date **unverified**). NAVER says it **shows no ads to underage users** and blocks minors from public groups. BAND for Kids is a separate app.
  - https://apps.apple.com/us/app/band-app-for-all-groups/id542613198
  - https://blog.band.com/sportsteams
- **Top complaints:** Ads now appear between posts and feel more intrusive. No sports-specific workflows such as RSVP by game, line-ups or stats.
  - https://marlvel.ai/apps/band-app-for-all-groups

### 2.7 LeagueApps
- **Segment:** Clubs, leagues, tournaments and travel organizations (mid to large).
- **Core features:** Registration, payment plans, billing, QuickBooks Online integration, websites; LeagueApps Play app for families (free and ad-free, 4.7 stars on 4.8K ratings).
- **Pricing:** Not public. Per-transaction model: "We automatically take the small fee out of each registration payment." Third parties estimate **$1–$5 per registration plus about 2–3% processing**; one competitor claims up to **5.9%**, and design fees start at $1,750 (all **unverified**).
  - https://leagueapps.com/pricing/
  - https://www.raftlabs.com/blog/cost-to-build-app-like-leagueapps
  - https://sportsplus.app/competitor-comparison/leagueapps
- **Top complaints:** Calendar bugs and duplicate events, a weak mobile chat, managers unable to add family members, Android instability, a reported 14-day outage, fees that feel high for small volunteer-run clubs.
  - https://www.capterra.com/p/127065/LeagueApps/reviews/

### 2.8 TeamLinkt
- **Segment:** Leagues, associations and clubs (Canada and US). Free for independent teams too.
- **Pricing:** **$0 platform fee**, no per-player fee. Processing is **2.7% + $0.30**, with a share of the Stripe fee kept by TeamLinkt. Optional bundles cost **CA$425/yr** (Ops or Revenue) or **CA$795/yr** (full platform). The free app shows banner ads.
  - https://www.capterra.com/p/187412/TeamLinkt/
  - https://youthsportsbusinessreport.com/teamlinkt-closes-8-3m-series-a-to-scale-free-sports-management-platform-across-north-america/
- **Business:** CA$8.3M Series A (2025), 3,000+ organizations, 3M users. Payment processing is the main revenue source, with ads second.
- **Complaints:** Ads shown to members; the processing fee is easy to miss (it sits in the FAQ, per competitor Communiti).

### 2.9 Sportlyzer
- **Segment:** European clubs and academies, with training planning and attendance focus.
- **Pricing:** Free tier plus a "Full package" priced by club size (player count). One example shows **EUR 1,000/yr** (30% annual discount). Capterra lists **EUR 7.50 per user per month** (**unverified**). New pricing took effect Nov 1, 2025.
  - https://www.sportlyzer.com/en/pricing
- **Relevance to ClubHQ:** Low for a US launch, but useful as a **per-member club pricing** reference.

### 2.10 Other notable players (2025–2026)
| Product | Positioning | Notes |
|---|---|---|
| PlayMetrics | Soccer-centric club OS (tryouts, evaluations, curriculum) | Quote-only. Parents complain about percentage fees on everything (Trustpilot). https://www.trustpilot.com/review/playmetrics.com |
| Snap! Raise / Snap! Mobile | Fundraising | Keeps **20%** of funds, plus about a 4% donor fee and a pre-filled tip. Class action filed (allegations only). https://givebutter.com/blog/is-snap-raise-worth-it |
| Crossbar, Jersey Watch, Stack Sports, PowerUp, SquadFusion, TeamSideline | Rec league and registration tools | Appear in 2026 alternatives lists. https://www.jerseywatch.com/blog/teamsnap-alternatives |
| The Futures App, Vanta Sports | 2025–26 "all-in-one + player development / AI" entrants | Self-ranked roundups, so market traction is **unverified**. https://www.thefuturesapp.com/news/the-best-sports-team-management-apps-in-2026-(ranked) |
| Centro | Bilingual (Spanish-first) youth soccer platform | A notable differentiation angle. https://withcentro.com/blog/teamsnap-alternatives-youth-soccer |

---

## 3. Feature Comparison Table

Legend: Y = included free, $ = paid tier, P = partial or limited, N = not offered, ? = unverified.

| Capability | TeamSnap | SportsEngine | GameChanger | Heja | Spond | BAND | LeagueApps | TeamLinkt |
|---|---|---|---|---|---|---|---|---|
| Primary segment | Teams + Clubs | Clubs/Leagues/NGBs | Teams (fans) | Teams | Clubs/Groups | Any group | Clubs/Leagues | Leagues/Clubs |
| Schedule and calendar | Y | Y | Y | Y | Y | Y | Y | Y |
| RSVP / availability | $ (Premium+) | Y | Y | Y | Y | P (polls) | Y | Y |
| Team chat | Y | Y | Y | Y | Y | Y | Y | Y |
| Dues / payments | Y (fees) | Y (fees) | N | $ (Pro) | Y (fees) | P | Y (fees) | Y (fees) |
| Registration | Clubs (quote) | Y | N | N | Spond Club | N | Y | Y |
| Live streaming | Y in ONE (720p); $ 1080p/replays | $ (Play/Pro) | Y (5 free BB/SB) / $ | N | N | Y | N | ? |
| Stats / scoring | $ (Premium) | Y | Y deep / $ fans | $ attendance stats | N | N | N | P |
| Highlights / clips | $ TeamSnap+ | $ | $ Premium | N | N | N | N | N |
| Ads in free tier | Yes | Yes (reported) | Minimal | Heavy | No (brand partners) | Yes (not to minors) | No | Yes (banner) |
| Website builder | Clubs | Y | N | N | Add-on | N | Y | Y |
| Fundraising | Partner | P | N | N | Y (some regions) | N | P | $ Revenue bundle |
| Multi-guardian / co-parent | Y | Weak | Y | Y | Y | Y | Weak | ? |

---

## 4. Pricing Table (Public Prices, USD unless noted)

| Product / Tier | Monthly | Annual | Unit | Source / Status |
|---|---|---|---|---|
| TeamSnap Free | $0 | $0 | per team (fewer than 15 players, ads) | checkthat.ai, teamsnap.com |
| TeamSnap Premium | $18.99 | about $129.96 | per team | checkthat.ai (third party) |
| TeamSnap Ultra | $25.99 | about $165 | per team | checkthat.ai (third party) |
| TeamSnap+ (family) | ? | ? | per user | Price not published (**unverified**) |
| TeamSnap Clubs & Leagues / ONE | Quote | Quote | per org | teamsnap.com |
| SportsEngine HQ Express | about $79 | about $799 | per org | Capterra / Waresport (**partly unverified**) |
| SportsEngine HQ Premium | about $129 | about $1,299 | per org | Capterra / Waresport |
| SportsEngine HQ Pro | n/a | $2,199 | per org | Capterra |
| SportsEngine Play Premier | $9.99 | $79.99–$99.99 | per viewer | 2023 launch pricing (**2026 unverified**) |
| GameChanger Plus | $9.99 | $39.99 | per fan | gc.com |
| GameChanger Premium | $14.99 | $99.99 | per fan | gc.com |
| GameChanger Premium Family | $24.99 | $179.99 | 4 accounts | gc.com |
| GameChanger Team Pass Plus / Premium | n/a | $239.99 / $449.99 | per team per season | gc.com |
| Heja Plus | $3.99 | $29.99 | per user | App Store |
| Heja Pro | $13.49 | $99.99 | per team | App Store |
| Heja Team Pro Max | $18.99 | $139.99 | per team | App Store |
| Spond / Spond Club | $0 | $0 | n/a | spond.com |
| BAND Ad-free | $1.99 / 30 days | n/a | per user | App Store (**date unverified**) |
| LeagueApps | Per registration | n/a | about $1–$5 per reg + about 2–3% | Third party (**unverified**) |
| TeamLinkt Core / Bundles | $0 | CA$425 / CA$795 | per org | Capterra |
| Sportlyzer Full | by size | e.g. EUR 1,000 | per club | sportlyzer.com |

### Payment Processing Take Rates (Dues / Registration)

| Platform | Rate | Notes |
|---|---|---|
| Stripe baseline (US cards) | 2.9% + $0.30 | Connect "you handle pricing" adds $2/active account/mo plus 0.25% + $0.25 per payout. Instant payouts 1% (min $0.50). https://www.sharetribe.com/academy/marketplace-payments/stripe-connect-overview/ |
| TeamSnap (business) | 3.25% + $1.50 | Official but possibly dated page |
| TeamSnap Classic (PayPal) | about 5% | 2.9% + 30c PayPal plus 2% TeamSnap |
| SportsEngine Premium / Pro | 3.25% + $1.50 / 3.2% + $1.00 | Plus a $300 penalty if under $1K/yr processed |
| SportsEngine Motion | 4.2% + $0.30 (+$295 setup) | **unverified** |
| Spond US / UK / EU | 3.29% + $1.00 / 2.5% + 20p / 2.5% + EUR 0.20 | Charged per product line |
| TeamLinkt | 2.7% + $0.30 | Free platform, ads in app |
| LeagueApps | about $1–$5/reg + 2–3% (claims up to 5.9%) | **unverified** |
| Snap! Raise (fundraising) | 20% of funds + about 4% donor fee + tip | Competitor-sourced, consistent with Snap's "keep 80%" claim |

**Implied platform margin over Stripe:** On a $250 registration, 3.25% + $1.50 = $9.63 against Stripe's $7.55, a **gross margin of about $2.08 per transaction**. On a $40 team-dues payment, $2.80 against $1.46, about **$1.34 margin**. The flat fee drives most of the margin on small payments.

---

## 5. Complaint Themes (ranked by frequency across sources)

| # | Theme | Who it hits | Evidence |
|---|---|---|---|
| 1 | **Ads and upsell spam in free tier** (pop-ups, mid-action ads, scam ads) | TeamSnap, Heja, BAND, TeamLinkt, SportsEngine | Trustpilot TeamSnap Oct 2025; Heja Google Play 2025 ("ads are out of control"); DC Urban Moms ("TeamSnap is my least favorite because of the pop up ads") |
| 2 | **Paywalled basics** (RSVP tracking, calendar sync, replays, stats, viewing streams) | TeamSnap, Heja, GameChanger | TeamSnap free tier has no RSVP tracking; Heja calendar sync; GameChanger 5-stream cap |
| 3 | **App sprawl / "too many apps"** | All | Boston Globe, Oct 5 2026: "Two kids, 12 apps, and zero clue?" One mom used TeamSnap, GameChanger, Crossbar, Swimmingly and more. https://www.bostonglobe.com/2026/10/05/lifestyle/parents-schools-edtech-apps-platforms-passwords/ |
| 4 | **Notification overload / poor controls** | Spond, SportsEngine | "Notification Hell" (Oct 2025); SportsEngine ignores "don't notify" |
| 5 | **Fees on payments feel hidden or excessive** | PlayMetrics, LeagueApps, TeamSnap, Spond (per-product) | PlayMetrics family "$90 every month" in fees; Spond fixed fee per product |
| 6 | **Multi-kid / multi-guardian confusion** | SportsEngine, LeagueApps, TeamSnap | One-parent-only access; kids labeled "b56-4"; managers can't add family members |
| 7 | **Billing traps** (auto-renew, accidental subscriptions, double charges, hard to cancel) | TeamSnap, GameChanger, Heja | PissedConsumer GC 2.0 stars; Trustpilot TeamSnap |
| 8 | **Reliability** (calendar sync bugs, crashes mid-game, outages, failed streams) | LeagueApps, GameChanger, SportsEngine | 14-day LeagueApps outage; GC crashes during scoring |
| 9 | **Migration regressions** | TeamSnap ONE | Aug 2026 review: missing invoicing and auto-rostering |
| 10 | **Support quality** (AI-only, "ask your club") | Spond, SportsEngine | App Store replies |

---

## 6. Monetization Benchmarks

| Model | Benchmark numbers | Who does it | Fit for ClubHQ |
|---|---|---|---|
| Payment processing take rate (dues/registration) | 2.7%+$0.30 to 3.29%+$1.00; incumbents 3.25%+$1.50; about $1.30–$2.10 margin per transaction over Stripe | Everyone B2B; TeamLinkt and Spond make it their whole model | **High.** Apple-exempt (3.1.3(e)) and scales with GMV. US families spend **$1,016 per child on the primary sport** (Aspen Project Play 2025), so the GMV pool is large. https://projectplay.org/news/2025/2/24/project-play-survey-family-spending-on-youth-sports-rises-46-over-five-years |
| Coach/team freemium subscription | $99.99–$165/yr per team (Heja Pro, TeamSnap Premium/Ultra) | TeamSnap, Heja | **Medium-high.** Requires IAP (or a US link-out). Price per team annoys multi-team coaches. |
| Fan/family premium (streaming, replays, stats) | $39.99–$99.99/yr per fan; family plan $179.99/yr; team pass $240–$450/season | GameChanger, SportsEngine Play, TeamSnap+ | **High** once video exists. Requires IAP for digital content (or a US link-out). |
| Club/org SaaS | $799–$2,199/yr (SportsEngine); CA$425–795 (TeamLinkt); per member EUR 7.50/user/mo (Sportlyzer, **unverified**); $1–$5 per registration (LeagueApps, **unverified**) | SportsEngine, LeagueApps, PlayMetrics | **Medium.** Sell through a web dashboard (B2B, not IAP). Long sales cycle. |
| Ads (programmatic) | Not disclosed | TeamSnap, Heja, BAND, TeamLinkt | **Low and risky.** Ads are the #1 complaint, and COPPA requires separate consent for third-party ad sharing with under-13s. |
| Local sponsorship marketplace | TeamSnap markets Ultra for sponsorship sales; per-deal pricing not public (**unverified**) | TeamSnap, TeamLinkt Revenue bundle | **Medium.** Positioned as revenue for the team, with a platform cut (for example 10–15%). Ads bought in-app must use IAP (3.1.3(g)), so sell sponsorships through the web. |
| Fundraising | 20% take (Snap! Raise), plus about 4% donor fees | Snap! Raise, Spond | **Medium.** An undercut opportunity: a 5–8% all-in fee wins over clubs. Check Apple 3.2.2 donation rules (see section 7). |
| Merch / uniform store | Typical print-on-demand margins of about 15–30% (**unverified**, industry estimate) | Clubs via third parties (e.g. SquadLocker) | **Low-medium.** Physical goods are Apple-exempt. Partner integration rather than building it. |
| Instant payouts markup | Stripe charges 1% (min $0.50). Platforms can mark it up. | Stripe Connect platforms | **Low but easy.** Offer an optional "instant payout" for treasurers. |
| Hardware attach (cameras) | XbotGo Falcon $799 (TeamSnap partner) | TeamSnap | **Low.** Affiliate or bundle later. |

---

## 7. Apple App Store and Children's Privacy Compliance

### 7.1 Which payments must use In-App Purchase (IAP)?
Source: https://developer.apple.com/app-store/review/guidelines/

| ClubHQ purchase | Classification | Rule | Payment method |
|---|---|---|---|
| Team dues, registration fees, tournament entry, camp fees | Real-world service consumed outside the app | **3.1.3(e):** "If your app enables people to purchase physical goods or services that will be consumed outside of the app, you **must** use purchase methods other than in-app purchase" | **Stripe / Apple Pay** (Apple takes 0%). IAP is *not allowed*. |
| Uniforms, merch, physical gear | Physical goods | 3.1.3(e) | Stripe / Apple Pay |
| Coach "Pro" subscription unlocking app features | Digital features | **3.1.1:** unlocking features or functionality requires IAP | **IAP** (15% via Small Business Program, or 15% after year one for subscriptions). On the US storefront, you can *also* show a button or link to web checkout (see 7.2). |
| Family premium (replays, highlights, stats, ad-free) | Digital content | 3.1.1 | IAP (plus an optional US link-out) |
| Club/org SaaS bought by an administrator on the web | B2B, web-based | 3.1.3(f) covers free companion apps to a paid web tool, but only with no in-app purchasing or calls to action. Otherwise the US storefront allows links. | Sell through the web dashboard. Don't sell org plans inside the iOS app outside the US. |
| Local business buys a sponsor banner shown in ClubHQ | Ads displayed in the same app | **3.1.3(g):** buying ads to display in the same app must use IAP *if bought in-app* | Sell **only through the web / sales flow**, never in the iOS app. |
| Donations / fundraising | Charitable donations | 3.2.1(vi) / 3.2.2(iv): donations within the app are limited to approved nonprofits, or must go through Safari/SMS | **Unverified for team fundraising.** Get a legal or App Review pre-check. Safest is a web-based donation page opened in Safari. |
| Tips to coaches | Person-to-person | 3.1.3(b)? / 3.1.1 tipping clause | **Unverified.** Avoid at launch. |

### 7.2 2025–2026 US changes (external links / anti-steering)
- **April 30, 2025:** The court in *Epic v. Apple* held Apple in contempt and barred it from charging commissions on link-out purchases or restricting link design.
- **May 2025:** Apple updated 3.1.1(a) and 3.1.3. On the **US storefront**, apps may include "buttons, external links, or other calls to action" to other purchase methods with no entitlement needed. The current guideline text confirms that this prohibition "does not apply" to the US storefront.
- **December 2025:** The Ninth Circuit upheld contempt but let Apple seek a *cost-based* fee on remand.
- **May–June 2026:** Apple petitioned the Supreme Court and certiorari was reported granted (No. 25-1311, limited to the contempt standard). Arguments are expected Oct–Dec 2026, with a ruling around June 2027 (**partly unverified**: one source).
- **August 13, 2026:** Apple proposed a **15% link-out fee** (10% for some programs and renewals, **5% for Small Business Program** members). Epic is opposing it. **The current US link-out commission is 0%** until the court sets a fee.
  - https://www.macrumors.com/2026/08/13/app-store-fees-apple-link-outs/
  - https://en.wikipedia.org/wiki/Epic_Games_v._Apple
- **Outside the US:** Anti-steering rules still apply. In the EU, link-outs pay a store-services commission (15%, or 10% reduced) from Oct 1, 2026.
- **What ClubHQ should do:** Implement StoreKit 2 subscriptions *and* a US-only "Subscribe on web (save X%)" link. Assume link-out economics could change to about 5% (Small Business) in 2027.

### 7.3 COPPA (amended rule)
- **Timeline:** Final rule voted Jan 16, 2025, published Apr 22, 2025, effective **June 23, 2025**. The **compliance deadline was April 22, 2026**, and the rule is now fully enforceable.
  - https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data
  - https://www.hunton.com/privacy-and-cybersecurity-law-blog/coppa-rule-amendment-compliance-deadline-approaches
- **Key new obligations:**
  1. **Separate verifiable parental consent (VPC)** before disclosing a child's personal information to third parties for non-integral purposes. Targeted ads and AI training count as non-integral. Access to the service can't depend on this consent.
  2. The direct notice to parents must name the third-party recipients (or their categories) and the purposes.
  3. **Written data retention policy.** Personal information can't be kept indefinitely.
  4. **Written information security program**, with annual risk assessment, testing and vendor diligence.
  5. Broader definition of "personal information" (now includes biometric identifiers). Photos, videos and voice of children are already personal information, which matters for streaming and highlights.
- **Mixed-audience status:** A youth-sports app is directed at adults (coaches and parents) but has child users, so it is a mixed-audience service. ClubHQ needs a **neutral age gate** and must treat users under 13 under COPPA.

### 7.4 Apple age rules (2025–2026)
- **New age ratings:** 4+, 9+, **13+, 16+, 18+** (12+ and 17+ were removed). Developers had to answer the new questionnaire by Jan 31, 2026. https://developer.apple.com/news/?id=ks775ehf
- **Texas SB 2420 (App Store Accountability Act):** Enforced from **June 4, 2026** after the Fifth Circuit stayed the injunction. Apple accounts for under-18s in Texas must be in Family Sharing with parental approval. Developers must use the **Declared Age Range API** (age bracket only: under 13, 13–15, 16–17, 18+), the **Significant Change API** (to request parental re-consent), and must handle parents revoking consent. Utah, Louisiana and California have similar laws. https://developer.apple.com/news/?id=2ezb6jhj
- **Kids Category (Guideline 1.3):** No links out, no purchases (except behind a parental gate), no third-party analytics or ads. **Don't list ClubHQ in the Kids Category**, because payments, external links and chat conflict with it. Guideline 2.3.8 also means you can't use "for kids" in metadata outside the Kids Category.
- **Guideline 5.1.4:** Apps that can collect personal information from minors (name, photos, video, chat, location) need a privacy policy and must comply with COPPA and GDPR-K. A parental gate does **not** count as COPPA consent.

### 7.5 Design implications for the "Player" role
1. **Under 13: parent-managed sub-profile by default.** The parent creates the child's profile. The child either has no login or a limited "player view" login, enabled only after **VPC**. Use FTC-approved methods: card micro-charge with notice, government ID plus face match, knowledge-based questions, or a third-party VPC provider. Because ClubHQ already takes card payments, a card-based VPC step fits naturally into the dues checkout.
2. **No third-party ads or third-party analytics SDKs on any session that is (or may be) a minor.** BAND already shows no ads to minors, so that is the bar to meet. Use first-party analytics only, and no IDFA.
3. **Chat:** Under-13s get no DMs. Player chat goes only to team channels with a coach and a guardian visible ("two-adult rule", SafeSport-style). Adults cannot DM minors privately. This is also a selling point for clubs worried about SafeSport.
4. **Photos and video:** Treat streams and highlights of minors as personal information. Give per-child media consent toggles that parents control, default team-private visibility, and no public indexing.
5. **Ages 13–17:** Use the Declared Age Range API. Let teens have their own login with guardian linkage and restricted public discoverability. Keep monetization aimed at parents, not teens.
6. **Retention:** Auto-purge inactive child data after N seasons (for example 24 months), and publish the retention schedule.
7. **Age rating:** Expect **13+** (user-generated content and chat). Players under 13 then reach the app through parent devices or Family Sharing. **Unverified:** confirm how the questionnaire treats moderated user-generated content.

---

## 8. Feature Gaps and Differentiators for a New Entrant

1. **"One app for the whole family"**: a single parent inbox and calendar across all kids, teams and clubs, with color-coding by child and real names, not "b56-4". This is the Boston Globe complaint, and no incumbent solves it across organizations.
2. **No ads, ever, for families.** This directly attacks TeamSnap, Heja and BAND, and it simplifies COPPA compliance.
3. **RSVP and calendar sync free.** These are the two most resented paywalls.
4. **Notification intelligence:** per-team, per-kid digest mode ("tonight's summary"), a "game-day only" mode, and bulk RSVP accept. This beats Spond and SportsEngine.
5. **First-class co-parenting:** unlimited guardians per child, split payments between guardians, and separate households.
6. **Transparent, flat fees:** one published rate, the fee charged per checkout and not per line item, with fee pass-through shown clearly.
7. **Streaming free to watch live, at a fair replay price:** take advantage of GameChanger's backlash, for example free unlimited live viewing and a paid family plan for replays and highlights.
8. **Safety as a feature:** a SafeSport-style two-adult messaging rule, verified coach badges, and background-check integrations. Clubs pay for risk reduction.
9. **Treasurer tools for independent teams:** dues ledger, payment plans, reimbursements, budget sharing with parents. Today these sit mostly behind club-level products.
10. **Smooth migration:** one-tap TeamSnap/CSV roster import, timed for the TeamSnap ONE migration pain in 2026.
11. **Bilingual (Spanish) by default:** an under-served segment (see Centro).
12. **AI help that actually saves volunteer time:** auto-schedule from league PDFs, carpool matching, snack and volunteer rotation, auto-generated recap posts. Keep children's data out of third-party AI training, which COPPA counts as non-integral.

---

## 9. Recommendations for ClubHQ

### 9.1 Positioning
"The ad-free team app parents don't hate." Free for families, fair to coaches, cheaper and more transparent than TeamSnap on payments. Start with **independent and travel teams** (fast, product-led adoption). Then expand to **clubs** with a web dashboard once teams pull their clubs in, the way GameChanger and TeamSnap grew.

### 9.2 Recommended Tier Structure

| Tier | Who pays | Price (suggested) | Includes | Payment channel |
|---|---|---|---|---|
| **Free Team** | Nobody | $0 | Unlimited roster, schedule, **RSVP/availability**, chat, calendar sync, dues collection, multi-guardian, **no ads** | n/a |
| **Coach Pro** (per coach, covers **up to 3 teams**) | Coach / team manager | **$9.99/mo or $69.99/yr** | Practice planner and drills, attendance analytics, payment plans and auto-reminders, volunteer/snack rotations, custom forms and waivers, export, priority support | IAP (StoreKit 2) + US web link-out |
| **Family+** (per household, all kids) | Parents | **$5.99/mo or $49.99/yr** | Live-stream replays and 1080p, highlight clips, season stats, downloadable media, cross-team family calendar extras | IAP + US web link-out |
| **Team Pass** (one purchase unlocks Family+ for the whole team) | Team / booster club (often bundled into dues) | **$199/season** | Family+ for every household on the roster | Web (team treasurer) / IAP |
| **Club** | Club / league admin | **$2.50 per registered player per season**, minimum **$499/yr**, *or* $0 platform fee if processing is on ClubHQ | Registration, multi-team admin, website, background checks, financial reporting, sponsorship manager | Web / sales only (B2B) |

Pricing rationale: Coach Pro sits below TeamSnap Premium (about $130/yr per team) and Heja Pro ($99.99/yr) and covers multiple teams, which addresses a complaint about both. Family+ sits between GameChanger Plus ($39.99) and Premium ($99.99) and covers the whole household, which addresses GameChanger's family-plan complaint. Team Pass undercuts GameChanger's $239.99–$449.99. Club per-player pricing sits at the low end of the LeagueApps estimate ($1–$5 per registration) and below the SportsEngine minimums.

### 9.3 Payment Processing Rate
- **Team dues and registration: 2.9% + $0.79 per checkout** (flat per checkout, not per item), all-in including Stripe. This is below TeamSnap and SportsEngine (3.25% + $1.50) and Spond US (3.29% + $1.00), with clear fee pass-through. Margin over Stripe: about $0.49 per checkout plus volume discounts from Stripe as GMV grows (negotiate Stripe interchange-plus pricing above about $80K/mo).
- **Clubs on processing-only plans:** 3.25% + $0.99 with a $0 platform fee (the TeamLinkt and Spond model, but ad-free).
- **Optional instant payout** for treasurers: 1.5%.
- Use **Stripe Connect** (Express accounts per team or club). Budget the $2 per active account per month and payout fees into the rate.

### 9.4 Ranked Revenue Streams (by expected Year 1–3 contribution)

1. **Payment processing on dues and registration.** Apple-exempt under 3.1.3(e), it scales with the roughly $40B parents spend on youth sports, and it is the proven core for TeamLinkt, Spond, SportsEngine and LeagueApps.
2. **Family+ / Team Pass (video replays, highlights, stats).** GameChanger proves fans pay $40–$180/yr. Needs IAP or a link-out. Only build it once streaming quality is solid.
3. **Coach Pro subscriptions.** Predictable recurring revenue. Lower ceiling because coaches are a small share of users (roughly 1–2 per team of 12–20 families; an estimate, **unverified**).
4. **Club per-player SaaS.** Higher contract value but slower sales. Start in Year 2.
5. **Sponsorship marketplace** (local businesses sponsor a team, and ClubHQ keeps 10–15%). Shown only as team-branded sponsor cards, never programmatic, and never targeted at minors. Sold through the web (3.1.3(g)).
6. **Fundraising** at a **5–8% all-in** fee against Snap! Raise's 20%+. Run it through a Safari web flow pending the Apple 3.2.2 check.
7. **Merch and uniform affiliate/partner store.** Physical goods, Apple-exempt, low engineering cost through partners.
8. **Hardware and camera affiliate** (auto-tracking cameras). Opportunistic.

**Explicitly avoid:** programmatic or third-party ads (the top complaint and a COPPA liability), paywalling RSVP or calendar sync, per-line-item fixed fees, and auto-renewals that are hard to cancel. Use Apple-managed subscriptions and clear renewal reminders.

### 9.5 Compliance Must-Haves Before Launch
- [ ] StoreKit 2 for Coach Pro and Family+. Stripe/Apple Pay for dues, registration and merch. A US-only web link-out with a feature flag (so the fee can be revisited if the court sets one).
- [ ] Neutral age gate plus the **Declared Age Range API**. Parent-managed profiles for under-13s with **VPC** (card-based, at dues checkout). Separate consent screens for any third-party disclosure (ideally none).
- [ ] No third-party ad or analytics SDKs that receive minors' data. Written **data retention** and **information security** programs (COPPA 2025).
- [ ] Two-adult messaging rule. Per-child media consent. Team-private streams by default.
- [ ] Don't use the Kids Category or "for kids" wording. Expect a 13+ age rating. Support the Texas SB 2420 Significant Change and consent-revocation flows.
- [ ] Legal review of fundraising and donation flows (Apple 3.2.2) and state money-transmission questions (use Stripe Connect so Stripe holds the funds).

---

## 10. Items Not Verified
- TeamSnap+ price; TeamSnap club/ONE pricing; the current TeamSnap processing rate (official page may be dated).
- SportsEngine 2026 HQ and Play prices; Motion fees; setup costs.
- LeagueApps and PlayMetrics fees (quote-only; competitor-sourced).
- BAND IAP prices (listing date unknown); Spond's US club website add-on price.
- Supreme Court certiorari details in *Epic v. Apple* (single secondary source).
- Merch margin benchmarks; sponsorship pricing benchmarks.
- Apple's treatment of team fundraising, donations and tips in-app.
- Reddit-specific sentiment (no threads surfaced; complaint themes come from app stores, review sites and parent forums).
