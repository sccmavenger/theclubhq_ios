# Start here: ClubHQ 1.0.1 rebrand (instructions for Claude Code)

**For:** Claude Code working in the `theclubhq_ios` repo, in Xcode or a terminal on the Mac.
**What this is:** the owner-approved ClubHQ brand (HQ-arrow mark; navy `#0B1E3A`, cyan `#00C2FF`, orange `#FF8A00`).
Apply it to the iOS app and to teamclubhq.com. Everything you need is in this folder.

**The kit:** `Marketing/Claude Code Brand Kit/` in this repo. The handoff docs call it `$KIT`. The path has spaces, so quote it in shell commands:
```
KIT="Marketing/Claude Code Brand Kit"
```

## Do this, in order
1. Read [`HANDOFF-iOS.md`](HANDOFF-iOS.md) and do steps 1–8: branch `rebrand-1.0.1`, version 1.0.1, app icon, colors and logos,
   `BrandTheme.swift`, the in-app `BrandMark`, small brand touches, the decision log, and verification.
2. Read [`HANDOFF-Site.md`](HANDOFF-Site.md) and do it on the **same branch**: icons, `<head>` tags, header logo, `site.css`, self-hosted fonts.
   Preview locally only.
3. Do step 9 of `HANDOFF-iOS.md`: recapture the app screenshots from the rebranded build and re-run `$KIT/_source/social_assets.py`,
   so the social posts and App Store frames show the new UI. Commit the regenerated files in `$KIT`.
4. Stop and report to the owner, with screenshots of the app (light and dark) and the site.

## Ground rules
- **Ask the owner before you:** submit or upload a build, deploy the site (`scripts/deploy-site.sh`), merge to `main`, or change the
  `TeamView` palette's first swatch. Each handoff says where these come up.
- Check with the owner whether **1.0 is still in App Review**. If it is, leave that submission alone; this work ships as 1.0.1.
- **Visual identity only.** No backend, data-model or feature changes.
- **Treat the kit as read-only**, except for the screenshot step. Copy files out of it; don't move them. Xcode doesn't build anything in
  `Marketing/`, because only `ClubHQ/` is a synchronized folder.
- If something in the repo doesn't match what a handoff expects (a file has moved, a color has already changed), adapt sensibly and note it
  in your report. Don't force the doc's version.

## Reference, if you need it
| Need | Where |
|---|---|
| Logos (SVG, PDF, PNG) | `$KIT/01-Logo/` |
| App icon set | `$KIT/02-App-Icon/AppIcon.appiconset/` |
| Color tokens | `$KIT/03-Color-Type/clubhq-tokens.json` |
| Web files | `$KIT/04-Web/` |
| Xcode colors, logos, `BrandTheme.swift` | `$KIT/05-iOS/` |
| What the brand looks like | `$KIT/00-Review/checkpoint-1.html` (open in a browser) |
| Social and App Store art | `$KIT/06-Social/`, `$KIT/07-App-Store/` |
