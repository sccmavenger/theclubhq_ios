# ClubHQ — Product Strategy

> **Positioning:** *The ad-free team app parents don't hate.* Free for families, fair to coaches,
> and cheaper and more transparent than TeamSnap on payments.

Evidence for every claim here is in [`research/COMPETITIVE_ANALYSIS.md`](research/COMPETITIVE_ANALYSIS.md).
The decisions that implement it are in [`DECISIONS.md`](DECISIONS.md).

## 1. Where we win

| Incumbent weakness (research §5) | ClubHQ answer | Shipped in iOS v1? |
|---|---|---|
| Pop-up ads in free tiers (TeamSnap, Heja, BAND) | **No ads, ever.** Revenue comes from payments and subscriptions | Yes |
| RSVP tracking and calendar sync behind paywalls | RSVP, availability, calendar feed, and chat are free forever | Yes |
| "Two kids, 12 apps": parents juggle many apps | **One family view:** every kid, every team, one schedule and one inbox | Yes (cross-team Home + Schedule) |
| Multi-guardian confusion | Unlimited guardians per child; each sees and RSVPs for their kids | Yes (existing `parent_player_links` model) |
| Hidden or per-item payment fees | One published fee, **2.9% + $0.79 per checkout**, shown before paying | Yes (needs Stripe keys) |
| Notification overload | Per-thread mute, and daily digest instead of per-RSVP spam | Mute: yes; digest: server-side backlog |
| Child-safety worries | Two-adult messaging rule; no DMs for players; COPPA-first player accounts | Yes |
| TeamSnap ONE migration pain (2026) | One-tap roster import (CSV / TeamSnap export) | Backlog M2 |

## 2. Who we serve first
1. **Independent and travel teams** (volunteer head coach + 10–20 families). Product-led adoption: the coach downloads the app, invites parents with a link, and is done in under 10 minutes.
2. **Clubs** later (M4), through a web dashboard once teams pull their clubs in.

## 3. Personas in the app
| Persona | Primary jobs | Home screen shows |
|---|---|---|
| **Coach** (head/assistant/manager) | Roster, schedule, attendance, announcements, collect dues | Next event + RSVP count, who hasn't responded, unpaid dues, quick actions |
| **Parent / Guardian** | Know where to be, RSVP per child, pay, stay informed | Each child's next event with one-tap RSVP, amount due, latest announcement |
| **Player** (13+, invited by guardian/coach) | Know the schedule, RSVP self, team chat | Next event with RSVP, team chat |

## 4. Revenue model
Ranked by expected Year 1–3 contribution (research §9.4):

1. **Payments on dues and registration:** 2.9% + $0.79 per checkout, paid by the family. Stripe Connect Express; money goes straight to the team's account. Apple fee 0% (guideline 3.1.3(e)).
   *Unit economics:* about $0.49 gross margin per checkout over Stripe's 2.9% + $0.30, before Connect's $2 per active account per month. A team of 15 families × 4 payments per season comes to 60 checkouts, about $29 per season gross. Improves as we negotiate interchange-plus pricing.
2. **Family+ / Team Pass** (replays, highlights, stats): $5.99/mo or $49.99/yr per household; Team Pass $199/season. **Not sold until the content exists.**
3. **Coach Pro:** $9.99/mo or $69.99/yr, 14-day trial, covers up to 3 teams. Sold with StoreKit 2. In the US storefront an optional link to web checkout is allowed (0% Apple fee currently, behind a feature flag because of the pending court-set fee).
4. **Club SaaS:** $2.50 per player per season (min $499/yr), or $0 if processing runs through ClubHQ. Web/B2B only.
5. **Local sponsorships:** a sponsor card on the team page, sold on the web, ClubHQ keeps 12%. Never programmatic, never targeted at minors.
6. **Fundraising** (5–8% vs Snap! Raise's 20%): web flow, pending legal review.

### What's free vs. Pro (Coach)
| Capability | Free | Coach Pro |
|---|---|---|
| Teams as head coach | 1 | Up to 3 |
| Roster, schedule, recurring events, RSVP, attendance, chat, announcements, calendar feed, volunteer/snack signups | ✅ | ✅ |
| Collect dues (Stripe) | ✅ (standard fee) | ✅ (standard fee) |
| Season attendance & availability report | — | ✅ |
| Roster export (CSV via share sheet) | — | ✅ |
| One-tap "remind unpaid" for dues | — | ✅ |
| Custom team color/branding | — | ✅ |
| Priority support | — | ✅ |

Rule of thumb: **anything a parent needs is never behind a paywall.** Pro sells time savings and
insight to the coach.

## 5. Roadmap
| Milestone | Scope | Status |
|---|---|---|
| **iOS v1.0 (this build)** | Auth (email + Apple), onboarding (create team / join by invite / player code), family Home, schedule + event detail + RSVP + attendance + scores, roster + player profiles, team chat + threads + announcements, inbox, dues (coach create / parent pay), Coach Pro paywall, account deletion, demo mode | Built — needs backend deploy |
| v1.1 | Push notifications live (APNs key), RSVP digest, calendar subscribe button, event photos | Backend partly exists |
| v1.2 | Roster import (CSV/TeamSnap), Spanish localization, widgets ("next game"), Live Activity on game day | Backlog |
| v2.0 | Family+ (game video highlights, stats), Team Pass | Requires video pipeline |
| v2.x | Club dashboard (web), registration forms/waivers, sponsorship marketplace, Android | Backlog |

## 6. Success metrics
- **Activation:** coach creates a team and invites ≥ 5 families within 24 h (target 40%).
- **Engagement:** % of events with ≥ 70% RSVP responses before cutoff.
- **Monetization:** % of active teams collecting dues (target 25% by month 6); Coach Pro conversion among multi-team coaches (target 15%); payment GMV.
- **Trust:** zero ads, App Store rating ≥ 4.7, notification opt-out rate < 10%.
