# ClubHQ rebrand: teamclubhq.com handoff

**For:** Claude Code working in `theclubhq_ios/site/`, a static site on Cloudflare Pages with no build step.
**Brand kit:** this folder. Below, `$KIT` means its path on the Mac.
**When:** do this on the same `rebrand-1.0.1` branch as the iOS work. **Deploy on the day 1.0.1 ships**, so the site and the app match. Don't run `scripts/deploy-site.sh` without the owner's go-ahead.

## 1. Files

| From `$KIT/04-Web/` | To `site/` |
|---|---|
| `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `site.webmanifest`, `og-image.png` | site root |
| `logo-on-light.svg`, `logo-on-dark.svg` | `assets/` |

Overwrite the old icons **in place**. Some pages and old shared links still point at them:

| Replace | With |
|---|---|
| `assets/icon-1024.png` | `$KIT/02-App-Icon/AppIcon.appiconset/AppIcon-1024.png` |
| `assets/icon-180.png` | `$KIT/04-Web/apple-touch-icon.png` |
| `assets/icon-64.png` | `$KIT/04-Web/favicon-64.png` |
| `assets/icon-32.png` | `$KIT/04-Web/favicon-32.png` |

## 2. `<head>` on every page
Pages: `index`, `download`, `join`, `auth-callback`, `payments-return`, `privacy`, `terms`, `support`, `404`.

- Replace the `rel="icon"` and `rel="apple-touch-icon"` lines with the first five lines of `$KIT/04-Web/head-snippet.html`: icons, manifest and `theme-color`. Keep the existing `site.css` link.
- **`index.html` and `join.html` only:** replace the `og:image` line with the Open Graph and Twitter block from the snippet. The new image is `/og-image.png` at 1200×630. Keep each page's own `og:title`/`og:description` wording.
- **Smart App Banner:** the App Store ID is **6822555956** ("ClubHQ Team"). Leave it commented out until 1.0 is live. Then uncomment it in `index.html` and update `download.html` (currently "Coming soon") to link to `https://apps.apple.com/app/id6822555956`.

## 3. Header logo
`privacy.html`, `terms.html` and `support.html` use
`<header class="site"><img src="/assets/icon-180.png" alt=""><a href="/">ClubHQ</a></header>`. Replace it with:

```html
<header class="site"><a href="/" aria-label="ClubHQ home"><picture>
  <source srcset="/assets/logo-on-dark.svg" media="(prefers-color-scheme: dark)">
  <img src="/assets/logo-on-light.svg" alt="ClubHQ" height="36">
</picture></a></header>
```
In `site.css`, change `header.site img` to `height: 36px; width: auto; border-radius: 0;`.

## 4. `assets/site.css`
Replace the `:root` block and the dark-mode block with:

```css
:root {
  --blue: #0077C2;      /* links + secondary buttons (Deep Cyan, 4.75:1 on white) */
  --blue-dark: #0B1E3A;
  --cta: #FF8A00;       /* primary button */
  --on-cta: #0B1E3A;    /* 7.05:1 on orange */
  --ink: #0B1E3A;
  --muted: #4B5C77;
  --bg: #F4F7FB;
  --card: #FFFFFF;
  --radius: 20px;
  --font-display: "Outfit", -apple-system, "Segoe UI", sans-serif;
  --font-body: "Inter", -apple-system, "Segoe UI", sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --blue: #00C2FF; --ink: #FFFFFF; --muted: #8C9BB2; --bg: #0B1E3A; --card: #13294D; }
}
```
Then:
- `body`: change `font:` to `17px/1.55 var(--font-body)`.
- `h1, h2, h3`: add `font-family: var(--font-display);`.
- `.btn`: `background: var(--cta); color: var(--on-cta);`. Leave `.btn.secondary` as it is: it uses `--blue`, which is now cyan.
- `.hero img.icon` shadow: `rgba(11, 30, 58, .35)`.
- `code.token` background: `rgba(0, 119, 194, .1)`.

## 5. Fonts: self-host them
The privacy page promises no third-party trackers. Serving fonts from your own domain keeps every page request on teamclubhq.com.
1. Download **Outfit** (weights 600, 700, 800) and **Inter** (400, 500, 600, 700) as `.woff2` files. Both are under the SIL Open Font License, from Google Fonts or the projects' GitHub releases. Put them in `site/assets/fonts/`.
2. Add `@font-face` rules at the top of `site.css`, with `font-display: swap`.
3. Add this to `_headers`:
   ```
   /assets/fonts/*
     Cache-Control: public, max-age=31536000, immutable
   /site.webmanifest
     Content-Type: application/manifest+json
   ```

`$KIT/04-Web/brand.css` is the full token reference, including semantic light and dark tokens. It loads fonts from Google, so use it as a reference only. Don't link it as-is.

## 6. Check, then deploy (with the owner's go-ahead)
- Preview locally (e.g. `npx wrangler pages dev site`). Check every page in light and dark mode at 375px and 1280px wide.
- Favicon in the browser tab, and Add to Home Screen on iPhone.
- After deploying with `scripts/deploy-site.sh`, run the Facebook Sharing Debugger on `https://teamclubhq.com/` and click **Scrape Again**, so Facebook drops the cached old icon preview.
