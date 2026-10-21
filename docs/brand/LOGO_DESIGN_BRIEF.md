# ClubHQ — Logo & App Icon Design Brief

**Prepared:** October 14, 2026 · **Owner / contact:** Danny Guillory · **Product site:** https://teamclubhq.com

> **What we're asking for:** 5–10 distinct concepts for an **app icon + logo system** (a symbol, a
> "ClubHQ" wordmark, and lockups that combine them). After we pick one, we'll ask you to refine it into
> production files: a layered iOS icon and a full logo kit (deliverables are listed in §9).

---

## 1. What ClubHQ is, in one sentence

**ClubHQ is the ad-free team app for youth sports.** It's one place where coaches, parents, and players
handle the schedule, RSVPs, team chat, and team dues, so nobody has to chase anyone in a group text.

**Tagline in use:** *"The ad-free team app parents don't hate."*

**Elevator pitch:** A volunteer coach downloads ClubHQ, creates the team, and shares one team code.
Parents join in under a minute and see every practice and game for every kid on every team, in one
schedule. They can RSVP each child with one tap, pay dues by card, and get announcements they'll
actually see. ClubHQ is free for families, with no ads and no trackers. Kids are protected: players
never get private messages from adults.

## 2. What the app actually does

This is the current iPhone app (v1.0, in TestFlight beta, US-only at launch):

| Area | What users do |
|---|---|
| **Home** | Family dashboard: each kid's next event with one-tap **Going / Maybe / Can't go**, money due, latest announcement. Coaches see RSVP counts and who hasn't answered. |
| **Schedule** | Practices, games, and tournaments across all of a family's teams. Locations, arrival notes, and jersey color. Coaches record attendance and final scores. |
| **Team** | Roster, player profiles, guardians, positions. Works for 8 sports: basketball, soccer, baseball, softball, volleyball, football, hockey, lacrosse, plus "other". |
| **Messages** | Team chat, parents-only and staff-only threads, announcements. Safety rule: players only see team-wide threads. |
| **Dues** | Coaches request season dues and fees; families pay securely (Stripe). One clear fee is shown before paying. |
| **Coach Pro** | Optional subscription for coaches who run multiple teams (reports, exports, reminders, custom team colors). |

App Store listing name: **"ClubHQ Team"** · Subtitle: *"Team schedule, RSVPs & chat"* · Categories: Sports, Productivity.

Reference screenshots: `design/app-store-screenshots/iphone-6.9/` (supplied with this brief).

## 3. Who it's for

The person who taps the icon is usually **not an athlete. It's a busy adult running a family's or a team's logistics.**

| Audience | Who they are | What they need to feel |
|---|---|---|
| **Parents / guardians** (largest group) | Parents of kids aged ~6–17, often juggling 2+ kids on several teams. Market data skews toward millennial moms acting as the household "logistics lead". | "Finally, everything in one place." Calm, trustworthy, not one more noisy app. |
| **Volunteer coaches & team managers** (the buyer and inviter) | A parent who said yes to coaching. Most head coaches are dads, and team managers are a mix. Not a pro, short on time. | "This makes me look organized." Credible, official enough to send to 15 families. |
| **Teen players (13+)** | Players invited by a guardian or coach | Not babyish. Should feel like a real team thing. |
| **Clubs & leagues** (future, via web) | Directors of multi-team clubs | Scales up from one team to an organization. |

**Market context:**
- About 55–58% of US kids aged 6–17 play organized sports, roughly 27M kids (Aspen Institute *State of Play 2025*).
- 62% of sports parents volunteer, averaging 4+ hours a week (Aspen *National Youth Sports Parent Survey*, 2025).
- The market leader, TeamSnap, reports 30M lifetime users and markets to the household's "Chief Household Officer".
- Roughly 26% of youth head coaches are women (SFIA).

## 4. Brand personality

| ClubHQ **is** | ClubHQ is **not** |
|---|---|
| Friendly, warm, family-first | Aggressive, "beast mode", pro-sports hype |
| Organized, calm, reliable ("we've got it handled") | Corporate, enterprise, cold |
| Trustworthy and safe (kids are involved) | Childish or cartoonish (teens and coaches use it too) |
| Sport-neutral, team-spirited | Tied to one sport (no single ball as the core idea) |
| Honest and simple (no ads, one clear fee) | Busy, gimmicky, gradient-soup |

**Three words:** *Home base. Together. Handled.*

**The name:** "**Club**" is the team or community you belong to. "**HQ**" is headquarters, the home base
where everything gets coordinated. That pairing is the strongest idea we have, and **no major
competitor's icon uses a "home base / headquarters / gathering place" concept** (see §5).

## 5. The competitive landscape (what to avoid looking like)

We looked at the current App Store icons of the 10 main competitors (October 2026):

| App | Current icon |
|---|---|
| TeamSnap (leader) | White starburst on an **orange** circle (brand: blue #006FF5 + orange #F56B15) |
| SportsEngine | Black "se" lettermark on white with a row of 5 colored squares |
| GameChanger | Neon **green** "GC" monogram on dark navy |
| Heja | White script "Heja" wordmark on **green** |
| Spond | Pink, coral, and purple striped sphere (ball/globe) on white |
| BAND | Dark "b" monogram on bright **green** |
| LeagueApps | White outlined "L" on dark **green** |
| TeamLinkt | White checkmark on a **blue** circle |
| PlayMetrics | Lime **green** abstract ball/play shape on navy |
| Crossbar | Red pennant flag with a script "**C**" |

**Clichés to avoid:**
- **Monogram lettermarks.** Five of the ten use one. A plain "C" in particular collides with Crossbar.
- **Balls and spheres:** TeamSnap, Spond, and PlayMetrics.
- **Green, especially green on dark navy:** GameChanger, Heja, BAND, LeagueApps, and PlayMetrics.
- **Generic checkmarks, whistles, trophies, stars, and shields.**
- **TeamSnap orange.**

**Openings:**
- A **"headquarters / home base / clubhouse / gathering point"** concept.
- **Warmer or less-used palettes.** Deep purple, teal with coral, and warm yellow are rare in this category, and only Spond uses pink or purple.
- **Real depth for Liquid Glass.** None of the competitors appear to use layered depth yet (our observation).

Sources:
- [TeamSnap brand guide](https://www.teamsnap.com/company/our-brand)
- [GameChanger rebrand](https://brookeyaffe.medium.com/our-new-brand-identity-e6b1da6d964f)
- [BAND rebrand (Oct 2025)](https://designcompass.org/en/2025/10/27/naver-band-undergoes-major-rebranding-for-the-first-time-in-three-years/)
- Brandfetch pages for GameChanger, Spond, and Crossbar
- Icons pulled from the App Store

## 6. Where we are today (the alpha icon)

The current icon, **"Home Court"**, is a white house with a center-court circle on a blue gradient (#3B7BFF → #1838C9).
It was chosen from 5 quick internal concepts (`design/app-icon/ClubHQ-icon-concepts.png`, supplied):

| Concept | Idea | Our take |
|---|---|---|
| **A · Home Court** (current) | House + center-court circle | **Right idea** ("HQ / home base", sport-neutral). Execution is generic: the house reads like a real-estate or smart-home app, the court line is basketball-specific, and the blue sits near TeamSnap and TeamLinkt. |
| B · Rally Bubble | Chat bubble drawn as a basketball, orange | Too basketball-specific, and too close to TeamSnap orange |
| C · Game Day | Calendar + checkmark | Reads as a generic calendar or to-do app |
| D · Club Crest | Varsity shield + star | Official-feeling, but shields are a sports cliché |
| E · Huddle | Three people | Reads as "contacts" or "groups", a generic system-icon look |

**You're free to keep or discard the house idea.** We'd like at least a couple of concepts that push
"home base" further than a literal house: a clubhouse, a doorway, a dugout or bench, a pin or hub where
people converge, a pennant on a building, or people forming a roof. We also want at least a couple that
go somewhere completely different.

**Current in-app colors** (these can change; the new brand will drive the app's accent color):
- Accent blue #2457F5 (dark mode #5B8CFF)
- RSVP status colors: green #1C853D for *Going*, amber #B35C00 for *Maybe*, red #C42929 for *Can't go*

## 7. Name & wordmark notes (please read)

- **The brand name is "ClubHQ"**, one word with a capital C and a capital HQ. The App Store listing is
  "ClubHQ Team", and the domain is **teamclubhq.com**. The wordmark should work as "ClubHQ" alone, and
  optionally as a lockup with "Team" (for example, ClubHQ **Team**).
- "HQ" should feel like part of the name, not an acronym bolted on. Typographic play on the H/Q
  (a Q that becomes a location pin, a whistle, a ball, or a speech tail) is welcome, but must stay readable.
- ⚠️ **Name caution:** there's a similarly named UK app, **"Club-HQ"** (App Store ID 6796480271, a club
  booking app for martial arts, dance, and swim clubs, with a white star on red). Other businesses use
  "Sports Club HQ", "OurClubHQ", and "clubhq.app". **Avoid anything resembling their marks: no white star on red.**
  The owner is doing a trademark check in parallel.

## 8. Requirements & constraints

### App icon (iOS 26/27, Liquid Glass era)
Per Apple's Human Interface Guidelines ([App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons), updated June 2026) and [Icon Composer](https://developer.apple.com/icon-composer/):

- **Layered design.** Provide a background layer plus 1–3 foreground layers. iOS adds the Liquid Glass
  effects (specular highlights, refraction, translucency) itself, so **don't bake in glass, shadows,
  blur, or glossy highlights.** Use clean vector shapes with clearly defined edges.
- **Six appearances** must all look good: Default, Dark, Clear (light and dark), and Tinted (light and dark).
  The tinted and clear modes strip color, so **the mark must survive as a single-color silhouette.**
- **Master canvas** is 1024×1024 px, square, with no corner rounding (iOS applies the mask). Keep the main
  content centered. Use Apple's official iOS 27 icon template ([Apple Design Resources](https://developer.apple.com/design/resources/)).
- **No words in the icon.** Apple discourages text. A single letterform is acceptable only if it's genuinely the idea.
- **Small sizes:** it must read clearly at about 60 pt on a home screen and in Settings/Spotlight sizes. Test on real wallpapers, light and dark.
- **No SF Symbols or Apple artwork:** Apple's license forbids them in app icons. All artwork must be original.

### Logo system
- The symbol must work **without** the icon background (on white, on dark, and in one color).
- The wordmark must be legible at small sizes (app header, email footer, a 16 px favicon for the symbol).
- Typeface: either custom lettering or a font with a **commercial license that covers app/web/logo use**.
  Note the license in the deliverables. (The app UI uses Apple's SF Pro Rounded.)
- Must reproduce on: the App Store, the website, emails, team shirts and banners, social avatars (circle crop), and print.

### Things we'd like but won't require
- A mark that can carry a **team's own color**, since Coach Pro lets teams set a custom color (for example, an in-app "co-branded" badge).
- Some sense of motion or togetherness (people converging, a huddle, a rally) without literal stick figures.

## 9. What we need from you

### Round 1: concepts (what this brief is asking for)
**5–10 distinct concepts**, not variations of one idea. Spread them across at least 3 of these
territories (or propose your own):

1. **Home base / HQ.** A clubhouse, doorway, gathering place, or headquarters, done better than a literal house.
2. **Together / huddle.** People or shapes converging into one.
3. **"HQ" lettering.** A distinctive H/Q mark (*not* a plain "C" monogram).
4. **Pennant / club identity.** Club spirit without the shield-and-star cliché.
5. **Signal / rally.** The "everyone's in" moment: RSVP, check-in, or the team responding.

For **each concept**, show:
- the icon at 1024 px and at home-screen size, on light and dark wallpaper;
- a quick **tinted/monochrome** preview;
- the symbol + "ClubHQ" wordmark lockup;
- 1–2 sentences on the idea.

### Round 2: refinement (one chosen concept)
1–2 revision rounds on color, proportion, wordmark, and appearance variants.

### Final deliverables
| Item | Format |
|---|---|
| **iOS app icon** | Icon Composer `.icon` file with Default / Dark / Clear / Tinted checked; **layered SVGs** (background + foreground layers); 1024×1024 flat PNG fallback |
| Symbol / mark | SVG, PDF, PNG (transparent) in full color, one-color black, one-color white |
| Wordmark | Same formats and color versions |
| Lockups | Horizontal, stacked, and with/without "Team" |
| Social avatar & favicon | Circle-safe avatar PNG; favicon SVG + 32/180 px PNGs |
| Color palette | HEX / RGB / CMYK (Pantone if possible), with light- and dark-mode accents; text-on-color pairs should meet WCAG AA contrast |
| Mini style guide | 1–3 pages: clear space, minimum sizes, do's and don'ts, typeface + license |
| Source files | Editable Figma or Illustrator |
| Rights | **Full copyright / IP transfer** of the final work; confirmation that all elements are original |

## 10. How we'll judge the concepts

1. **Distinct** from every icon in §5 at a glance on a home screen.
2. **Readable at 60 pt and in one color** (tinted mode).
3. **Says "team home base"**, not "calendar", "chat app", "real estate", or "one sport".
4. **Warm and trustworthy** to a parent; **credible** to a coach; **not babyish** to a 14-year-old.
5. **Scales** from one team to a club or league.
6. **Ownable**: something we could trademark, with no star-on-red (see §7).

## 11. Logistics

- **Budget guidance** (market rates, October 2026):
  - 99designs logo contests start at $249, with Gold-tier contests around $799 (third-party reported).
  - Experienced Dribbble/direct freelancers typically charge $300–1,500 for a logo, and $2,000+ for an identity system.
  - Upwork logo designers average about $25–75/hr depending on experience.
  - The owner will confirm the budget per engagement.
- **Files supplied with this brief:**
  - `design/app-icon/ClubHQ-icon-concepts.png` (the alpha concepts)
  - `design/app-store-screenshots/iphone-6.9/*.png` (the app UI)
  - this document
- **Timeline target:** Round 1 concepts within ~1–2 weeks. Final files before the public App Store launch.
- **Questions:** Danny Guillory, via https://teamclubhq.com/support

---

### Appendix: research sources
- Apple HIG, App Icons: https://developer.apple.com/design/human-interface-guidelines/app-icons
- Apple Icon Composer: https://developer.apple.com/icon-composer/ · WWDC25 "Create icons with Icon Composer": https://developer.apple.com/videos/play/wwdc2025/361/
- Aspen Institute, State of Play 2025: https://projectplay.org/state-of-play-2025/participation-trends
- Aspen Institute, National Youth Sports Parent Survey (2025): https://www.aspeninstitute.org/wp-content/uploads/2025/06/National-Youth-Sports-Parent-Survey-FINAL.pdf
- TeamSnap audience and users: https://www.teamsnap.com/brands/audience · https://youthsportsbusinessreport.com/teamsnap-hits-30-million-users-launches-unified-platform-and-expands-pro-partnerships/
- Pricing: https://99designs.com/logo-design · https://www.upwork.com/hire/logo-designers/cost/
- Product details: `docs/PRODUCT_STRATEGY.md`, `docs/research/COMPETITIVE_ANALYSIS.md`, `docs/app-store/metadata.json`

*Not independently verified:* 99designs tier prices above Bronze; TeamSnap's gender split (not published);
exact HIG grid measurements (use Apple's template); a formal USPTO/UKIPO search for "ClubHQ".
