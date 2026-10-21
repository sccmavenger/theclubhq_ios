# ClubHQ — Architecture

```
 iPhone app (SwiftUI, iOS 27)                 Supabase (shared with the web app)
 ┌───────────────────────────────┐            ┌──────────────────────────────────────┐
 │ Features/*  (views)           │            │ Auth (GoTrue) ── email, Apple         │
 │      │  @Environment(AppModel)│  HTTPS     │ PostgREST ── RLS-protected tables     │
 │ AppModel (session, teams)     │──────────▶ │ Edge Functions                        │
 │      │                        │            │   mobile-api   (privileged actions)   │
 │ ClubHQBackend (protocol)      │            │   apns-dispatch ◀── pg_cron (1 min)   │
 │   ├─ SupabaseBackend          │            │   stripe-webhook ◀── Stripe           │
 │   └─ DemoBackend (in-memory)  │            │   appstore-notifications ◀── Apple    │
 │ SupabaseClient (no deps)      │            │ Postgres + private.* RLS helpers      │
 │ SubscriptionStore (StoreKit 2)│            └──────────────────────────────────────┘
 │ PushManager (APNs)            │                  ▲                 ▲
 └───────────────────────────────┘                  │                 │
                                  Web app (TanStack Start, Lovable) ──┘   Stripe Connect / APNs / App Store
```

## Principles
- **One schema, two clients.** iOS and web share tables, RLS, and accounts. iOS-only additions are additive (D-003).
- **RLS first.** Plain reads and writes go straight to PostgREST under the user's JWT. `mobile-api` does only what RLS can't express. It ports the web server functions' authorization logic one-to-one (D-005).
- **Protocol seam.** Views talk to `ClubHQBackend`, never to HTTP. `DemoBackend` powers Demo Mode, previews, and tests (D-006).
- **Capabilities, not roles.** `TeamMembership.canManageRoster`, `canMessagePrivately`, and similar decide what each screen shows (D-007).
- **Money is split by Apple's rules.** Coach Pro uses StoreKit. Team dues use Stripe Checkout in Safari (D-010).

## Source map (iOS)
| Path | Contents |
|---|---|
| `Core/AppConfig.swift` | Supabase URL/key, product IDs, URLs |
| `Core/AppModel.swift` | App-wide state, demo personas, deep links |
| `Core/Networking/` | `SupabaseClient` (auth, PostgREST, functions), Keychain, JSON coding |
| `Core/Backend/` | `ClubHQBackend` protocol, Supabase + Demo implementations, errors |
| `Core/Models/` | Codable models mirroring the schema |
| `Core/Store/` | StoreKit 2 entitlement store |
| `Core/Push/` | APNs registration, notification taps → `DeepLink` |
| `Features/` | Auth, Onboarding, Home, Schedule, Team, Messages, Inbox, Money, Paywall, Account |

## Source map (backend, `supabase/`)
| Path | Contents |
|---|---|
| `migrations/20261013120000_*` | `player` role enum value |
| `migrations/20261013120100_*` | All new tables, columns, policies, helper functions |
| `functions/_shared/` | HTTP helpers, notification fan-out port, APNs, App Store, Stripe |
| `functions/mobile-api/` | Action router (context, teams, invites, players, messaging, events, RSVP, inbox, devices, subscriptions, dues, delete account) |

## Data flow examples
- **Parent RSVPs:** `HomeView` → `backend.setRSVP` → `mobile-api set-rsvp`, which enforces the cutoff and upserts under the caller's RLS.
- **Coach posts an announcement:** `mobile-api create-announcement` (RLS insert) → `enqueueTeamNotification` → `notification_sends` rows → `dispatchPendingPushes` → APNs. The web inbox sees the same rows.
- **Parent pays dues:** `checkout` builds a Stripe Checkout session (destination charge + `application_fee_amount`) → Safari → Stripe → `stripe-webhook` marks the items paid.
