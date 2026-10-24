# ClubHQ iOS app icon — approved design, implementation handoff

## Approved source
Use `vector/final/app-icon.svg` as the single source of truth. This is the owner-approved HQ Motion / Refined Balance artwork. Do not redraw, trace, recolor, substitute fonts, or change proportions. Background navy `#0B2544`, orange `#FF741C`, white `#FFFFFF`.

## Claude Code implementation steps
1. Render `vector/final/app-icon.svg` to an opaque, RGB, sRGB 1024 × 1024 PNG (no alpha). Preserve the complete composition, centered with no unintended crop. Suggested destination: `Logo Design/ios-production/ClubHQ_AppIcon_1024.png`.
2. Verify dimensions, RGB mode, opacity, colors, edges, and visually compare with source SVG. Do not simply rename an SVG as PNG.
3. Locate the actual iOS app target and asset catalog. Replace its AppIcon universal 1024 × 1024 source with the rendered PNG; update `Contents.json` if needed. Ensure the app target's `ASSETCATALOG_COMPILER_APPICON_NAME` references the chosen AppIcon set. Do not change unrelated icons or branding.
4. If project uses Xcode Icon Composer, generate the `.icon` with the same artwork and test Default, Dark, Clear and Tinted appearances. Do not improvise monochrome shapes: if variants need design decisions, retain standard opaque PNG icon and report optional variants separately.
5. Build the app with Xcode, verify the icon in Simulator/on device (Home Screen, Settings, Spotlight), and check archive validation before submission. Report exact build result and any remaining blockers.
6. Commit the exported PNG and any app asset-catalog changes; update this handoff with the commit SHA and test results.

## Status
**Design approval: FINAL.** **iOS export/build verification: PENDING** until the above steps are performed and recorded. Approval of artwork is not a claim that an App Store-ready binary has been tested. Do not request another logo design approval.
