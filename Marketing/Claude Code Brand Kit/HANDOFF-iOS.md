# ClubHQ 1.0.1 rebrand: iOS app handoff

**For:** Claude Code working in the `theclubhq_ios` repo in Xcode.
**Brand kit:** this folder (`ClubHQ-Brand-Kit/`). Below, `$KIT` means its path on the Mac.
**Goal:** replace the "Home Court" identity with the ClubHQ HQ-arrow brand in version **1.0.1**. Behavior stays the same.

## Ground rules

- **1.0 (build 17) is in App Review. Don't touch that submission.** Do this work on a new branch, `rebrand-1.0.1`, and don't upload or submit anything without the owner's go-ahead.
- **Visual identity only.** No backend, data-model or feature changes.
- **Keep team colors working.** Teams can pick their own tint (`TeamMembership.tint`, `MainTabView` `.tint(...)`). The new AccentColor is only the *default*.
- **Keep the existing semantic colors** for RSVP, attendance and dues states (`UIComponents.swift`). They're already contrast-tuned and they carry meaning.
- The project uses synchronized folders (`PBXFileSystemSynchronizedRootGroup`). New files dropped into `ClubHQ/` are picked up automatically, so there's no need to edit `project.pbxproj` for them.

## Steps

### 1. Branch and version
```
git switch -c rebrand-1.0.1
```
Set `MARKETING_VERSION = 1.0.1` in all four build configurations in `ClubHQ.xcodeproj/project.pbxproj`. It's currently `1.0` in four places.

### 2. App icon
Replace the **contents** of `ClubHQ/Assets.xcassets/AppIcon.appiconset/` with `$KIT/02-App-Icon/AppIcon.appiconset/`:
- `AppIcon-1024.png`, `AppIcon-1024-dark.png`, `AppIcon-1024-tinted.png`, `Contents.json`
- Delete the old `AppIcon-Light.png`, `AppIcon-Dark.png` and `AppIcon-Tinted.png`.

`ASSETCATALOG_COMPILER_APPICON_NAME` stays `AppIcon`. The layered Icon Composer icon is optional (`$KIT/02-App-Icon/icon-composer-layers/README.md`). Only do it if the owner asks.

### 3. Colors and logos
Merge into the **existing** `ClubHQ/Assets.xcassets`. Don't add a second catalog, because both catalogs would contain an `AccentColor` and clash:

| Copy from `$KIT/05-iOS/ClubHQBrand.xcassets/` | To `ClubHQ/Assets.xcassets/` |
|---|---|
| `AccentColor.colorset/` | **replaces** `AccentColor.colorset/` |
| `Colors/` (folder with its `Contents.json` and 15 colorsets) | `Colors/` |
| `Logos/` (folder with its `Contents.json` and 6 imagesets) | `Logos/` |

New AccentColor: light `#0077C2`, dark `#007CBF`. White text on it is ≥ 4.5:1 in both modes. That matters because `ChatView` draws white text on `Color.accentColor` for your own messages, and prominent buttons do the same. The old accent was `#2457F5` / `#5B8CFF`.

The logo imagesets are SVG with `preserves-vector-representation`. After building, check that `BrandMark`, `BrandLockup` and `BrandWordmark` render with their gradients. **If any render blank or flat,** swap that imageset to the matching PDF from `$KIT/01-Logo/pdf/`: rename it `light.pdf`/`dark.pdf` and update the filenames in its `Contents.json`.

### 4. Theme file
Copy `$KIT/05-iOS/BrandTheme.swift` to `ClubHQ/Features/Shared/BrandTheme.swift`. It adds `Color.Brand.*`, `Image.Brand.*` and `BrandCTAButtonStyle`.

### 5. Replace the in-app mark
In `ClubHQ/Features/Shared/UIComponents.swift`, replace `struct BrandMark` and delete the two private shapes `HomeCourtHouse` and `HomeCourtLines`. Keep the `BrandMark(size:)` API so `ContentView` (`LaunchView`) and `AuthView` don't change:

```swift
/// The ClubHQ mark on its navy tile — matches the app icon.
struct BrandMark: View {
    var size: CGFloat = 44

    var body: some View {
        Image.Brand.markOnNavy
            .resizable()
            .scaledToFit()
            .padding(size * 0.14)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [Color(hex: "#1A4280") ?? Color.Brand.navy, Color.Brand.navy, Color.Brand.midnight],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: .rect(cornerRadius: size * 0.225, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}
```

### 6. Brand touches (small, deliberate)
- `AuthView` and the onboarding hero (`OnboardingView`, `WelcomeTourView`): where the screen shows the product name next to `BrandMark`, use `Image.Brand.lockup` (it switches automatically between light and dark). Keep it about 28–36pt tall.
- Use `BrandCTAButtonStyle` (orange with a navy label) for the **one** primary action on onboarding and auth screens. Don't restyle every button. System buttons already pick up the new AccentColor.
- `TeamView` palette: the first swatch `#2457F5` is the old brand blue. **Ask the owner** before changing it. The suggestion is to replace it with `#0077C2`. Teams that already saved `#2457F5` keep their color either way.
- Leave `systemGroupedBackground` backgrounds as they are. The navy surfaces are for marketing; inside the app, iOS system backgrounds keep it feeling native.

### 7. Record the decision
Add **D-040** to the top of `docs/DECISIONS.md`. Mark **D-023** (Home Court) *Superseded by D-040*, and update the note at its end that says the accent is `#2457F5`:

> **D-040 — Rebrand to the HQ-arrow identity in 1.0.1 (owner-approved 2026-10-23) — Accepted.** New icon, mark, wordmark and palette (navy `#0B1E3A`, cyan `#00C2FF`, orange `#FF8A00`). AccentColor `#0077C2` / dark `#007CBF`, so white text on the accent stays ≥ 4.5:1. Brand kit: tokens in `docs/brand/clubhq-tokens.json`.

Copy `$KIT/03-Color-Type/clubhq-tokens.json` to `docs/brand/`. Leave the existing `docs/brand/*` files alone.

### 8. Verify
- Build and run on an iPhone 17 Pro Max simulator in **light and dark** mode. Check Launch, Auth, Home, Schedule, Chat (your own bubbles), Team and Dues.
- On a device or simulator home screen, long-press › Edit › set the icon style to **Dark** and then **Tinted**, and check the icon in each.
- Dynamic Type at **AX3**: the lockup and BrandMark mustn't clip.
- Run the tests: `xcodebuild test -scheme ClubHQ -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'`.
- The asset catalog should build with no warnings.

### 9. Recapture screenshots, then regenerate the marketing art
The social posts and App Store frames in the kit currently show the **old blue UI**. After the rebrand builds:
1. Recapture with the existing DEBUG hooks (see `docs/APP_STORE.md`, “Regenerate screenshots”) on the iPhone 17 Pro Max simulator. Save to `design/app-store-screenshots/iphone-6.9/` using the same six filenames. Also capture the Dues screen as `7-dues.png`, **with card payments off**.
2. Copy the seven PNGs into `$KIT/_source/screens/`, then run:
   ```
   cd $KIT/_source && pip3 install shapely pillow && python3 social_assets.py
   ```
   It uses Chrome or Edge in headless mode (set `CHQ_BROWSER` if neither is in /Applications).

### 10. Ship (only with the owner's go-ahead, and only after 1.0 is approved)
Archive and upload with the existing `scripts/asc/` flow. In App Store Connect, replace the 6.9" screenshots with `$KIT/07-App-Store/iphone-6.9_1320x2868/` (regenerated in step 9). The new app icon comes from the binary automatically.
