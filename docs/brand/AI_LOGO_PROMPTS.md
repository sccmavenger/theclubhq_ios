# ClubHQ — AI Logo Prompts (ChatGPT + Recraft)

These prompts go with [`LOGO_DESIGN_BRIEF.md`](LOGO_DESIGN_BRIEF.md), which has the full reasoning.

## Recommended workflow

| Step | Tool | Why |
|---|---|---|
| 1. Explore 5–10 concepts | **ChatGPT** (image generation) | Fast at exploring ideas, and you can talk through changes. Its output is raster PNG only. |
| 2. Make the winner vector | **Recraft** (V4 SVG model, **paid plan**) | It's the mainstream tool that generates true, editable SVG paths. Free-tier images are public and not licensed for commercial use. |
| 3. Clean up and layer | Figma, Illustrator, or a freelancer for 1–2 hours | Fix curves, split the background and foreground into layers, and set exact colors. |
| 4. Build the iOS icon | **Icon Composer** (ships with Xcode) | Makes the `.icon` file with Default, Dark, Clear, and Tinted appearances. |

**Tips for ChatGPT**
- Ask for **one concept per image**. Grids of many logos come out muddy.
- Keep **text out of the icon**. Generate the wordmark separately. AI text is often slightly wrong, so check the spelling letter by letter.
- After every image, ask: *"Show it at 60 px, in one flat color, on a dark background."* A logo that only works large isn't a logo.

**Legal note**
- The US Copyright Office's position (2025 report) is that purely AI-generated images aren't protected by copyright. Human-made changes can be.
- **Trademark** comes from using the mark in commerce, not from copyright. A distinctive mark can still be registered.
- So treat AI output as a strong concept, and have a human redraw or modify the final version. You need the trademark check (OQ-11) either way.

---

## Prompt 1: setup (paste first, and attach `LOGO_DESIGN_BRIEF.md`)

```
You are a senior brand designer who has designed app icons for top iOS apps. I'm attaching the design
brief for my app, ClubHQ. Read it fully before doing anything.

Summary: ClubHQ is the ad-free team app for youth sports. Coaches, parents, and teen players use it for
schedules, one-tap RSVPs, team chat, and team dues. The main users are busy parents (often moms) and
volunteer coaches, not athletes. The personality is warm, organized, and trustworthy, never aggressive
or childish. The core idea is in the name: "Club" (your team or community) + "HQ" (home base, where
everything gets coordinated).

Hard rules for every concept:
- No text or letters in the app icon. The only exception is if a custom "HQ" letterform IS the concept.
- No balls as the main idea. No plain "C" monogram. No whistles, trophies, generic checkmarks, or
  shield-with-star. No white star on red.
- Avoid TeamSnap orange and the green-on-navy look that GameChanger, BAND, LeagueApps, and PlayMetrics share.
- Flat vector style: solid shapes, clean geometric edges, at most 3 colors on the background.
  No baked-in glass, gloss, shadows, bevels, or 3D. iOS adds Liquid Glass effects itself.
- The symbol must still read at 60 px and as a single-color silhouette (iOS tinted mode).
- Must feel sport-neutral (8+ sports) and scale from one team up to a whole club.

Don't generate images yet. First, list 8 distinct concepts across these territories:
home base/HQ, together/huddle, HQ lettering, pennant/club identity, and rally/"everyone's in".
For each one, give a name, a one-sentence idea, the shapes involved, and a suggested color palette
(with HEX codes). Then I'll ask you to render them one at a time.
```

## Prompt 2: render one concept (repeat for each)

```
Render concept #[N] — "[NAME]" as an iOS app icon.
- 1024×1024 square canvas, full-bleed background, no rounded corners (iOS applies the mask).
- Keep the symbol centered, with generous padding (the symbol fills about 60–70% of the canvas).
- Flat vector style, crisp edges, no text, no gloss or shadow.
- Use the palette you proposed.
One icon only, on its own, no mockup.
```

## Prompt 3: stress-test a concept you like

```
Using that exact icon, make one image that shows:
1) it at iPhone home-screen size next to other app icons, on a light wallpaper and on a dark wallpaper;
2) a single-color version (white symbol on a dark gray background), the way iOS tinted mode shows it;
3) the symbol alone on a white background, without the colored square.
Then tell me honestly: does it still read at small size, and does it look like any well-known app?
```

## Prompt 4: wordmark and lockup (only for 1–2 finalists)

```
Design a wordmark for "ClubHQ": one word, capital C, capital H and Q. Use a friendly, modern,
rounded-geometric sans serif that's legible at small sizes. "HQ" should feel like part of the name,
optionally with a subtle custom detail in the Q.
Show: (a) the wordmark alone in dark navy on white; (b) a horizontal lockup with the [NAME] symbol on
the left; (c) a stacked lockup; (d) all-white on the brand color.
Spell it exactly: C-l-u-b-H-Q.
Also name a commercially licensable font (Google Fonts or a paid foundry) that's closest to the lettering.
```

## Prompt 5: refine

```
Keep everything about concept #[N] the same except: [e.g., "make the doorway wider", "try a deep
purple background #3B2A8F with a warm yellow accent", "simplify to 2 shapes"]. Show 3 variations side by
side, labeled V1–V3.
```

---

## Recraft prompt (step 2: make the chosen concept vector)

In Recraft, choose the **Vector / SVG** model (V4 SVG), upload the ChatGPT PNG as a reference image, and use:

```
Flat vector app icon logo for "ClubHQ", a youth sports team app. [Describe the chosen concept in one
sentence, e.g., "a simple clubhouse doorway formed by two people's silhouettes leaning together"].
Geometric, minimal, 2–3 solid colors: [HEX codes]. Crisp clean paths, no gradients on the symbol, no
text, no shadows, centered on a square [HEX] background. Professional, warm, trustworthy.
```

Export as **SVG**. Then use Recraft's background removal to export the symbol on its own as a second SVG. These two files are the background and foreground layers that Icon Composer needs.

---

### Sources
- Recraft V4 and native SVG output: https://www.mindstudio.ai/blog/recraft-v4-1-brand-design-logos-svg-assets · https://ropewalk.ai/blog/recraft-v4-guide-logos-svg-design-2026 · https://www.recraft.ai/generate/logos
- Tool comparisons (2026): https://rangy.ai/blog/best-ai-logo-generator-2026/ · https://www.frankx.ai/blog/best-ai-logo-maker-2026 · https://resources.rework.com/tools/ai-tools/best-ai-logo-generators-2026
- Plan prices vary by source. Confirm current pricing on recraft.ai.
