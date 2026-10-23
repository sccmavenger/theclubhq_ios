# Claude Code: ClubHQ logo implementation

## Scope
Repository: `sccmavenger/theclubhq_ios`. Source folder: `Logo Design/`. Approved direction: **HQ Motion – Refined Balance (#3)**.

**Do not immediately replace the live app icon.** First prepare a reviewable branch/PR and compare the source with the selected reference image. The supplied vector is a draft approximation, not an exact conversion of the image.

## Tasks
1. Inspect the existing Xcode project, asset catalogs, Icon Composer setup, app targets and existing branding. Read `docs/brand/LOGO_DESIGN_BRIEF.md` and `docs/brand/AI_LOGO_PROMPTS.md`.
2. Retrieve the approved final design board from the owner's conversation or request the selected #3 image. Compare it to `vector/hq-motion-refined-balance-DRAFT.svg`; redraw the mark as **original editable vector paths** with faithful shape, spacing and proportions. Keep the navy/white/orange palette and record final hex values.
3. Save finalized vector masters under `Logo Design/vector/final/`: full-color icon, transparent symbol, one-color black, one-color white, horizontal and stacked lockups, and wordmark. Convert any text to paths in production masters; retain editable source. Record font and license if applicable.
4. Under `Logo Design/exports/ios/`, export flat 1024x1024 PNG without pre-rounded corners; separate background/foreground SVG layers and assemble an Icon Composer `.icon` file if supported by installed Xcode. Check Default, Dark, Clear and Tinted appearances. Do not bake shadows, glass, gloss or bevels into source layers.
5. Under `Logo Design/exports/web/`, export transparent PNGs, SVGs, favicon variants and social avatar previews. Keep generated exports separate from vector masters.
6. Validate legibility at 60pt and smaller, grayscale/tinted silhouette, light/dark wallpapers, icon clipping and accessibility contrast. Include before/after screenshots.
7. Make a dedicated PR showing all proposed asset changes, exact paths and build results. Only change the app's asset catalog after owner review. Preserve existing media, app behavior and all unrelated assets.
8. Run the available build and asset validation; report what was and wasn't tested. Do not claim App Store compliance without verification.

## Definition of done
Owner approves a faithful final vector and app-icon previews; production assets and licenses are documented; iOS project builds; no unrelated changes; original references and draft preserved for audit.
