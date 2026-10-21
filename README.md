# ClubHQ for iPhone

An ad-free youth-sports team app for **coaches, parents, and players**: schedules, RSVPs,
attendance, team chat, announcements, and team payments. It's the native companion to the
ClubHQ web app (`sccmavenger/athlete-align-suite`) and shares its Supabase backend.

## Run it
1. Open `ClubHQ.xcodeproj` in Xcode 27 and pick an iPhone simulator.
2. Build & Run. With no backend configured, the sign-in screen offers **Demo Mode**. Pick Coach, Parent, or Player to explore a seeded team. Switch roles any time under More → Demo mode.

## Connect the real backend
Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), then set `supabaseURL` and
`supabasePublishableKey` in `ClubHQ/Core/AppConfig.swift`.

## Docs
| Doc | What's in it |
|---|---|
| [`docs/PRODUCT_STRATEGY.md`](docs/PRODUCT_STRATEGY.md) | Positioning vs TeamSnap, personas, revenue model, roadmap |
| [`docs/research/COMPETITIVE_ANALYSIS.md`](docs/research/COMPETITIVE_ANALYSIS.md) | Competitor, pricing, App Store, and COPPA research |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every "how" decision and why |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | What I need from the owner |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Backend rollout runbook |
| `design/app-icon/` | Icon concepts; A · Home Court is the chosen icon |

## Testing purchases locally
Edit Scheme → Run → Options → StoreKit Configuration → `StoreKit/ClubHQ.storekit`.
