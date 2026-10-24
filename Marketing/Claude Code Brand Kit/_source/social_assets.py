"""ClubHQ brand kit — Phase 3: Facebook, Instagram, TikTok and App Store art.

App screenshots come from _source/screens/ (1320x2868, iPhone 6.9"). After the
in-app rebrand, recapture them and re-run this script so the posts show the new UI:

    python social_assets.py
"""
import base64
from pathlib import Path

from PIL import Image

import build_brand as bb
from export_assets import png

KIT = bb.KIT
SCREENS = KIT / "_source" / "screens"
SOC = KIT / "06-Social"
STORE = KIT / "07-App-Store"

FONTS = ('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700'
         '&family=Outfit:wght@600;700;800&display=block" rel="stylesheet">')


def uri(path):
    mime = "image/png" if str(path).endswith(".png") else "image/svg+xml"
    return f"data:{mime};base64," + base64.b64encode(Path(path).read_bytes()).decode()


def svg_inline(rel):
    return (KIT / "01-Logo" / rel).read_text(encoding="utf-8")


LOCKUP = svg_inline("lockup-horizontal/clubhq-lockup-h_on-dark.svg")
MARK = svg_inline("mark/clubhq-mark_color-dark.svg")
ICON = uri(KIT / "02-App-Icon" / "AppIcon.appiconset" / "AppIcon-1024.png")
SWOOSH = (f'<svg class="swoosh" viewBox="230 300 560 420" xmlns="http://www.w3.org/2000/svg">'
          f'<path d="{bb.ARROW}" fill="#FF8A00"/></svg>')

CSS = """
*{box-sizing:border-box}
html,body{margin:0;width:__W__px;height:__H__px;overflow:hidden}
body{position:relative;color:#fff;font-family:Inter,sans-serif;
background:radial-gradient(circle at 18% 0%,#1A4280 0%,#0B1E3A 50%,#06122A 100%)}
.h{font-family:Outfit,sans-serif;font-weight:800;line-height:1.02;letter-spacing:-.02em;margin:0}
.c{color:#00C2FF}.o{color:#FF8A00}
.sub{font-weight:500;line-height:1.38;color:#B7C4D8;margin:0}
.abs{position:absolute}
.logo svg{height:100%;width:auto;display:block}
.mark svg{width:100%;height:auto;display:block}
.phone{position:absolute;background:#04060A;box-shadow:0 40px 120px rgba(0,0,0,.55),0 0 0 3px #22324f}
.phone img{display:block;width:100%}
.island{position:absolute;left:50%;transform:translateX(-50%);background:#000}
.swoosh{position:absolute;opacity:.08}
.pill{display:inline-block;border-radius:999px;font-weight:700}
.center{text-align:center;left:0;right:0}
"""


def page(w, h, body, transparent=False):
    css = CSS.replace("__W__", str(w)).replace("__H__", str(h))
    if transparent:
        css += "body{background:none!important}"
    return f"<!doctype html><html><head><meta charset=utf-8>{FONTS}<style>{css}</style></head><body>{body}</body></html>"


def render(html, out, w, h):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    png(html, out, w, h, suffix=".html", wait=True)
    im = Image.open(out)
    if im.mode == "RGBA" and im.getextrema()[3][0] == 255:
        im.convert("RGB").save(out, optimize=True)  # opaque art: drop the alpha channel


def phone(shot, x, y, w, inline=False):
    bez, r = w * 0.034, w * 0.165
    pos = "position:relative;flex:none" if inline else f"left:{x}px;top:{y}px"
    return (f'<div class="phone" style="{pos};width:{w}px;padding:{bez:.0f}px;border-radius:{r:.0f}px">'
            f'<img src="{uri(SCREENS / shot)}" style="border-radius:{r - bez:.0f}px">'
            f'<div class="island" style="top:{bez + w * 0.028:.0f}px;width:{w * 0.27:.0f}px;'
            f'height:{w * 0.078:.0f}px;border-radius:{w:.0f}px"></div></div>')


def logo(x, y, h, center=False):
    pos = f"left:0;right:0;display:flex;justify-content:center" if center else f"left:{x}px"
    return f'<div class="abs logo" style="{pos};top:{y}px;height:{h}px">{LOCKUP}</div>'


def swoosh(x, y, w):
    return SWOOSH.replace('class="swoosh"', f'class="swoosh" style="left:{x}px;top:{y}px;width:{w}px"')


# ---------------------------------------------------------------- launch posts
POSTS = [
    {"slug": "01-meet-the-new-clubhq", "kind": "reveal",
     "head": 'Meet the new <span class="c">ClubHQ</span>.',
     "sub": "Same ad-free team app. Fresh new look."},
    {"slug": "02-one-family-calendar", "kind": "feature", "shot": "1-parent-home.png",
     "head": 'Every kid. Every team. <span class="c">One calendar.</span>',
     "sub": "All your kids' practices and games in one place. RSVP in a tap."},
    {"slug": "03-safe-team-chat", "kind": "feature", "shot": "5-chat.png",
     "head": 'Team chat that\'s <span class="c">actually safe.</span>',
     "sub": "Coaches and parents see team conversations. Players never get private adult messages."},
    {"slug": "04-dues-without-chasing", "kind": "feature", "shot": "7-dues.png",
     "head": 'Dues without <span class="o">the chasing.</span>',
     "sub": "Request fees, see who's paid, and let families pay with Venmo or Cash App."},
    {"slug": "05-built-for-coaches", "kind": "feature", "shot": "2-coach-home.png",
     "head": 'Set up your team <span class="c">in minutes.</span>',
     "sub": "One invite link and every family is in."},
    {"slug": "06-no-ads-ever", "kind": "cta",
     "head": 'No ads.<br><span class="o">Ever.</span>',
     "sub": "Free for families. Built for coaches."},
]


def feed(p):
    W, H = 1080, 1350
    if p["kind"] == "reveal":
        body = (swoosh(-80, 760, 900) +
                f'<div class="abs mark" style="left:240px;top:250px;width:600px">{MARK}</div>'
                f'<h1 class="h abs center" style="top:780px;font-size:96px">{p["head"]}</h1>'
                f'<p class="sub abs center" style="top:910px;font-size:38px">{p["sub"]}</p>'
                f'<div class="abs center" style="top:1180px;font:600 26px Inter;color:#6F84A3;letter-spacing:.12em">TEAMCLUBHQ.COM</div>')
    elif p["kind"] == "cta":
        body = (swoosh(380, 700, 900) + logo(80, 80, 56) +
                f'<img class="abs" src="{ICON}" style="left:80px;top:300px;width:220px;border-radius:50px;box-shadow:0 20px 60px rgba(0,0,0,.5)">'
                f'<h1 class="h abs" style="left:80px;top:580px;font-size:190px">{p["head"]}</h1>'
                f'<p class="sub abs" style="left:80px;top:1000px;font-size:40px">{p["sub"]}</p>'
                f'<div class="abs pill" style="left:80px;top:1120px;background:#FF8A00;color:#0B1E3A;font-size:32px;padding:22px 36px">'
                f'Search “ClubHQ Team” on the App Store</div>')
    else:
        body = swoosh(500, 380, 760) + stack(80, 80, 80, 56, 90, 34, p, 560)
    return page(W, H, body)


def stack(left, top, right, logo_h, head_px, sub_px, p, phone_w):
    """Logo, headline, subline and phone in normal flow, so long headlines push
    everything down instead of overlapping."""
    return (f'<div class="abs" style="left:{left}px;top:{top}px;right:{right}px;bottom:0;'
            f'display:flex;flex-direction:column">'
            f'<div class="logo" style="height:{logo_h}px">{LOCKUP}</div>'
            f'<h1 class="h" style="margin-top:{logo_h}px;font-size:{head_px}px">{p["head"]}</h1>'
            f'<p class="sub" style="margin-top:24px;font-size:{sub_px}px">{p["sub"]}</p>'
            f'<div style="margin-top:56px;align-self:center">{phone(p["shot"], 0, 0, phone_w, inline=True)}</div>'
            f'</div>')


def vertical(p):
    """1080x1920 for Instagram/Facebook Stories, the Reel cover and the TikTok cover.
    Text stays inside every platform's safe zone (top 260, bottom 500, right 170)."""
    W, H = 1080, 1920
    if p["kind"] == "reveal":
        body = (swoosh(-100, 1100, 1000) +
                f'<div class="abs mark" style="left:220px;top:520px;width:640px">{MARK}</div>'
                f'<h1 class="h abs center" style="top:1060px;font-size:100px;padding:0 90px">{p["head"]}</h1>'
                f'<p class="sub abs center" style="top:1300px;font-size:40px;padding:0 120px">{p["sub"]}</p>')
    elif p["kind"] == "cta":
        body = (swoosh(300, 1100, 1000) + logo(90, 280, 60) +
                f'<img class="abs" src="{ICON}" style="left:90px;top:460px;width:240px;border-radius:54px;box-shadow:0 20px 60px rgba(0,0,0,.5)">'
                f'<h1 class="h abs" style="left:90px;top:780px;font-size:200px">{p["head"]}</h1>'
                f'<p class="sub abs" style="left:90px;top:1220px;font-size:42px;width:800px">{p["sub"]}</p>'
                f'<div class="abs pill" style="left:90px;top:1330px;background:#FF8A00;color:#0B1E3A;font-size:32px;padding:22px 34px">'
                f'Search “ClubHQ Team” on the App Store</div>')
    else:
        body = swoosh(480, 640, 760) + stack(90, 280, 170, 60, 96, 38, p, 620)
    return page(W, H, body)


# ---------------------------------------------------------------- profile & covers
def profile():
    return page(1080, 1080, f'<div class="abs mark" style="left:190px;top:310px;width:700px">{MARK}</div>')


def fb_cover():
    # 1640x624 upload. Mobile crops to roughly the centre 1100px, so content stays there.
    return page(1640, 624, swoosh(1050, 120, 520) + swoosh(-60, 200, 420) +
                '<div class="abs center" style="top:150px;height:150px;display:flex;justify-content:center">'
                f'<div class="logo" style="height:150px">{LOCKUP}</div></div>'
                '<p class="h abs center" style="top:350px;font-size:58px;font-weight:700">The ad-free team app parents don\'t hate.</p>'
                '<p class="sub abs center" style="top:440px;font-size:28px">Schedules · RSVPs · Team chat · Dues · Free for families</p>')


def fb_event():
    return page(1920, 1005, swoosh(1180, 260, 700) +
                '<div class="abs center" style="top:300px;display:flex;justify-content:center">'
                f'<div class="logo" style="height:190px">{LOCKUP}</div></div>'
                '<p class="h abs center" style="top:560px;font-size:68px;font-weight:700">The ad-free team app parents don\'t hate.</p>')


HIGHLIGHTS = {
    "schedule": ('<rect x="20" y="30" width="160" height="150" rx="26" fill="none" stroke="#00C2FF" stroke-width="16"/>'
                 '<path d="M20 78h160" stroke="#00C2FF" stroke-width="16"/><path d="M60 14v34M140 14v34" stroke="#00C2FF" stroke-width="16" stroke-linecap="round"/>'
                 '<path d="M66 128l24 22 46-48" fill="none" stroke="#FF8A00" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>'),
    "chat": ('<path d="M30 40h140a20 20 0 0 1 20 20v70a20 20 0 0 1-20 20H90l-40 34v-34H30a20 20 0 0 1-20-20V60a20 20 0 0 1 20-20z" fill="none" stroke="#00C2FF" stroke-width="16" stroke-linejoin="round"/>'
             '<circle cx="62" cy="95" r="11" fill="#FF8A00"/><circle cx="100" cy="95" r="11" fill="#FF8A00"/><circle cx="138" cy="95" r="11" fill="#FF8A00"/>'),
    "dues": ('<circle cx="100" cy="100" r="82" fill="none" stroke="#00C2FF" stroke-width="16"/>'
             '<text x="100" y="138" text-anchor="middle" font-family="Outfit" font-weight="800" font-size="112" fill="#FF8A00">$</text>'),
    "coaches": ('<rect x="40" y="34" width="120" height="150" rx="18" fill="none" stroke="#00C2FF" stroke-width="16"/>'
                '<rect x="72" y="18" width="56" height="32" rx="10" fill="#0B1E3A" stroke="#00C2FF" stroke-width="14"/>'
                '<path d="M70 92h60M70 124h60M70 156h34" stroke="#FF8A00" stroke-width="16" stroke-linecap="round"/>'),
    "help": ('<circle cx="100" cy="100" r="82" fill="none" stroke="#00C2FF" stroke-width="16"/>'
             '<text x="100" y="140" text-anchor="middle" font-family="Outfit" font-weight="800" font-size="116" fill="#FF8A00">?</text>'),
}


def highlight(glyph):
    return page(1080, 1920,
                '<div class="abs" style="left:240px;top:660px;width:600px;height:600px;border-radius:50%;'
                'background:radial-gradient(circle at 30% 20%,#1C3A68,#0B1E3A 70%);box-shadow:inset 0 0 0 6px #1C3A68"></div>'
                f'<svg class="abs" style="left:390px;top:810px;width:300px;height:300px" viewBox="0 0 200 200">{glyph}</svg>')


# ---------------------------------------------------------------- templates & safe zones
def template_feed():
    return page(1080, 1350, swoosh(500, 700, 760) + logo(80, 80, 56) +
                '<div class="abs" style="left:80px;bottom:80px;font:600 24px Inter;color:#6F84A3;letter-spacing:.12em">TEAMCLUBHQ.COM</div>')


def template_vertical():
    return page(1080, 1920, swoosh(480, 900, 760) + logo(90, 280, 60))


def zones(w, h, rects, note, circle=False):
    """Transparent overlay PNG: lay it on top of a design to check nothing important
    sits under the platform's UI. Drawn with Pillow so the alpha is exact."""
    from PIL import ImageDraw, ImageFont

    def font(px):
        try:
            return ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", px)
        except OSError:
            return ImageFont.load_default()

    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    red = (255, 45, 85, 90)
    if circle:
        mask = Image.new("L", (w, h), 255)
        ImageDraw.Draw(mask).ellipse((0, 0, w - 1, h - 1), fill=0)
        im.paste(Image.new("RGBA", (w, h), red), mask=mask)
    d = ImageDraw.Draw(im)
    for x, y, rw, rh, label in rects:
        d.rectangle((x, y, x + rw - 1, y + rh - 1), fill=red, outline=(255, 255, 255, 200), width=3)
        if label:
            d.multiline_text((x + rw / 2, y + rh / 2), label, font=font(30), fill="white", anchor="mm", align="center")
    d.text((w / 2, h - 30), note, font=font(26), fill="white", anchor="mm",
           stroke_width=3, stroke_fill=(0, 0, 0, 255))
    return im


SAFE = {
    "story-reel-tiktok_1080x1920": (1080, 1920, [
        (0, 0, 1080, 250, "Top 250px: profile name & progress bar"),
        (0, 1420, 1080, 500, "Bottom 500px: caption, music, reply bar"),
        (910, 250, 170, 1170, "TikTok\nbuttons"),
    ], "Keep text in the clear area. Reel/TikTok grid shows the centre 1080x1440", False),
    "feed-post_1080x1350": (1080, 1350, [(0, 0, 40, 1350, ""), (1040, 0, 40, 1350, "")],
                            "Instagram's 3:4 profile grid trims about 34px from each side", False),
    "facebook-cover_1640x624": (1640, 624, [(0, 0, 270, 624, "Cropped\non phones"),
                                            (1370, 0, 270, 624, "Cropped\non phones")],
                                "Phones show the centre ~1100px. Keep logo & text inside it", False),
    "profile-picture_1080x1080": (1080, 1080, [], "Shown as a circle on all three platforms", True),
}


# ---------------------------------------------------------------- App Store
STORE_SHOTS = [
    ("1-parent-home.png", 'Every kid. Every team.<br><span class="c">One calendar.</span>'),
    ("2-coach-home.png", 'Run your team<br><span class="c">in minutes.</span>'),
    ("3-event.png", 'RSVPs in<br><span class="o">one tap.</span>'),
    ("4-schedule.png", 'The whole season,<br><span class="c">always up to date.</span>'),
    ("5-chat.png", 'Team chat that\'s<br><span class="c">safe for kids.</span>'),
    ("6-team.png", 'Your whole team<br><span class="c">in one place.</span>'),
]


def store_frame(shot, head):
    return page(1320, 2868, swoosh(700, 380, 900) +
                f'<h1 class="h abs center" style="top:230px;font-size:124px">{head}</h1>'
                + phone(shot, 150, 640, 1020))


# ---------------------------------------------------------------- checkpoint 3
def thumb(path, h, overlay=None):
    import io
    im = Image.open(path).convert("RGBA")
    if overlay:
        im.alpha_composite(Image.open(overlay).convert("RGBA"))
    im = im.convert("RGB")
    im.thumbnail((h * 3, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=86)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def review():
    def fig(path, h, cap, cls="", overlay=None):
        return (f'<figure><img class="{cls}" src="{thumb(path, h * 2, overlay)}" style="height:{h}px" alt="">'
                f"<figcaption>{cap}</figcaption></figure>")

    posts = "".join(
        f'<div class="post"><div class="row">{fig(SOC / "launch-posts" / p["slug"] / "feed_1080x1350.png", 250, "Feed 4:5")}'
        f'{fig(SOC / "launch-posts" / p["slug"] / "story-reel-tiktok_1080x1920.png", 250, "Story / Reel / TikTok")}</div>'
        f'<div class="pt">{p["slug"][:2]} · {p["slug"][3:].replace("-", " ").capitalize()}'
        f'{"" if p["kind"] != "feature" else " <span class=hold>needs 1.0.1 screenshot</span>"}'
        f'{"" if p["kind"] == "feature" else " <span class=ok>ready</span>"}</div></div>' for p in POSTS)
    hl = "".join(fig(f, 200, f.stem.split("_")[0].capitalize(), "hl")
                 for f in sorted((SOC / "instagram" / "highlight-covers").glob("*.png")))
    store = "".join(fig(f, 330, f.stem[3:].replace("-", " ").capitalize())
                    for f in sorted((STORE / "iphone-6.9_1320x2868").glob("*.png")))
    sz = SOC / "safe-zones"
    first_story = SOC / "launch-posts" / POSTS[1]["slug"] / "story-reel-tiktok_1080x1920.png"
    html = REVIEW3.format(
        profile=fig(SOC / "profile-picture_1080x1080.png", 170, "Profile picture (all 3)", "round"),
        cover=fig(SOC / "facebook" / "cover_1640x624.png", 170, "Facebook cover 1640×624"),
        event=fig(SOC / "facebook" / "event-cover_1920x1005.png", 170, "Facebook event cover 1920×1005"),
        cover_zone=fig(SOC / "facebook" / "cover_1640x624.png", 170, "Cover + phone-crop guide",
                       overlay=sz / "facebook-cover_1640x624.png"),
        story_zone=fig(first_story, 330, "Story + safe-zone guide", overlay=sz / "story-reel-tiktok_1080x1920.png"),
        posts=posts, hl=hl, store=store)
    (KIT / "00-Review" / "checkpoint-3.html").write_text(html, encoding="utf-8")


REVIEW3 = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ClubHQ Checkpoint 3</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{{--bg:#081428;--panel:#0F213F;--line:#21406E;--text:#F2F6FC;--muted:#9AAAC2;--cyan:#00C2FF;--orange:#FF8A00}}
*{{box-sizing:border-box}}html,body{{margin:0}}
body{{background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,sans-serif}}
.wrap{{max-width:1180px;margin:0 auto;padding:40px 16px 80px}}
h1,h2,h3{{font-family:Outfit,Inter,sans-serif;margin:0}}h1{{font-size:clamp(28px,4vw,40px)}}h2{{font-size:24px;margin-bottom:6px}}h3{{font-size:16px}}
.eyebrow{{font:600 12px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}}
.lede,.sub{{color:var(--muted);max-width:800px}}section{{margin-top:52px}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}}
.row{{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end}}
figure{{margin:0}}figure img{{display:block;border-radius:10px;max-width:100%;object-fit:contain}}
figcaption{{font-size:12px;color:var(--muted);margin-top:6px}}
.round{{border-radius:50%!important}}.hl{{border-radius:14px!important}}
.posts{{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}}
.post{{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px}}
.pt{{margin-top:10px;font:600 14px Outfit}}
.hold{{font:600 11px Inter;color:#FFB020;background:rgba(255,176,32,.14);padding:2px 8px;border-radius:99px;margin-left:6px}}
.ok{{font:600 11px Inter;color:#2BD47D;background:rgba(43,212,125,.14);padding:2px 8px;border-radius:99px;margin-left:6px}}
.scroll{{overflow-x:auto}}
.g2{{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}}@media(max-width:760px){{.g2{{grid-template-columns:1fr}}}}
li{{margin:6px 0}}code{{color:var(--cyan)}}.q{{border-left:3px solid var(--orange)}}
</style></head><body><div class="wrap">
<div class="eyebrow">ClubHQ rebrand · Checkpoint 3 of 3 · final</div>
<h1>Social, App Store &amp; handoff</h1>
<p class="lede">Facebook, Instagram and TikTok are ready to rebrand today. The App Store and social posts that show the app
are framed and ready, but the phone screens still show the pre-rebrand blue UI. Re-run one script after 1.0.1 is built and they update.</p>

<section><h2>Profiles &amp; covers</h2>
<p class="sub">One profile picture for all three platforms, sized for the circle crop. The pink areas in the guide are hidden on phones.</p>
<div class="card scroll"><div class="row">{profile}{cover}{event}</div>
<div class="row" style="margin-top:18px">{cover_zone}</div></div></section>

<section><h2>Launch posts</h2>
<p class="sub">Six posts, each in feed (4:5) and vertical (9:16) formats. The vertical version works as an Instagram/Facebook Story, a Reel cover
and a TikTok cover. Captions for each platform are in <code>06-Social/launch-posts/CAPTIONS.md</code>.</p>
<div class="posts">{posts}</div></section>

<section><h2>Safe zones &amp; highlights</h2>
<div class="g2"><div class="card"><h3>Vertical safe zone</h3><p class="sub" style="margin:4px 0 12px">Text stays clear of the
profile bar, the caption area and TikTok's buttons. The overlay PNGs are in <code>06-Social/safe-zones/</code> for your own designs.</p>
<div class="row">{story_zone}</div></div>
<div class="card"><h3>Instagram Highlight covers</h3><div class="row" style="margin-top:12px">{hl}</div></div></div></section>

<section><h2>App Store screenshots (6.9", 1320×2868)</h2>
<div class="card scroll"><div class="row" style="flex-wrap:nowrap">{store}</div></div></section>

<section><h2>Handoff to Claude Code in Xcode</h2>
<div class="g2">
<div class="card"><h3><code>HANDOFF-iOS.md</code></h3><ul>
<li>Branch <code>rebrand-1.0.1</code>, version 1.0.1. Build 17 in review is left alone</li>
<li>New icon set, AccentColor, 15 colors and 6 logos merged into <code>Assets.xcassets</code></li>
<li><code>BrandTheme.swift</code>, plus a replacement <code>BrandMark</code> view, with the same API</li>
<li>Team colors and RSVP/dues state colors kept as they are</li>
<li>Decision D-040 logged, verification checklist, screenshot recapture, ship only on your go-ahead</li>
</ul></div>
<div class="card"><h3><code>HANDOFF-Site.md</code></h3><ul>
<li>New favicons, manifest and link-preview image. Old icon paths are overwritten in place</li>
<li>Head tags on all 9 pages, logo header on Privacy, Terms and Support</li>
<li><code>site.css</code> recolored: orange buttons with navy text, cyan links</li>
<li>Self-hosted Outfit + Inter, matching the privacy page's no-third-party promise</li>
<li>Deploy on 1.0.1 launch day, then refresh Facebook's link-preview cache</li>
</ul></div></div></section>

<section><h2>Before you hand off</h2>
<div class="card q"><ul>
<li><b>Accent tweak:</b> in dark mode the app's system tint is <code>#007CBF</code>, not bright cyan. Your own chat bubbles have white
text on the tint, and bright cyan would make that text hard to read. Bright cyan stays the brand color everywhere else.</li>
<li><b>App Store ID</b> 6822555956 (“ClubHQ Team”) came from the repo's docs. The Smart App Banner stays commented out until 1.0 is live.</li>
<li><b>Handles:</b> grab <code>@teamclubhq</code> on all three platforms, or <code>@clubhqteam</code> if it's taken.</li>
<li><b>Posts 02–05 and the App Store frames:</b> hold until the 1.0.1 screenshots are recaptured (post 04's current screen shows card payments, which are off in 1.0).</li>
</ul></div></section>
</div></body></html>"""


# ---------------------------------------------------------------- run
def main():
    for p in POSTS:
        d = SOC / "launch-posts" / p["slug"]
        render(feed(p), d / "feed_1080x1350.png", 1080, 1350)
        render(vertical(p), d / "story-reel-tiktok_1080x1920.png", 1080, 1920)
        print("post", p["slug"])
    render(profile(), SOC / "profile-picture_1080x1080.png", 1080, 1080)
    render(fb_cover(), SOC / "facebook" / "cover_1640x624.png", 1640, 624)
    render(fb_event(), SOC / "facebook" / "event-cover_1920x1005.png", 1920, 1005)
    for name, glyph in HIGHLIGHTS.items():
        render(highlight(glyph), SOC / "instagram" / "highlight-covers" / f"{name}_1080x1920.png", 1080, 1920)
    render(template_feed(), SOC / "templates" / "blank-feed_1080x1350.png", 1080, 1350)
    render(template_vertical(), SOC / "templates" / "blank-story-reel-tiktok_1080x1920.png", 1080, 1920)
    (SOC / "safe-zones").mkdir(parents=True, exist_ok=True)
    for name, (w, h, rects, note, circle) in SAFE.items():
        zones(w, h, rects, note, circle).save(SOC / "safe-zones" / f"{name}.png", optimize=True)
    print("profile, covers, highlights, templates, safe zones")
    for i, (shot, head) in enumerate(STORE_SHOTS, 1):
        render(store_frame(shot, head), STORE / "iphone-6.9_1320x2868" / f"{i:02d}-{Path(shot).stem[2:]}.png", 1320, 2868)
    print("app store")
    review()
    print("review")


if __name__ == "__main__":
    main()
