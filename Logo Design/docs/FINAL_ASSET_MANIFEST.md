# ClubHQ final approved asset manifest

**Design:** HQ Motion / Refined Balance (#3), approved October 23, 2026. Approved reconstructed vector art is in `../vector/final/`; it is not the original source geometry of the concept board. Colors: navy `#0B2544`, orange `#FF741C`, white `#FFFFFF`.

## Production assets now in GitHub

- **iOS app icon:** [`../ios-production/ClubHQ_AppIcon_1024.png`](../ios-production/ClubHQ_AppIcon_1024.png). Final approved 1024 × 1024 opaque RGB PNG. Upload was verified by fetching the bytes back. SHA-256: `07fd17c8db0b2687d367f9b4b1054e7521c4a3d53b1845683956c109141a50d3`.
- **Vector masters:** `../vector/final/`. Approved logo source artwork.
- **Social assets:** `../Social Media/`. Platform-specific PNG exports, guides, and preview.

## Distinguish artwork from integration

**Artwork and standard iOS icon PNG are FINAL.** Claude Code must use the supplied PNG exactly, not regenerate or redesign it. See [iOS integration handoff](../IOS_APP_ICON_PRODUCTION_HANDOFF.md).

**Remaining app-specific verification:** Install the PNG into the actual iOS asset catalog; build with Xcode; inspect on Simulator/device; validate release as applicable. No successful Xcode build is claimed here. Optional Icon Composer `.icon` and appearance variants are not claimed complete.

**Wordmark note:** Some editable vector wordmark files use live DejaVu Sans text. Outline or validate font handling before distributing those *editable wordmark* assets; this does **not** block use of the finished icon PNG.
