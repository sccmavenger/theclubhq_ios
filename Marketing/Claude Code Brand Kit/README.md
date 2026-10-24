# ClubHQ Brand Kit

Everything needed to rebrand the ClubHQ iPhone app, teamclubhq.com, and Facebook, Instagram and TikTok.

| Folder | What's inside | Who uses it |
|---|---|---|
| `00-Review/` | Checkpoint pages 1–3: visual review of everything | You |
| `01-Logo/` | Mark, wordmark, horizontal and stacked lockups in color, white and navy, as SVG (edit in Illustrator), PDF and PNG | Everyone |
| `02-App-Icon/` | Xcode icon set (default, dark, tinted), App Store 1024, Icon Composer layers | Xcode |
| `03-Color-Type/` | Design tokens (JSON) and Illustrator swatches (`.ase`) | Designers, developers |
| `04-Web/` | Favicons, manifest, link-preview image, `brand.css`, head snippet | Website |
| `05-iOS/` | `ClubHQBrand.xcassets` (colors and logos) and `BrandTheme.swift` | Xcode |
| `06-Social/` | Facebook, Instagram and TikTok profile, covers, highlights, 6 launch posts, templates, safe zones, captions | You |
| `07-App-Store/` | Framed 6.9" App Store screenshots | App Store Connect |
| `HANDOFF-iOS.md` | Step-by-step instructions for Claude Code in Xcode: the app | Claude Code |
| `HANDOFF-Site.md` | Step-by-step instructions for Claude Code: teamclubhq.com | Claude Code |
| `_source/` | Generators. Change a value, re-run, and every file updates | Whoever maintains the brand |

## Brand at a glance
- **Colors:** Navy `#0B1E3A` · Cyan `#00C2FF` · Orange `#FF8A00`. On white, use Deep Cyan `#0077C2` and Deep Orange `#B35A00` for text.
- **Type:** Outfit (headlines), Inter (web body text), SF Pro (in the app).
- **Line:** “The ad-free team app parents don't hate.”
- **Logo rules:** keep clear space equal to the Q's ring thickness on every side. Never recolor the arrow, add effects,
  or put the full-color mark on a busy photo. Use the one-color white version there.

## Regenerating
```
cd _source
pip install shapely pillow
python build_brand.py      # vector masters (logos, icon concepts, tokens)
python export_assets.py    # PNG/PDF, icon set, Xcode assets, web kit
python social_assets.py    # social and App Store art (uses screenshots in _source/screens)
```
Rendering uses headless Edge or Chrome. Set `CHQ_BROWSER` to use another Chromium browser.
