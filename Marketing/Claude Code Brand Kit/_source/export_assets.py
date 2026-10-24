"""ClubHQ brand kit — Phase 2 production exports.

Run after build_brand.py. Rasterizes with headless Microsoft Edge (installed
on every Windows 11 machine) and Pillow:

    python build_brand.py
    python export_assets.py
"""
import base64
import io
import json
import re
import struct
import subprocess
import tempfile
from datetime import date
from pathlib import Path

from PIL import Image

import build_brand as bb

KIT = bb.KIT
def _browser():
    """Any Chromium browser works. Set CHQ_BROWSER to override."""
    import os
    candidates = [os.environ.get("CHQ_BROWSER", ""),
                  r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                  r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    return next(c for c in candidates if c and Path(c).exists())


EDGE = _browser()
TMP = Path(tempfile.gettempdir()) / "chq-export"
TMP.mkdir(exist_ok=True)
PROFILE = TMP / "edge-profile"  # never touches the user's own Edge profile


# ---------------------------------------------------------------- rendering
def _edge(extra, target):
    args = [EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1", "--default-background-color=00000000",
            f"--user-data-dir={PROFILE}", *extra, Path(target).as_uri()]
    subprocess.run(args, check=True, capture_output=True, timeout=180)


def png(source_text, out, w, h, suffix=".svg", wait=False):
    src = TMP / f"src{suffix}"
    src.write_text(source_text, encoding="utf-8")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    extra = [f"--window-size={w},{h}", f"--screenshot={out}"]
    if wait:
        extra.append("--virtual-time-budget=8000")  # let web fonts load
    _edge(extra, src)
    return out


def pdf(svg_text, out, w, h):
    svg = re.sub(r"<svg ", f'<svg width="{w}" height="{h}" ', svg_text, count=1)
    html = (f"<!doctype html><meta charset=utf-8><style>@page{{size:{w}px {h}px;margin:0}}"
            f"html,body{{margin:0}}svg{{display:block}}</style>{svg}")
    src = TMP / "src.html"
    src.write_text(html, encoding="utf-8")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    _edge([f"--print-to-pdf={out}", "--no-pdf-header-footer", "--print-to-pdf-no-header"], src)


def viewbox(svg):
    x, y, w, h = map(float, re.search(r'viewBox="([^"]+)"', svg).group(1).split())
    return w, h


def opaque(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGB", im.size, (11, 30, 58))
    bg.paste(im, mask=im.split()[3])
    bg.save(path, optimize=True)


def resized(src, out, size):
    im = Image.open(src)
    im.resize((size, size), Image.LANCZOS).save(out, optimize=True)


def j(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- 01 logo
def export_logos():
    for svg_path in sorted((KIT / "01-Logo").rglob("*.svg")):
        svg = svg_path.read_text(encoding="utf-8")
        vw, vh = viewbox(svg)
        long_side = 2048
        s = long_side / max(vw, vh)
        w, h = round(vw * s), round(vh * s)
        rel = svg_path.relative_to(KIT / "01-Logo").with_suffix("")
        png(svg, KIT / "01-Logo" / "png" / f"{rel.name}.png", w, h)
        pdf(svg, KIT / "01-Logo" / "pdf" / f"{rel.name}.pdf", round(vw), round(vh))


def export_swatches():
    def ase(colors):
        blocks = b""
        for name, hx in colors:
            r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5))
            body = (struct.pack(">H", len(name) + 1) + (name + "\0").encode("utf-16-be")
                    + b"RGB " + struct.pack(">fffH", r, g, b, 2))
            blocks += struct.pack(">HI", 0x0001, len(body)) + body
        return b"ASEF" + struct.pack(">HHI", 1, 0, len(colors)) + blocks

    colors = [(f"ClubHQ {nm} {hx}", hx) for _, hx, nm, _ in bb.PALETTE]
    (KIT / "03-Color-Type" / "ClubHQ-swatches.ase").write_bytes(ase(colors))


# ---------------------------------------------------------------- 02 app icon
ICON_MH = 500  # must match build_brand.icon_svg


def icon_layout():
    mw = bb.MARK_W * ICON_MH / bb.MARK_H
    return (1024 - mw) / 2, (1024 - ICON_MH) / 2


def tinted_icon_svg():
    bb.MARK_SCHEMES["gray"] = ("#FFFFFF", "#9C9C9C", "#D4D4D4")
    x, y = icon_layout()
    defs, g, _ = bb.place_mark("gray", "t", x, y, ICON_MH)
    return bb.svg_doc("0 0 1024 1024", '<rect width="1024" height="1024" fill="#000"/>' + g,
                      defs, "ClubHQ app icon (tinted source)")


def export_icons():
    d = KIT / "02-App-Icon"
    concepts = d / "concepts"
    aset = d / "AppIcon.appiconset"
    png(concepts.joinpath("clubhq-icon_default.svg").read_text(encoding="utf-8"),
        aset / "AppIcon-1024.png", 1024, 1024)
    png(concepts.joinpath("clubhq-icon_dark.svg").read_text(encoding="utf-8"),
        aset / "AppIcon-1024-dark.png", 1024, 1024)
    png(tinted_icon_svg(), aset / "AppIcon-1024-tinted.png", 1024, 1024)
    for f in aset.glob("*.png"):
        opaque(f)
    j(aset / "Contents.json", {
        "images": [
            {"filename": "AppIcon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
            {"appearances": [{"appearance": "luminosity", "value": "dark"}],
             "filename": "AppIcon-1024-dark.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
            {"appearances": [{"appearance": "luminosity", "value": "tinted"}],
             "filename": "AppIcon-1024-tinted.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
        ],
        "info": {"author": "xcode", "version": 1},
    })
    store = d / "app-store" / "ClubHQ-AppStore-1024.png"
    store.parent.mkdir(exist_ok=True)
    store.write_bytes((aset / "AppIcon-1024.png").read_bytes())

    # Icon Composer layers: same placement as the icon, one shape per file
    x, y = icon_layout()
    lay = d / "icon-composer-layers"
    for i, part in enumerate(["h", "q", "arrow"], 1):
        defs, g, _ = bb.place_mark("color-dark", "c", x, y, ICON_MH, only=part)
        name = {"h": "H", "q": "Q", "arrow": "Arrow"}[part]
        (lay / f"{i}-{name}.svg").parent.mkdir(parents=True, exist_ok=True)
        (lay / f"{i}-{name}.svg").write_text(
            bb.svg_doc("0 0 1024 1024", g, defs, f"ClubHQ icon layer: {name}"), encoding="utf-8")
    (lay / "README.md").write_text(ICON_COMPOSER_README, encoding="utf-8")


ICON_COMPOSER_README = """# Icon Composer layers

Optional upgrade from `AppIcon.appiconset` to a layered Liquid Glass icon.

1. Open Icon Composer (Xcode > Open Developer Tool > Icon Composer) and create a new icon.
2. Background: set the fill to a linear gradient from `#1A4280` (top) to `#06122A` (bottom).
3. Drag the layers in this order, bottom to top: `1-H.svg`, `2-Q.svg`, `3-Arrow.svg`.
   They share one 1024 canvas, so they line up automatically.
4. Glass: on for Arrow, subtle on Q, off for H. Check the Dark, Tinted and Clear previews.
5. Save the file as `AppIcon.icon` and drag it into the Xcode project. Then set
   *Target > General > App Icon* to `AppIcon`.

If you skip this step, the `AppIcon.appiconset` (default, dark and tinted PNGs) works as-is.
"""


# ---------------------------------------------------------------- xcassets + Swift
RAW_COLORS = {
    "BrandNavy": "navy-900", "BrandMidnight": "navy-950", "BrandCyan": "cyan-400",
    "BrandDeepCyan": "cyan-600", "BrandOrange": "orange-500", "BrandDeepOrange": "orange-700",
}
SEMANTIC = {  # name: (light, dark)
    "BrandBackground": ("slate-50", "navy-900"),
    "BrandSurface": ("white", "navy-800"),
    "BrandBorder": ("slate-200", "navy-700"),
    "BrandText": ("navy-900", "white"),
    "BrandTextSecondary": ("slate-600", "slate-400"),
    "BrandAccent": ("cyan-600", "cyan-400"),
    "BrandOnAccent": ("white", "navy-900"),
    "BrandCTA": ("orange-500", "orange-500"),
    "BrandOnCTA": ("navy-900", "navy-900"),
    # System tint: white text sits on it (chat bubbles, prominent buttons), so both modes keep >= 4.5:1
    "AccentColor": ("cyan-600", "cyan-500"),
}
IMAGES = {  # name: (any/light file, dark file or None)
    "BrandMark": ("mark/clubhq-mark_color-light.svg", "mark/clubhq-mark_color-dark.svg"),
    "BrandMarkWhite": ("mark/clubhq-mark_white.svg", None),
    "BrandMarkOnNavy": ("mark/clubhq-mark_color-dark.svg", None),  # always white H, for navy tiles
    "BrandWordmark": ("wordmark/clubhq-wordmark_on-light.svg", "wordmark/clubhq-wordmark_on-dark.svg"),
    "BrandLockup": ("lockup-horizontal/clubhq-lockup-h_on-light.svg",
                    "lockup-horizontal/clubhq-lockup-h_on-dark.svg"),
    "BrandLockupStacked": ("lockup-stacked/clubhq-lockup-stacked_on-light.svg",
                           "lockup-stacked/clubhq-lockup-stacked_on-dark.svg"),
}
DARK = [{"appearance": "luminosity", "value": "dark"}]
INFO = {"author": "xcode", "version": 1}


def _color(hx):
    return {"color-space": "srgb", "components": {
        "red": f"0x{hx[1:3]}", "green": f"0x{hx[3:5]}", "blue": f"0x{hx[5:7]}", "alpha": "1.000"}}


def export_xcassets():
    root = KIT / "05-iOS" / "ClubHQBrand.xcassets"
    j(root / "Contents.json", {"info": INFO})
    for name, tok in RAW_COLORS.items():
        j(root / "Colors" / f"{name}.colorset" / "Contents.json",
          {"colors": [{"color": _color(bb.PAL[tok]), "idiom": "universal"}], "info": INFO})
    for name, (lt, dk) in SEMANTIC.items():
        folder = root if name == "AccentColor" else root / "Colors"
        j(folder / f"{name}.colorset" / "Contents.json", {"colors": [
            {"color": _color(bb.PAL[lt]), "idiom": "universal"},
            {"appearances": DARK, "color": _color(bb.PAL[dk]), "idiom": "universal"},
        ], "info": INFO})
    j(root / "Colors" / "Contents.json", {"info": INFO})
    j(root / "Logos" / "Contents.json", {"info": INFO})
    for name, (lt, dk) in IMAGES.items():
        folder = root / "Logos" / f"{name}.imageset"
        folder.mkdir(parents=True, exist_ok=True)
        imgs = []
        for src, app, fn in ((lt, None, "light.svg"), (dk, DARK, "dark.svg")):
            if not src:
                continue
            # short names: imageset paths get deep enough to hit Windows' 260-char limit
            (folder / fn).write_bytes((KIT / "01-Logo" / src).read_bytes())
            entry = {"filename": fn, "idiom": "universal"}
            if app:
                entry = {"appearances": app, **entry}
            imgs.append(entry)
        j(folder / "Contents.json", {"images": imgs, "info": INFO,
                                     "properties": {"preserves-vector-representation": True}})
    (KIT / "05-iOS" / "BrandTheme.swift").write_text(SWIFT, encoding="utf-8")


SWIFT = '''import SwiftUI

// ClubHQ brand palette and logos. Values live in ClubHQBrand.xcassets, and the
// semantic colors switch between light and dark mode automatically.
extension Color {
    enum Brand {
        // Semantic: use these in views
        static let background = Color("BrandBackground")
        static let surface = Color("BrandSurface")
        static let border = Color("BrandBorder")
        static let text = Color("BrandText")
        static let textSecondary = Color("BrandTextSecondary")
        static let accent = Color("BrandAccent")
        static let onAccent = Color("BrandOnAccent")
        static let cta = Color("BrandCTA")
        static let onCTA = Color("BrandOnCTA")

        // Raw brand colors: illustrations, marketing moments
        static let navy = Color("BrandNavy")
        static let midnight = Color("BrandMidnight")
        static let cyan = Color("BrandCyan")
        static let deepCyan = Color("BrandDeepCyan")
        static let orange = Color("BrandOrange")
        static let deepOrange = Color("BrandDeepOrange")
    }
}

extension Image {
    enum Brand {
        static let mark = Image("BrandMark")
        static let markWhite = Image("BrandMarkWhite")
        static let markOnNavy = Image("BrandMarkOnNavy")
        static let wordmark = Image("BrandWordmark")
        static let lockup = Image("BrandLockup")
        static let lockupStacked = Image("BrandLockupStacked")
    }
}

/// Primary call-to-action: orange with a navy label (7.05:1 contrast).
struct BrandCTAButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color.Brand.onCTA)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(Color.Brand.cta, in: .rect(cornerRadius: 14))
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}
'''


# ---------------------------------------------------------------- 04 web
def rounded_icon_svg():
    svg = (KIT / "02-App-Icon" / "concepts" / "clubhq-icon_default.svg").read_text(encoding="utf-8")
    return svg.replace('<rect width="1024" height="1024" fill="url(#bg)"/>',
                       '<rect width="1024" height="1024" rx="230" fill="url(#bg)"/>')


def maskable_svg():
    mh = 380
    mw = bb.MARK_W * mh / bb.MARK_H
    c0, c1, c2 = bb.ICON_BG["default"]
    defs = (f'<radialGradient id="bg" cx="0.3" cy="0.15" r="1.1"><stop offset="0" stop-color="{c0}"/>'
            f'<stop offset="0.55" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></radialGradient>')
    mdefs, g, _ = bb.place_mark("color-dark", "m", (1024 - mw) / 2, (1024 - mh) / 2, mh)
    return bb.svg_doc("0 0 1024 1024", '<rect width="1024" height="1024" fill="url(#bg)"/>' + g,
                      defs + mdefs, "ClubHQ maskable icon")


def export_web():
    w = KIT / "04-Web"
    w.mkdir(exist_ok=True)
    fav = rounded_icon_svg()
    (w / "favicon.svg").write_text(fav, encoding="utf-8")
    big = png(fav, TMP / "fav-512.png", 512, 512)
    im = Image.open(big)
    im.save(w / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for s in (16, 32, 64):
        resized(big, w / f"favicon-{s}.png", s)
    resized(big, w / "icon-192.png", 192)
    im.save(w / "icon-512.png", optimize=True)
    resized(KIT / "02-App-Icon" / "AppIcon.appiconset" / "AppIcon-1024.png", w / "apple-touch-icon.png", 180)
    mk = png(maskable_svg(), TMP / "maskable.png", 512, 512)
    Image.open(mk).convert("RGB").save(w / "icon-512-maskable.png", optimize=True)
    j(w / "site.webmanifest", {
        "name": "ClubHQ", "short_name": "ClubHQ",
        "description": "The ad-free team app parents don't hate.",
        "start_url": "/", "display": "standalone",
        "background_color": bb.PAL["navy-900"], "theme_color": bb.PAL["navy-900"],
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    })
    lockup = (KIT / "01-Logo" / "lockup-horizontal" / "clubhq-lockup-h_on-dark.svg").read_text(encoding="utf-8")
    og = OG_HTML.replace("{{LOCKUP}}", lockup)
    out = png(og, w / "og-image.png", 1200, 630, suffix=".html", wait=True)
    Image.open(out).convert("RGB").save(out, optimize=True)
    (w / "brand.css").write_text(brand_css(), encoding="utf-8")
    (w / "head-snippet.html").write_text(HEAD_SNIPPET, encoding="utf-8")
    for f in ("logo-on-dark.svg", "logo-on-light.svg"):
        src = "on-dark" if "dark" in f else "on-light"
        (w / f).write_bytes(
            (KIT / "01-Logo" / "lockup-horizontal" / f"clubhq-lockup-h_{src}.svg").read_bytes())


OG_HTML = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700&family=Inter:wght@500&display=block" rel="stylesheet">
<style>html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:radial-gradient(circle at 15% 0%,#1A4280 0%,#0B1E3A 55%,#06122A 100%);
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;color:#fff}
.logo svg{width:560px;height:auto;display:block}
h1{font:700 60px/1.1 Outfit,sans-serif;margin:0;letter-spacing:-.01em;text-align:center}
p{font:500 24px Inter,sans-serif;color:#9AAAC2;margin:0}
p b{color:#FF8A00;font-weight:500}
.bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#00C2FF,#0A86FF 60%,#FF8A00)}
</style></head><body><div class="logo">{{LOCKUP}}</div>
<h1>The ad-free team app<br>parents don't hate.</h1>
<p>Schedules · RSVPs · Team chat · Dues <b>·</b> Free for families</p><div class="bar"></div></body></html>"""


def brand_css():
    v = "\n".join(f"  --chq-{t}: {h};" for t, h, *_ in bb.PALETTE)

    def sem(mode):
        m = {"background": "slate-50", "surface": "white", "border": "slate-200", "text": "navy-900",
             "text-secondary": "slate-600", "accent": "cyan-600", "on-accent": "white",
             "cta": "orange-500", "on-cta": "navy-900"} if mode == "light" else {
            "background": "navy-900", "surface": "navy-800", "border": "navy-700", "text": "white",
            "text-secondary": "slate-400", "accent": "cyan-400", "on-accent": "navy-900",
            "cta": "orange-500", "on-cta": "navy-900"}
        return "\n".join(f"  --{k}: var(--chq-{t});" for k, t in m.items())

    return f"""/* ClubHQ brand tokens. Generated by _source/export_assets.py. Don't hand-edit. */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap");

:root {{
{v}
  --font-display: "Outfit", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --radius: 14px;
  color-scheme: light dark;
{sem("light")}
}}

@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
{sem("dark")}
  }}
}}
:root[data-theme="dark"] {{
{sem("dark")}
}}

body {{ background: var(--background); color: var(--text); font-family: var(--font-body); }}
h1, h2, h3, .display {{ font-family: var(--font-display); letter-spacing: -0.01em; }}
a {{ color: var(--accent); }}
.btn-cta {{ background: var(--cta); color: var(--on-cta); border-radius: var(--radius);
  font: 600 1rem/1 var(--font-body); padding: 0.9rem 1.4rem; border: 0; }}
"""


HEAD_SNIPPET = """<!-- ClubHQ brand: paste into <head> on every page -->
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0B1E3A">
<link rel="stylesheet" href="/brand.css">

<meta property="og:type" content="website">
<meta property="og:site_name" content="ClubHQ">
<meta property="og:title" content="ClubHQ: the ad-free team app parents don't hate">
<meta property="og:description" content="Schedules, RSVPs, team chat and dues in one ad-free app. Free for families.">
<meta property="og:image" content="https://teamclubhq.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<!-- Smart App Banner: uncomment once ClubHQ Team is live on the App Store (Apple ID 6822555956) -->
<!-- <meta name="apple-itunes-app" content="app-id=6822555956"> -->
"""


# ---------------------------------------------------------------- checkpoint 2
def data_uri(path, max_side=None):
    im = Image.open(path)
    if max_side and max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def svg_uri(path):
    return bb.b64(Path(path).read_text(encoding="utf-8"))


def human(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def review():
    aset = KIT / "02-App-Icon" / "AppIcon.appiconset"
    icons = [(data_uri(aset / f, 360), lbl) for f, lbl in
             [("AppIcon-1024.png", "Default"), ("AppIcon-1024-dark.png", "Dark"),
              ("AppIcon-1024-tinted.png", "Tinted source (iOS applies the tint)")]]
    layers = [(svg_uri(p), p.stem) for p in sorted((KIT / "02-App-Icon" / "icon-composer-layers").glob("*.svg"))]
    web = KIT / "04-Web"
    fav16, fav32 = data_uri(web / "favicon-16.png"), data_uri(web / "favicon-32.png")
    og = data_uri(web / "og-image.png", 1200)
    mask = data_uri(web / "icon-512-maskable.png", 256)
    touch = data_uri(web / "apple-touch-icon.png")
    lock_l = svg_uri(KIT / "01-Logo" / "lockup-horizontal" / "clubhq-lockup-h_on-light.svg")
    lock_d = svg_uri(KIT / "01-Logo" / "lockup-horizontal" / "clubhq-lockup-h_on-dark.svg")
    mark_png = data_uri(KIT / "01-Logo" / "png" / "clubhq-mark_color-dark.png", 600)

    groups = {}
    for p in sorted(KIT.rglob("*")):
        if p.is_file() and not p.relative_to(KIT).parts[0] in ("_source", "00-Review"):
            top = p.relative_to(KIT).parts[0]
            groups.setdefault(top, []).append(p)
    inv = "".join(
        f"<details><summary><b>{g}</b> · {len(fs)} files · {human(sum(f.stat().st_size for f in fs))}</summary><ul>"
        + "".join(f"<li><code>{f.relative_to(KIT).as_posix()}</code> <span>{human(f.stat().st_size)}</span></li>" for f in fs)
        + "</ul></details>" for g, fs in groups.items())

    def appmock(mode):
        P = bb.PAL
        c = ({"bg": P["slate-50"], "sf": P["white"], "bd": P["slate-200"], "tx": P["navy-900"],
              "t2": P["slate-600"], "ac": P["cyan-600"], "logo": lock_l} if mode == "light" else
             {"bg": P["navy-900"], "sf": P["navy-800"], "bd": P["navy-700"], "tx": P["white"],
              "t2": P["slate-400"], "ac": P["cyan-400"], "logo": lock_d})
        ev = lambda day, t, title, place: (
            f'<div class="ev" style="background:{c["sf"]};border-color:{c["bd"]}">'
            f'<div class="d" style="color:{c["ac"]}">{day}</div><div><b style="color:{c["tx"]}">{title}</b>'
            f'<div style="color:{c["t2"]}">{t} · {place}</div></div></div>')
        return (f'<div class="phone"><div class="scr" style="background:{c["bg"]}">'
                f'<img class="nav" src="{c["logo"]}" alt="">'
                f'<div class="h" style="color:{c["tx"]}">This week</div>'
                f'{ev("SAT", "9:00 AM", "U10 Hawks vs Lions", "Field 3")}'
                f'{ev("TUE", "5:30 PM", "Practice", "Riverside Park")}'
                f'<div class="lnk" style="color:{c["ac"]}">View full schedule</div>'
                f'<div class="cta">RSVP: Going</div>'
                f'<div class="tab" style="border-color:{c["bd"]};color:{c["t2"]}"><span style="color:{c["ac"]}">●<br>Home</span>'
                f'<span>●<br>Schedule</span><span>●<br>Chat</span><span>●<br>Team</span></div></div></div>')

    swatch = "".join(
        f'<div class="cs"><i style="background:{bb.PAL[lt]}"></i><i style="background:{bb.PAL[dk]}"></i>'
        f'<code>{n}</code></div>' for n, (lt, dk) in SEMANTIC.items())

    html = REVIEW.format(
        today=f"{date.today():%B %d, %Y}",
        icons="".join(f'<figure><img class="ic" src="{u}" alt=""><figcaption>{l}</figcaption></figure>' for u, l in icons),
        layers="".join(f'<figure><img class="ly" src="{u}" alt=""><figcaption>{l}.svg</figcaption></figure>' for u, l in layers),
        fav16=fav16, fav32=fav32, og=og, mask=mask, touch=touch, mark_png=mark_png,
        light=appmock("light"), dark=appmock("dark"), swatch=swatch, inv=inv)
    (KIT / "00-Review" / "checkpoint-2.html").write_text(html, encoding="utf-8")


REVIEW = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ClubHQ Checkpoint 2</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{{--bg:#081428;--panel:#0F213F;--line:#21406E;--text:#F2F6FC;--muted:#9AAAC2;--cyan:#00C2FF;--orange:#FF8A00}}
*{{box-sizing:border-box}}html,body{{margin:0}}
body{{background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:40px 16px 80px}}
h1,h2,h3{{font-family:Outfit,Inter,sans-serif;margin:0}}h1{{font-size:clamp(28px,4vw,40px)}}h2{{font-size:24px;margin-bottom:6px}}h3{{font-size:16px}}
.eyebrow{{font:600 12px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}}
.lede,.sub{{color:var(--muted);max-width:780px}}section{{margin-top:52px}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}}
.row{{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end}}
figure{{margin:0;text-align:center}}figcaption{{font-size:12px;color:var(--muted);margin-top:8px;max-width:200px}}
.ic{{width:180px;height:180px;border-radius:22.37%;display:block}}
.ly{{width:150px;height:150px;display:block;border-radius:12px;background:repeating-conic-gradient(#1b2d4d 0 25%,#13243f 0 50%) 0 0/20px 20px}}
.tabbar{{display:flex;gap:8px;align-items:center;background:#202124;border-radius:10px 10px 0 0;padding:8px 10px 0;max-width:520px}}
.tabx{{display:flex;gap:8px;align-items:center;background:#35363a;color:#e8eaed;font-size:13px;padding:8px 14px;border-radius:8px 8px 0 0}}
.tabx.l{{background:#fff;color:#202124}}
.og{{width:100%;max-width:600px;border-radius:12px;display:block;border:1px solid var(--line)}}
.phones{{display:flex;gap:24px;flex-wrap:wrap}}
.phone{{width:290px;height:580px;border-radius:44px;padding:12px;background:#000;box-shadow:0 0 0 2px #2a3b58}}
.scr{{height:100%;border-radius:34px;padding:54px 16px 0;position:relative;overflow:hidden;font-size:13px}}
.nav{{height:30px;display:block;margin:0 0 18px -6px}}
.h{{font:700 26px Outfit;margin-bottom:12px}}
.ev{{display:flex;gap:14px;align-items:center;border:1px solid;border-radius:14px;padding:12px;margin-bottom:10px}}
.ev .d{{font:700 13px Outfit;letter-spacing:.06em;width:34px}}
.lnk{{font-weight:600;margin:12px 0 16px}}
.cta{{background:#FF8A00;color:#0B1E3A;font-weight:700;text-align:center;border-radius:14px;padding:13px}}
.tab{{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-around;border-top:1px solid;padding:10px 0 24px;font-size:10px;text-align:center}}
.cs{{display:flex;align-items:center;gap:6px;font-size:12px}}.cs i{{width:26px;height:26px;border-radius:7px;border:1px solid var(--line)}}
.csg{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:14px}}
details{{border-bottom:1px solid var(--line);padding:10px 0}}summary{{cursor:pointer}}
details li{{font-size:13px}}details code{{color:var(--cyan)}}details span{{color:var(--muted);font-size:12px}}
.g2{{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}}@media(max-width:700px){{.g2{{grid-template-columns:1fr}}}}
.q{{border-left:3px solid var(--orange)}} li{{margin:6px 0}}
</style></head><body><div class="wrap">
<div class="eyebrow">ClubHQ rebrand · Checkpoint 2 of 3 · {today}</div>
<h1>Production assets: icon, iOS kit, web kit</h1>
<p class="lede">Everything from checkpoint 1, now exported in the formats Xcode, your website and Illustrator need.
The gaps between H, Q and arrow are now real cut-out shapes instead of masks, so the files edit cleanly in Illustrator
and import cleanly into Icon Composer.</p>

<section><h2>iOS app icon</h2>
<p class="sub"><code>02-App-Icon/AppIcon.appiconset</code> drops straight into Xcode, with default, dark and tinted variants.
The opaque 1024px PNG for App Store Connect is in <code>app-store/</code>.</p>
<div class="card"><div class="row">{icons}</div></div>
<h3 style="margin-top:28px">Icon Composer layers (optional Liquid Glass upgrade)</h3>
<p class="sub">Three shapes on a shared 1024px canvas. Step-by-step instructions are in <code>icon-composer-layers/README.md</code>.</p>
<div class="card"><div class="row">{layers}</div></div>
</section>

<section><h2>In-app kit</h2>
<p class="sub"><code>05-iOS/ClubHQBrand.xcassets</code> holds 16 colors and 5 vector logos, each switching automatically between light and dark mode.
<code>BrandTheme.swift</code> exposes them as <code>Color.Brand.*</code> and <code>Image.Brand.*</code>, plus an orange CTA button style.
This is how a ClubHQ screen will look:</p>
<div class="phones">{light}{dark}</div>
<h3 style="margin-top:28px">Semantic colors (light | dark)</h3>
<div class="csg">{swatch}</div>
</section>

<section><h2>Website kit</h2>
<p class="sub"><code>04-Web/</code> contains favicons (ICO, SVG, PNG), the Apple touch icon, PWA and maskable icons, <code>site.webmanifest</code>,
<code>brand.css</code> (tokens with automatic dark mode), a ready-to-paste <code>head-snippet.html</code>, and the link-preview image.</p>
<div class="g2">
<div class="card"><h3>Browser tab</h3><div style="margin-top:14px">
<div class="tabbar"><div class="tabx"><img src="{fav16}" width="16" height="16" alt="">ClubHQ: ad-free team app</div>
<div class="tabx l"><img src="{fav16}" width="16" height="16" alt="">ClubHQ</div></div></div>
<div class="row" style="margin-top:18px"><figure><img src="{fav32}" width="32" alt=""><figcaption>32px</figcaption></figure>
<figure><img src="{touch}" width="90" style="border-radius:20px" alt=""><figcaption>Apple touch icon</figcaption></figure>
<figure><img src="{mask}" width="90" style="border-radius:50%" alt=""><figcaption>Maskable (Android crop)</figcaption></figure></div></div>
<div class="card"><h3>Link preview (og-image.png, 1200×630)</h3>
<p class="sub" style="margin:4px 0 12px">What shows up when someone shares teamclubhq.com in iMessage, Facebook or Slack.</p>
<img class="og" src="{og}" alt=""></div>
</div></section>

<section><h2>Illustrator &amp; print</h2>
<p class="sub">Each of the 16 logo files now comes as SVG (editable), PDF (vector, opens in Illustrator and Acrobat) and transparent PNG (2048px).
<code>03-Color-Type/ClubHQ-swatches.ase</code> loads the palette into Illustrator: Swatches panel › Open Swatch Library › Other Library.</p>
<div class="card" style="text-align:center;background:repeating-conic-gradient(#1b2d4d 0 25%,#13243f 0 50%) 0 0/24px 24px">
<img src="{mark_png}" style="max-width:420px;width:100%" alt=""><div style="font-size:12px;color:var(--muted)">Transparent PNG on a checkerboard</div></div>
</section>

<section><h2>Next: Phase 3</h2>
<div class="g2">
<div class="card"><h3>What I'll build</h3><ul>
<li><b>Facebook:</b> profile picture, cover photo with mobile and desktop safe zones, post and story templates, event cover</li>
<li><b>Instagram:</b> profile picture, 4:5 feed post templates, story and Reel cover templates, highlight covers</li>
<li><b>TikTok:</b> profile picture, video cover template, and on-screen safe-zone guides</li>
<li>Six launch posts, each written in your voice for all three platforms</li>
<li>App Store screenshot frames, built from your existing app screens</li>
<li><code>HANDOFF-iOS.md</code> and <code>HANDOFF-Site.md</code>, written for Claude Code in Xcode</li>
</ul></div>
<div class="card q"><h3>Check before approving</h3><ul>
<li>Do the light and dark app mockups match the feel you want in the app?</li>
<li>Is the link preview's wording right?</li>
<li>Do you have your App Store app ID? It goes in the head snippet's <code>apple-itunes-app</code> tag. If not, I'll leave a placeholder.</li>
</ul></div></div></section>

<section><h2>Files</h2><div class="card">{inv}</div></section>
</div></body></html>"""


if __name__ == "__main__":
    steps = [("logos", export_logos), ("swatches", export_swatches), ("icons", export_icons),
             ("xcassets", export_xcassets), ("web", export_web), ("review", review)]
    for name, fn in steps:
        fn()
        print("done:", name)
