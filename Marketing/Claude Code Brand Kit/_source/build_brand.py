"""ClubHQ brand kit generator — vector masters.

Builds every vector master from geometry defined here, so the mark, wordmark,
lockups and icons stay mathematically consistent. Needs `shapely` (pip install
shapely). Re-run after any tweak, then run export_assets.py for PNG/PDF/etc:

    python build_brand.py
"""
import base64
import json
import math
from datetime import date
from pathlib import Path

KIT = Path(__file__).absolute().parent.parent  # not resolve(): it follows app-sandbox redirects


# ---------------------------------------------------------------- helpers
def n(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def P(p):
    return f"{n(p[0])} {n(p[1])}"


def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))


def rect(x, y, w, h):
    return f"M{n(x)} {n(y)}h{n(w)}v{n(h)}h{n(-w)}Z"


def ring(cx, cy, ro, ri):
    # outer clockwise, inner counter-clockwise -> hole under nonzero fill
    return (
        f"M{n(cx + ro)} {n(cy)}A{n(ro)} {n(ro)} 0 1 1 {n(cx - ro)} {n(cy)}"
        f"A{n(ro)} {n(ro)} 0 1 1 {n(cx + ro)} {n(cy)}Z"
        f"M{n(cx + ri)} {n(cy)}A{n(ri)} {n(ri)} 0 1 0 {n(cx - ri)} {n(cy)}"
        f"A{n(ri)} {n(ri)} 0 1 0 {n(cx + ri)} {n(cy)}Z"
    )


def sector(cx, cy, ro, ri, a1, a2):
    large = 1 if (a2 - a1) % 360 > 180 else 0
    p1, p2 = pt(cx, cy, ro, a1), pt(cx, cy, ro, a2)
    p3, p4 = pt(cx, cy, ri, a2), pt(cx, cy, ri, a1)
    return (
        f"M{P(p1)}A{n(ro)} {n(ro)} 0 {large} 1 {P(p2)}"
        f"L{P(p3)}A{n(ri)} {n(ri)} 0 {large} 0 {P(p4)}Z"
    )


def bar_pts(p0, p1, w):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * w / 2, dx / L * w / 2
    return [(p0[0] + nx, p0[1] + ny), (p1[0] + nx, p1[1] + ny),
            (p1[0] - nx, p1[1] - ny), (p0[0] - nx, p0[1] - ny)]


def poly(pts):
    return "M" + "L".join(P(p) for p in pts) + "Z"


def b64(svg):
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ---------------------------------------------------------------- the mark
# Designed on a 1024 grid. H (white) sits behind a Q ring (cyan) with a
# bubble-style tail; an orange swoosh arrow rises through the Q. Overlaps are
# separated by a knockout gap so it works on any background.
GAP = 17

H_PATH = rect(196, 300, 112, 400) + rect(308, 452, 104, 96) + rect(412, 300, 112, 400)

Q_C, Q_RO, Q_RI = (640, 500), 214, 120
Q_RING = ring(*Q_C, Q_RO, Q_RI)
Q_TAIL_PTS = bar_pts(pt(*Q_C, 167, 45), (840, 700), 96)  # short, so it reads as Q, not a magnifier
Q_TAIL = poly(Q_TAIL_PTS)


def _arrow():
    tip = (768, 322)
    d = (0.62, -0.785)
    L = math.hypot(*d)
    d = (d[0] / L, d[1] / L)
    nv = (-d[1], d[0])
    B = (tip[0] - 150 * d[0], tip[1] - 150 * d[1])
    back = (B[0] - 26 * d[0], B[1] - 26 * d[1])  # swept-back barbs
    h1 = (back[0] - 90 * nv[0], back[1] - 90 * nv[1])
    h2 = (back[0] + 90 * nv[0], back[1] + 90 * nv[1])
    s1 = (B[0] - 37 * nv[0], B[1] - 37 * nv[1])
    s2 = (B[0] + 37 * nv[0], B[1] + 37 * nv[1])
    tail = (246, 704)
    c1 = (s1[0] - 235 * d[0], s1[1] - 235 * d[1])
    c2 = (s2[0] - 265 * d[0], s2[1] - 265 * d[1])
    path = (f"M{P(tail)}Q{P(c1)} {P(s1)}L{P(h1)}L{P(tip)}L{P(h2)}L{P(s2)}"
            f"Q{P(c2)} {P(tail)}Z")
    outline = _quad(tail, c1, s1) + [h1, tip, h2] + _quad(s2, c2, tail)[:-1]
    return path, [tail, tip, h1, h2], outline


def _quad(p0, c, p1, steps=64):
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
                    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]))
    return out


ARROW, ARROW_PTS, ARROW_OUTLINE = _arrow()


def _flatten():
    """Bakes the knockout gaps into real geometry (no masks), so the files
    behave in Illustrator, Icon Composer and Xcode's SVG importer."""
    from shapely.geometry import Point, Polygon, box
    from shapely.ops import unary_union

    h = unary_union([box(196, 300, 308, 700), box(308, 452, 412, 548), box(412, 300, 524, 700)])
    c = Point(*Q_C)
    q = unary_union([c.buffer(Q_RO, quad_segs=128).difference(c.buffer(Q_RI, quad_segs=128)),
                     Polygon(Q_TAIL_PTS)])
    a = Polygon(ARROW_OUTLINE)
    h = h.difference(unary_union([q, a]).buffer(GAP, quad_segs=32))
    q = q.difference(a.buffer(GAP, quad_segs=32))
    return geom_path(h), geom_path(q)


def geom_path(g):
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    d = []
    for p in polys:
        if p.area < 40:  # drop slivers left by the knockout
            continue
        for ringc in [p.exterior, *p.interiors]:
            pts = list(ringc.coords)[:-1]
            d.append("M" + "L".join(P(q) for q in pts) + "Z")
    return "".join(d)


H_FLAT, Q_FLAT = _flatten()


def _mark_bbox():
    xs = [196, 524, Q_C[0] - Q_RO, Q_C[0] + Q_RO] + [p[0] for p in Q_TAIL_PTS + ARROW_PTS]
    ys = [300, 700, Q_C[1] - Q_RO, Q_C[1] + Q_RO] + [p[1] for p in Q_TAIL_PTS + ARROW_PTS]
    return min(xs), min(ys), max(xs), max(ys)


MB = _mark_bbox()
MARK_W, MARK_H = MB[2] - MB[0], MB[3] - MB[1]

MARK_SCHEMES = {
    # name: (H, Q, arrow); tuples are gradients
    "color-dark": ("#FFFFFF", ("#4ADBFF", "#0A86FF"), ("#FF7300", "#FFB91F")),
    "color-light": ("#0B1E3A", ("#1CCBFF", "#0073EA"), ("#FF7300", "#FFB91F")),
    "white": ("#FFFFFF", "#FFFFFF", "#FFFFFF"),
    "navy": ("#0B1E3A", "#0B1E3A", "#0B1E3A"),
    "tinted": ("#EEF4FF", "#9CC0F2", "#D2E2FA"),
}


def mark_parts(scheme, uid, only=None):
    """Returns (defs, body) drawn in 1024 mark space. `only` picks one layer
    ("h", "q" or "arrow") for Icon Composer exports."""
    h, q, a = MARK_SCHEMES[scheme]
    defs = []

    def fill(val, key, x1, y1, x2, y2):
        if isinstance(val, str):
            return val
        defs.append(
            f'<linearGradient id="{uid}{key}" gradientUnits="userSpaceOnUse" '
            f'x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
            f'<stop offset="0" stop-color="{val[0]}"/><stop offset="1" stop-color="{val[1]}"/>'
            f"</linearGradient>")
        return f"url(#{uid}{key})"

    qf = fill(q, "q", 440, 300, 860, 740)
    af = fill(a, "a", 250, 700, 770, 320)
    layers = {
        "h": f'<path id="H" d="{H_FLAT}" fill="{h}" fill-rule="evenodd"/>',
        "q": f'<path id="Q" d="{Q_FLAT}" fill="{qf}" fill-rule="evenodd"/>',
        "arrow": f'<path id="Arrow" d="{ARROW}" fill="{af}"/>',
    }
    body = layers[only] if only else "".join(layers.values())
    return "".join(defs), body


# ---------------------------------------------------------------- wordmark
# Custom geometric letterforms (cap height 200, stroke 40) — no font licence
# needed, already outlines.
WM_W, WM_H = 1048, 218


def wordmark_paths():
    club = [
        sector(100, 100, 100, 60, 42, 318),                      # C
        rect(198, 0, 40, 200),                                   # l
        rect(262, 44, 40, 78), rect(380, 44, 40, 156),           # u stems
        sector(341, 122, 79, 39, 0, 180),                        # u bowl
        rect(446, 0, 40, 200), ring(525, 122, 79, 39),           # b
    ]
    hq = [
        rect(634, 0, 40, 200), rect(674, 80, 102, 40), rect(776, 0, 40, 200),  # H
        ring(938, 100, 100, 60),                                               # Q
        poly(bar_pts(pt(938, 100, 78, 45), (1018, 198), 40)),
    ]
    return club, hq


WM_SCHEMES = {
    "on-dark": ("#FFFFFF", "#00C2FF"),
    "on-light": ("#0B1E3A", "#0077C2"),
    "white": ("#FFFFFF", "#FFFFFF"),
    "navy": ("#0B1E3A", "#0B1E3A"),
}


def wordmark_body(scheme):
    c, h = WM_SCHEMES[scheme]
    club, hq = wordmark_paths()
    return (f'<g fill="{c}">' + "".join(f'<path d="{d}"/>' for d in club) + "</g>"
            f'<g fill="{h}">' + "".join(f'<path d="{d}"/>' for d in hq) + "</g>")


# ---------------------------------------------------------------- documents
def svg_doc(vb, inner, defs="", title="ClubHQ"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">'
            f"<title>{title}</title><defs>{defs}</defs>{inner}</svg>")


def place_mark(scheme, uid, x, y, height, only=None):
    """Mark scaled so its bounding box is `height` tall with top-left at x,y."""
    s = height / MARK_H
    defs, body = mark_parts(scheme, uid, only)
    return defs, (f'<g transform="translate({n(x - MB[0] * s)} {n(y - MB[1] * s)}) '
                  f'scale({n(s)})">{body}</g>'), MARK_W * s


def mark_svg(scheme):
    pad = 24
    defs, g, _ = place_mark(scheme, "m", pad, pad, MARK_H)
    return svg_doc(f"0 0 {n(MARK_W + pad * 2)} {n(MARK_H + pad * 2)}", g, defs, "ClubHQ mark")


def wordmark_svg(scheme):
    pad = 20
    return svg_doc(f"{-pad} {-pad} {WM_W + pad * 2} {WM_H + pad * 2}",
                   wordmark_body(scheme), title="ClubHQ wordmark")


LOCKUP_MARK = {"on-dark": "color-dark", "on-light": "color-light", "white": "white", "navy": "navy"}


def lockup_h_svg(scheme):
    mh = 330                         # mark height vs 200 cap height
    defs, g, mw = place_mark(LOCKUP_MARK[scheme], "l", 0, 100 - mh / 2, mh)
    gap = 70
    wm = f'<g transform="translate({n(mw + gap)} 0)">{wordmark_body(scheme)}</g>'
    pad = 40
    top = 100 - mh / 2 - pad
    return svg_doc(f"{-pad} {n(top)} {n(mw + gap + WM_W + pad * 2)} {n(mh + pad * 2)}",
                   g + wm, defs, "ClubHQ horizontal lockup")


def lockup_s_svg(scheme):
    mh = 520
    s = 0.62
    ww = WM_W * s
    mw = MARK_W * mh / MARK_H
    defs, g, _ = place_mark(LOCKUP_MARK[scheme], "s", (max(ww, mw) - mw) / 2, 0, mh)
    wm = (f'<g transform="translate({n((max(ww, mw) - ww) / 2)} {mh + 70}) scale({s})">'
          f"{wordmark_body(scheme)}</g>")
    pad = 40
    return svg_doc(f"{-pad} {-pad} {n(max(ww, mw) + pad * 2)} {n(mh + 70 + WM_H * s + pad * 2)}",
                   g + wm, defs, "ClubHQ stacked lockup")


ICON_BG = {
    "default": ("#1A4280", "#0B1E3A", "#06122A"),
    "dark": ("#24272D", "#0E1013", "#000000"),
    "tinted": ("#2A2E35", "#15181C", "#0A0B0D"),
    "light-alt": ("#FFFFFF", "#F2F6FB", "#DDE7F3"),
}
ICON_MARK = {"default": "color-dark", "dark": "color-dark", "tinted": "tinted", "light-alt": "color-light"}


def icon_svg(variant, with_word=False):
    c0, c1, c2 = ICON_BG[variant]
    defs = (f'<radialGradient id="bg" cx="0.3" cy="0.15" r="1.1">'
            f'<stop offset="0" stop-color="{c0}"/><stop offset="0.55" stop-color="{c1}"/>'
            f'<stop offset="1" stop-color="{c2}"/></radialGradient>')
    bg = '<rect width="1024" height="1024" fill="url(#bg)"/>'
    if not with_word:
        mh = 500
        mw = MARK_W * mh / MARK_H
        mdefs, g, _ = place_mark(ICON_MARK[variant], "i", (1024 - mw) / 2, (1024 - mh) / 2, mh)
        return svg_doc("0 0 1024 1024", bg + g, defs + mdefs, f"ClubHQ app icon ({variant})")
    # the original concept's layout (mark + word inside the icon), for comparison
    mh = 400
    mw = MARK_W * mh / MARK_H
    mdefs, g, _ = place_mark(ICON_MARK[variant], "i", (1024 - mw) / 2, 150, mh)
    s = 760 / WM_W
    wm = f'<g transform="translate(132 640) scale({n(s)})">{wordmark_body("on-dark")}</g>'
    return svg_doc("0 0 1024 1024", bg + g + wm, defs + mdefs, "Concept layout with word")


# ---------------------------------------------------------------- colour
PALETTE = [
    # (token, hex, name, role)
    ("navy-950", "#06122A", "Midnight", "Deepest backgrounds, icon gradient floor"),
    ("navy-900", "#0B1E3A", "Navy", "Primary brand background (from concept)"),
    ("navy-800", "#13294D", "Navy 800", "Cards / elevated surfaces on dark"),
    ("navy-700", "#1C3A68", "Navy 700", "Borders, pressed states on dark"),
    ("cyan-400", "#00C2FF", "Cyan", "Brand accent: the Q, links & highlights on dark"),
    ("cyan-500", "#007CBF", "System Cyan", "iOS AccentColor in dark mode: white text on it passes, and it reads on black"),
    ("cyan-600", "#0077C2", "Deep Cyan", "Text, links & buttons on light (accessible cyan)"),
    ("orange-500", "#FF8A00", "Orange", "Arrow accent: CTAs, badges, highlights on dark"),
    ("orange-700", "#B35A00", "Deep Orange", "Orange text on light backgrounds"),
    ("slate-50", "#F4F7FB", "Cloud", "Light-mode app & site background"),
    ("slate-200", "#D6DEEA", "Mist", "Dividers & borders on light"),
    ("slate-400", "#8C9BB2", "Slate", "Secondary text on dark"),
    ("slate-600", "#4B5C77", "Steel", "Secondary text on light"),
    ("white", "#FFFFFF", "White", "Primary text on dark, the H"),
]
PAL = {t: h for t, h, *_ in PALETTE}

CONTRAST_PAIRS = [
    ("white", "navy-900", "Body text on dark"),
    ("cyan-400", "navy-900", "Accent text / links on dark"),
    ("orange-500", "navy-900", "Orange accent on dark"),
    ("slate-400", "navy-900", "Secondary text on dark"),
    ("navy-900", "cyan-400", "Navy label on cyan button"),
    ("navy-900", "orange-500", "Navy label on orange button"),
    ("navy-900", "slate-50", "Body text on light"),
    ("cyan-600", "white", "Links / buttons on light"),
    ("white", "cyan-600", "White label on deep-cyan button"),
    ("white", "cyan-500", "White text on iOS accent, dark mode (chat bubbles)"),
    ("orange-700", "white", "Orange text on light"),
    ("slate-600", "white", "Secondary text on light"),
    ("cyan-400", "white", "Bright cyan on white (logo only)"),
    ("orange-500", "white", "Bright orange on white (graphics only)"),
]


def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def lum(hx):
    r, g, b = (int(hx[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def rating(r):
    if r >= 7:
        return "AAA"
    if r >= 4.5:
        return "AA"
    if r >= 3:
        return "AA Large"
    return "Fail"


# ---------------------------------------------------------------- write files
def write(rel, text):
    p = KIT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def build_files():
    out = {}
    for s in ["color-dark", "color-light", "white", "navy"]:
        out[f"01-Logo/mark/clubhq-mark_{s}.svg"] = mark_svg(s)
    for s in WM_SCHEMES:
        out[f"01-Logo/wordmark/clubhq-wordmark_{s}.svg"] = wordmark_svg(s)
        out[f"01-Logo/lockup-horizontal/clubhq-lockup-h_{s}.svg"] = lockup_h_svg(s)
        out[f"01-Logo/lockup-stacked/clubhq-lockup-stacked_{s}.svg"] = lockup_s_svg(s)
    for v in ICON_BG:
        out[f"02-App-Icon/concepts/clubhq-icon_{v}.svg"] = icon_svg(v)
    tokens = {
        "color": {t: {"value": h, "name": nm, "role": r} for t, h, nm, r in PALETTE},
        "semantic": {
            "dark": {"background": "navy-900", "surface": "navy-800", "border": "navy-700",
                     "text": "white", "textSecondary": "slate-400", "accent": "cyan-400",
                     "cta": "orange-500", "onAccent": "navy-900"},
            "light": {"background": "slate-50", "surface": "white", "border": "slate-200",
                      "text": "navy-900", "textSecondary": "slate-600", "accent": "cyan-600",
                      "cta": "orange-500", "onAccent": "white"},
        },
        "font": {"display": "Outfit", "web-body": "Inter", "ios": "SF Pro (system)"},
    }
    out["03-Color-Type/clubhq-tokens.json"] = json.dumps(tokens, indent=2)
    for rel, text in out.items():
        write(rel, text)
    return out


# ---------------------------------------------------------------- review page
CSS = """
:root{--bg:#081428;--panel:#0F213F;--panel2:#13294D;--line:#21406E;--text:#F2F6FC;
--muted:#9AAAC2;--cyan:#00C2FF;--orange:#FF8A00;--ok:#2BD47D;--warn:#FFB020;--bad:#FF5A5A}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 16px 80px}
h1,h2,h3{font-family:Outfit,Inter,sans-serif;margin:0;letter-spacing:-.01em}
h1{font-size:clamp(28px,4vw,42px);font-weight:700}
h2{font-size:24px;font-weight:700;margin-bottom:6px}
h3{font-size:16px;font-weight:600}
.eyebrow{font:600 12px/1 Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.lede{color:var(--muted);max-width:760px;margin:10px 0 0}
section{margin-top:56px}
.sub{color:var(--muted);margin:0 0 20px;max-width:780px}
.grid{display:grid;gap:16px}
.g2{grid-template-columns:repeat(2,1fr)}
@media (max-width:700px){.g2{grid-template-columns:1fr}}
.g3{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
.card p{margin:6px 0 0;color:var(--muted);font-size:14px}
.num{font:700 13px Outfit;color:var(--orange)}
.tile{border-radius:16px;display:flex;align-items:center;justify-content:center;padding:36px;min-height:220px;border:1px solid var(--line)}
.tile img{max-width:100%;max-height:200px}
.cap{font-size:13px;color:var(--muted);margin-top:8px}
.dark{background:#0B1E3A}.light{background:#F4F7FB}.navyp{background:#0B1E3A}.cyanp{background:linear-gradient(135deg,#17C9FF,#0062D6)}
.blk{background:#000}.photo{background:linear-gradient(135deg,#3b6e4a,#9a7b3f 60%,#2a3550)}
.icon{display:block;border-radius:22.37%;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.icons-row{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end}
.icons-row figure{margin:0;text-align:center}
.icons-row figcaption{font-size:12px;color:var(--muted);margin-top:8px}
.phones{display:flex;gap:24px;flex-wrap:wrap;justify-content:center}
.phone{width:290px;height:560px;border-radius:46px;padding:14px;background:#000;box-shadow:0 0 0 2px #2a3b58}
.screen{height:100%;border-radius:34px;padding:56px 12px 18px;position:relative;overflow:hidden}
.screen .time{position:absolute;top:16px;left:30px;font:600 14px Inter;color:#fff}
.hs{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 4px;justify-items:center}
.app{display:flex;flex-direction:column;align-items:center;gap:5px;font:10px Inter;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.app i{display:block;width:52px;height:52px;border-radius:22.37%}
.app img{width:52px;height:52px;border-radius:22.37%}
.wp1{background:radial-gradient(circle at 20% 10%,#4b6cb7,#182848 70%)}
.wp2{background:radial-gradient(circle at 70% 20%,#2b2b35,#050507 70%)}
.wp3{background:radial-gradient(circle at 30% 20%,#3a4c66,#10151d 70%)}
.cmp{display:flex;gap:40px;flex-wrap:wrap;align-items:center}
.cmp .set{display:flex;gap:18px;align-items:flex-end;background:#16243c;padding:18px;border-radius:14px}
.sw{border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--panel)}
.sw .chip{height:92px}.sw .meta{padding:12px 14px}
.sw b{font:600 14px Outfit;display:block}.sw code{font-size:12px;color:var(--cyan)}
.sw span{display:block;font-size:12px;color:var(--muted);margin-top:4px;line-height:1.4}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.pair{display:inline-block;padding:3px 10px;border-radius:6px;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700}
.AAA,.AA{background:rgba(43,212,125,.15);color:var(--ok)}.AA.Large{}
.Large{background:rgba(255,176,32,.15);color:var(--warn)}.Fail{background:rgba(255,90,90,.15);color:var(--bad)}
.tablewrap{overflow-x:auto}
.type .row{display:flex;gap:24px;align-items:baseline;border-bottom:1px solid var(--line);padding:14px 0;flex-wrap:wrap}
.type .lbl{width:150px;flex:none;font-size:12px;color:var(--muted)}
.check li{margin:10px 0}.check{padding-left:20px}
.q{border-left:3px solid var(--orange)}
.files code{color:var(--cyan);font-size:13px}
"""


def img(svg, cls="", w=None, alt=""):
    style = f' style="width:{w}px;height:{w}px"' if w else ""
    return f'<img class="{cls}" src="{b64(svg)}"{style} alt="{alt}" loading="lazy" decoding="async">'


def review_page(files):
    def f(rel):
        return files[rel]

    icon = {v: f(f"02-App-Icon/concepts/clubhq-icon_{v}.svg") for v in ICON_BG}
    concept_word = icon_svg("default", with_word=True)

    filler = [("Calendar", "#e5e7eb,#9ca3af"), ("Photos", "#fde68a,#f59e0b"), ("Camera", "#9ca3af,#4b5563"),
              ("Mail", "#93c5fd,#2563eb"), ("Notes", "#fef08a,#eab308"), ("Clock", "#374151,#111827"),
              ("Weather", "#7dd3fc,#0284c7"), ("Maps", "#86efac,#16a34a"), ("Music", "#fda4af,#e11d48"),
              ("Wallet", "#4b5563,#111827"), ("Settings", "#d1d5db,#6b7280")]

    def phone(wp, ic, tint=None):
        cells = []
        for i, (name, grad) in enumerate(filler):
            if i == 5:
                cells.append(f'<div class="app"><img src="{b64(ic)}" alt="">ClubHQ</div>')
            g = grad if not tint else tint
            cells.append(f'<div class="app"><i style="background:linear-gradient(160deg,{g})"></i>{name}</div>')
        return (f'<div class="phone"><div class="screen {wp}"><div class="time">9:41</div>'
                f'<div class="hs">{"".join(cells)}</div></div></div>')

    sizes = [(180, "180 · iPhone @3x"), (120, "120 · iPhone @2x"), (87, "87 · Settings"),
             (80, "80 · Spotlight"), (60, "60 · Notification"), (40, "40 · Spotlight @1x"), (29, "29 · Settings @1x")]
    size_row = "".join(
        f'<figure>{img(icon["default"], "icon", s)}<figcaption>{c}</figcaption></figure>' for s, c in sizes)

    def cmp_set(svg, label):
        return (f'<div><div class="set">' + "".join(img(svg, "icon", s) for s in (120, 60, 40, 29)) +
                f'</div><div class="cap">{label}</div></div>')

    swatches = "".join(
        f'<div class="sw"><div class="chip" style="background:{h}"></div><div class="meta">'
        f'<b>{nm}</b><code>{h}</code> · <code>{t}</code><span>{r}</span></div></div>'
        for t, h, nm, r in PALETTE)

    rows = []
    for fg, bg, use in CONTRAST_PAIRS:
        r = contrast(PAL[fg], PAL[bg])
        rt = rating(r)
        rows.append(
            f'<tr><td><span class="pair" style="color:{PAL[fg]};background:{PAL[bg]}">Aa {fg}</span>'
            f' on <code>{bg}</code></td><td>{use}</td><td>{r:.2f}:1</td>'
            f'<td><span class="badge {rt}">{rt}</span></td></tr>')

    lock = lambda k: f(f"01-Logo/lockup-horizontal/clubhq-lockup-h_{k}.svg")
    stack = lambda k: f(f"01-Logo/lockup-stacked/clubhq-lockup-stacked_{k}.svg")
    wm = lambda k: f(f"01-Logo/wordmark/clubhq-wordmark_{k}.svg")
    mk = lambda k: f(f"01-Logo/mark/clubhq-mark_{k}.svg")

    file_list = "".join(f"<li><code>{k}</code></li>" for k in sorted(files))

    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClubHQ Checkpoint 1</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body><div class="wrap">

<div class="eyebrow">ClubHQ rebrand · Checkpoint 1 of 3 · {date.today():%B %d, %Y}</div>
<h1>Foundation: mark, icon, wordmark, color &amp; type</h1>
<p class="lede">Your “#3 Accent Arrow” concept, rebuilt as clean vector geometry. Everything here is
generated from one source file, so any change you request ripples through every logo, lockup and icon at once.
Approve or mark up the items at the bottom and I’ll move to Phase 2.</p>

<section><h2>What changed from the concept, and why</h2>
<p class="sub">The idea is intact: H + Q, navy / cyan / orange, the rising arrow. These are the refinements.</p>
<div class="grid g2">
<div class="card"><div class="num">01</div><h3>The word is out of the icon</h3>
<p>iOS already prints “ClubHQ” under the icon. At 60px the word is unreadable mush and it shrinks the mark.
The icon is now just the HQ mark, about 40% larger. See the side-by-side test below.</p></div>
<div class="card"><div class="num">02</div><h3>True vector, custom letters</h3>
<p>The concept was a raster image with an unidentified font. The mark and the “ClubHQ” wordmark are now
hand-built geometric outlines, so there's no font licence and nothing to convert. Every SVG opens in Illustrator.</p></div>
<div class="card"><div class="num">03</div><h3>Accessible color pairs</h3>
<p>Bright cyan <code>#00C2FF</code> on white is 2.1:1, below the 4.5:1 that text needs. It stays the hero on dark,
and a Deep Cyan <code>#0077C2</code> carries links and buttons in light mode.</p></div>
<div class="card"><div class="num">04</div><h3>Built for iOS 27 icon modes</h3>
<p>H, Q and arrow are separate shapes with a knockout gap, so in Phase 2 they become Icon Composer layers.
Default, dark, tinted and clear modes then render properly, not as flattened screenshots.</p></div>
</div></section>

<section><h2>The mark</h2>
<p class="sub">The gaps between H, Q and arrow are real cut-outs, not painted navy, so the mark sits cleanly on any background.</p>
<div class="grid g4">
<div><div class="tile dark">{img(mk("color-dark"))}</div><div class="cap">Full color · on dark (primary)</div></div>
<div><div class="tile light">{img(mk("color-light"))}</div><div class="cap">Full color · on light</div></div>
<div><div class="tile cyanp">{img(mk("white"))}</div><div class="cap">One-color white</div></div>
<div><div class="tile light">{img(mk("navy"))}</div><div class="cap">One-color navy</div></div>
</div></section>

<section><h2>App icon</h2>
<p class="sub">The four modes iOS will show. Final Icon Composer layers come in Phase 2; these previews show how each mode will read.</p>
<div class="icons-row">
<figure>{img(icon["default"], "icon", 200)}<figcaption>Default</figcaption></figure>
<figure>{img(icon["dark"], "icon", 200)}<figcaption>Dark mode</figcaption></figure>
<figure>{img(icon["tinted"], "icon", 200)}<figcaption>Tinted (approximation)</figcaption></figure>
<figure>{img(icon["light-alt"], "icon", 200)}<figcaption>Light alternate (marketing use)</figcaption></figure>
</div>

<h3 style="margin-top:36px">On a home screen, at real size</h3>
<p class="sub">60pt icons, as they appear on an iPhone.</p>
<div class="phones">
{phone("wp1", icon["default"])}
{phone("wp2", icon["dark"])}
{phone("wp3", icon["tinted"], tint="#5b6b82,#2c3443")}
</div>

<h3 style="margin-top:36px">Every size iOS renders</h3>
<div class="card" style="margin-top:12px"><div class="icons-row">{size_row}</div></div>

<h3 style="margin-top:36px">Why the word comes out: legibility test</h3>
<div class="card" style="margin-top:12px"><div class="cmp">
{cmp_set(concept_word, "Concept layout: mark + word inside the icon")}
{cmp_set(icon["default"], "Refined: mark only (recommended)")}
</div></div>
</section>

<section><h2>Wordmark &amp; lockups</h2>
<p class="sub">“Club” in white or navy, “HQ” in the brand cyan. Use the horizontal lockup for headers, nav bars and email,
and the stacked one for splash screens, merch and square spaces.</p>
<div class="grid g2">
<div><div class="tile dark">{img(lock("on-dark"))}</div><div class="cap">Horizontal · on dark (primary)</div></div>
<div><div class="tile light">{img(lock("on-light"))}</div><div class="cap">Horizontal · on light</div></div>
<div><div class="tile dark">{img(stack("on-dark"))}</div><div class="cap">Stacked · on dark</div></div>
<div><div class="tile light">{img(stack("on-light"))}</div><div class="cap">Stacked · on light</div></div>
<div><div class="tile dark">{img(wm("on-dark"))}</div><div class="cap">Wordmark only · on dark</div></div>
<div><div class="tile photo">{img(lock("white"))}</div><div class="cap">One-color white · over photography</div></div>
</div></section>

<section><h2>Color</h2>
<p class="sub">The concept's three colors, plus the supporting shades an app and website need. Exported as design tokens in
<code>03-Color-Type/clubhq-tokens.json</code>. In Phase 2 they become Swift asset colors and CSS variables.</p>
<div class="grid g4">{swatches}</div>
<h3 style="margin-top:32px">Contrast checks (WCAG 2.2)</h3>
<p class="sub">AA (4.5:1) is the bar for body text; AA Large (3:1) is fine for headlines, icons and logos.</p>
<div class="card tablewrap"><table><thead><tr><th>Pair</th><th>Use</th><th>Ratio</th><th>Rating</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>
</section>

<section class="type"><h2>Type</h2>
<p class="sub">Outfit for headlines and marketing (free, OFL licence; its geometry matches the wordmark). Inter for website body
text. In the app, SF Pro, Apple's system font, keeps Dynamic Type and accessibility for free. Outfit is used only for big moments
like onboarding titles.</p>
<div class="card">
<div class="row"><div class="lbl">Display · Outfit 800</div><div style="font:800 48px/1.1 Outfit">The team app parents don't hate.</div></div>
<div class="row"><div class="lbl">Headline · Outfit 700</div><div style="font:700 28px/1.2 Outfit">One family calendar. Every kid, every team.</div></div>
<div class="row"><div class="lbl">Eyebrow · Outfit 600</div><div style="font:600 13px Outfit;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)">Built for coaches</div></div>
<div class="row"><div class="lbl">Body · Inter 400 (web)</div><div style="font:400 16px/1.6 Inter;max-width:640px">Schedules, RSVPs, team chat and dues in one ad-free app. Coaches set up a team in minutes, and families join with one invite link.</div></div>
<div class="row"><div class="lbl">In-app · SF Pro</div><div style="font:600 17px -apple-system,'SF Pro Text',system-ui">Saturday · 9:00 AM · Field 3 <span style="font-weight:400;color:var(--muted)">(shown in your system font on Windows)</span></div></div>
</div></section>

<section><h2>Your approvals</h2>
<p class="sub">Reply with a yes, or with changes, for each item. After approval I build Phase 2 (icon layers, PNG/PDF exports, favicons,
app tokens), then Phase 3 (social and App Store), and bring you checkpoint 2.</p>
<div class="grid g2">
<div class="card"><h3>Decisions</h3><ol class="check">
<li>Mark geometry: H + Q + arrow proportions, gap size, arrow angle</li>
<li>App icon is the mark only, with no “ClubHQ” inside</li>
<li>Custom geometric wordmark, with “HQ” in cyan</li>
<li>Palette, including Deep Cyan and Deep Orange for light mode</li>
<li>Type: Outfit + Inter on the web, SF Pro in the app</li>
</ol></div>
<div class="card q"><h3>Still needed from you</h3><ol class="check">
<li><b>Social accounts.</b> Your message had the placeholder “(list)”. Which platforms are you on, or do you plan to be on?
Instagram, Facebook, X, TikTok, LinkedIn, YouTube, Threads?</li>
<li><b>Ship timing.</b> Should the rebrand ship as 1.0.1 after build 17 clears review? That's my recommendation.</li>
<li><b>Tagline.</b> Keep “The ad-free team app parents don't hate” as the brand line?</li>
</ol></div>
</div></section>

<section class="files"><h2>Files in this checkpoint</h2>
<p class="sub">All vector (SVG) and Illustrator-ready. PNG, PDF and the Icon Composer files are generated in Phase 2, once the geometry is locked.</p>
<div class="card"><ul>{file_list}<li><code>_source/build_brand.py</code> (generator)</li></ul></div>
</section>
</div></body></html>"""
    write("00-Review/checkpoint-1.html", html)


if __name__ == "__main__":
    files = build_files()
    review_page(files)
    for fg, bg, use in CONTRAST_PAIRS:
        r = contrast(PAL[fg], PAL[bg])
        print(f"{fg:>11} on {bg:<10} {r:5.2f} {rating(r)}")
    print("mark bbox", MB, "built", len(files), "files")
