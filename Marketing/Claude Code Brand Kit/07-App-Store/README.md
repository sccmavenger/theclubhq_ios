# App Store art

- `iphone-6.9_1320x2868/`: seven framed screenshots at the 6.9" iPhone size. App Store Connect scales them down for
  smaller iPhones, so this one set is all you need (the app is iPhone-only).
- App icon: it comes from the build. The opaque 1024px PNG is in `02-App-Icon/app-store/` if App Store Connect asks for one.

These are the screenshots for 1.0.1 (build 18), uploaded to App Store Connect on 2026-10-25. They were captured
from the 1.0.1 build and rendered with `_source/social_assets.py` (see `HANDOFF-iOS.md`, step 9). To change one,
recapture it into `_source/screens/`, re-run the script, and upload with `scripts/asc/swap-review-build.mjs --screenshots`.

| # | Headline | Screen |
|---|---|---|
| 1 | Every kid. Every team. One calendar. | Parent home |
| 2 | Run your team in minutes. | Coach home |
| 3 | RSVPs in one tap. | Event |
| 4 | The whole season, always up to date. | Schedule |
| 5 | Team chat that's safe for kids. | Chat |
| 6 | Your whole team in one place. | Team |
| 7 | Free for families. No ads. Ever. | Sign in |
