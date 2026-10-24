# ClubHQ iOS app icon — FINAL asset / Xcode integration handoff

## Approved, finished image

**Use the existing production PNG, not a new export:**
`Logo Design/ios-production/ClubHQ_AppIcon_1024.png`

[View exact PNG](ios-production/ClubHQ_AppIcon_1024.png)

The approved image is a 1024 × 1024 opaque RGB PNG exported from `vector/final/app-icon.svg` and committed to GitHub. Its SHA-256 is `07fd17c8db0b2687d367f9b4b1054e7521c4a3d53b1845683956c109141a50d3`. The uploaded bytes were fetched back and matched. Design approval is FINAL; **do not recreate, regenerate, recolor, redraw, or alter the PNG**.

## Claude Code: install, do not generate

1. Pull the latest repository changes. Read the exact PNG above; do not render the SVG or substitute another image.
2. Locate the actual iOS application target and its asset catalog. Copy the **existing PNG unchanged** to the AppIcon asset set. Configure `Contents.json` and `ASSETCATALOG_COMPILER_APPICON_NAME` as required by the project. Keep other branding unchanged.
3. Verify the installed PNG's SHA-256 matches the original above, and that the asset catalog recognizes it.
4. Build in Xcode and verify the icon in Simulator and, if available, on device (Home Screen, Settings, Spotlight). Report the exact result; do not claim tests passed without running them.
5. If the project uses Icon Composer or needs Dark/Clear/Tinted variants, report the requirement. Do not invent new logo variants or alter the approved standard PNG without explicit approval.
6. Commit only the integration changes, record the commit SHA, build outcome, appearance results, and remaining blockers in this handoff.

## Status

- Logo design: **FINAL / APPROVED**
- Standard iOS app icon PNG: **FINAL / UPLOADED / BYTE-VERIFIED**
- Xcode app integration: **PENDING verification**
- Build, on-device appearance, and App Store submission validation: **PENDING verification**

Do not request another design approval. Do not label an untested app build as production-validated.
