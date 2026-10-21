# ClubHQ Web — Design

**Goal:** it should feel like the ClubHQ iPhone app (see `docs/clubhq/screenshots/`), adapted to the web. Clean, calm, sporty, no clutter.

The core pattern is iOS **"inset grouped lists"**: a light gray page background, content in white rounded **section cards**, rows separated by hairline dividers, and small uppercase section headers above each card.

## Brand
- **Name:** ClubHQ (capital C, H, Q).
- **Mark:** `public/brand-mark.svg`. A white house with a center-court line and circle on a blue gradient tile. Use it on Welcome (76 px), Invite landing (84 px), and as the sidebar logo (32 px).
- **Icons for the manifest and favicon:** `public/icons/icon-32.png`, `icon-64.png`, `icon-180.png` (apple-touch), `icon-1024.png`. Generate 192 and 512 PNGs for the manifest from `icon-1024.png`.
- **Voice:** friendly, short, plain English. Sentence case for buttons and titles ("Add Event" is the iOS exception; keep the exact copy from `SPEC.md`).

## Color tokens
Define these as CSS variables and wire them into Tailwind/shadcn (`--primary` = accent).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#2457F5` | `#5B8CFF` | Primary buttons, links, active tab, unread dots |
| `--accent-gradient` | `#3B7BFF → #1838C9` (top-left → bottom-right) | same | Brand tile, team icon tile |
| `--bg` | `#F2F2F7` | `#0B1020` | Page background |
| `--card` | `#FFFFFF` | `#151B2E` | Section cards, dialogs, bars |
| `--field` | `#F2F4F8` | `#1E2640` | Inputs, chat bubbles from others |
| `--ink` | `#0F172A` | `#F3F5FA` | Primary text |
| `--muted` | `#5B6475` | `#A3ACBD` | Secondary text |
| `--faint` | `#94A3B8` | `#6B7590` | Tertiary text, timestamps |
| `--divider` | `rgba(60,60,67,.18)` | `rgba(255,255,255,.12)` | Row separators, input borders |
| `--going` | `#1C853D` | `#2FA552` | RSVP yes, attendance present, paid, wins |
| `--maybe` | `#B35C00` | `#E08A2E` | RSVP maybe, late, unpaid, "needs attention" |
| `--out` | `#C42929` | `#E5484D` | RSVP no, absent, cancelled, losses, past due, destructive |
| `--neutral` | `#6B7280` | `#9CA3AF` | Excused, waived, ties, "No reply" |
| `--pro` | `#7C3AED` | `#A78BFA` | "Pro" tag, "Coach Pro is active" |

**Team tint:** when the selected team has `brand_color`, use it (`rules.teamTint`) in place of `--accent` for the active tab, primary buttons, date blocks, event-type icons, and avatars of staff. Text on a tinted fill is always white. Palette: `rules.TEAM_COLOR_PALETTE`.

Colored text (green/orange/red) must hit WCAG AA on its background. The light-mode values above were chosen for that; keep white text on the solid RSVP pills.

## Typography
- **Font:** system stack, no web fonts. `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Use the same stack's `ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace` for team and player codes.
- **Scale:**
  - large title 28/34 bold (page titles on mobile);
  - title 22/28 bold;
  - headline 17/22 semibold;
  - body 17/22;
  - subhead 15/20;
  - footnote 13/18;
  - caption 12/16;
  - numbers use `tabular-nums`.
- **Codes** (team/player): 32 px bold monospace, letter-spacing 0.04em, selectable.

## Shape & spacing
- **Section cards:** radius 16 px (20 px on hero cards), no shadow in light mode (flat on gray), padding 12–16 px. Rows are min 48 px tall with 16 px horizontal padding and a divider inset by 16 px.
- **Section header:** 13 px uppercase semibold `--muted` with 0.02em tracking, 8 px above the card. Optional footer text 13 px `--muted` below the card.
- **Inputs:** 48 px tall, radius 12 px, `--field` background, 0.5 px `--divider` border, 14 px horizontal padding; focus ring 2 px `--accent`.
- **Buttons:**
  - primary: filled accent, white text, radius 12 px (full-width in forms), 48 px tall;
  - secondary: tinted (accent at 12% opacity) with accent text;
  - destructive: `--out` text.
  - Async buttons swap the label for a spinner without changing size.
- **Page padding:** 16 px on mobile, max content width 760 px. Bottom tab bar 64 px plus the safe area.

## Components (build once, reuse everywhere)

| Component | Spec |
|---|---|
| **EventSummaryRow** | Left: a 44 px-wide date block with the weekday abbreviation (UPPERCASE, 11 px bold, team tint) over the day number (22 px bold, tabular). Right column: the event-type icon (tint) + `eventDisplayTitle` (headline, 1 line); "{relativeDayLabel} · {timeRangeLabel}" (subhead, muted); MapPin + location (caption, muted, 1 line); team name (caption semibold, tint) when multiple teams are shown; then a "Cancelled" tag (red, OctagonX) or the score tag (green when it starts with "W", else neutral). The whole row links to the event |
| **RSVPPicker** | Three equal pill buttons in a row, gap 8 px: "✓ Going", "? Maybe", "✕ Can't go" (icons CircleCheck/CircleHelp/CircleX). Unselected: status color text on a 12% tint of it. Selected: solid status color with white text. `aria-pressed`. Locked: 50% opacity, disabled |
| **ChildRSVPRow** | The child's first name (subhead semibold) on the left. On the right, "Needs response" (caption semibold `--maybe`) when unanswered, or Lock + "RSVP closed" (caption muted) when locked. The RSVPPicker sits below |
| **RSVPSummaryBar** | Four equal columns: number (20 px bold, colored: going/maybe/out/neutral) over the label "Going", "Maybe", "Out", "No reply" (caption muted) |
| **AttentionRow** | A 30 px icon in its tint color, title (subhead semibold), detail (caption muted). Clickable rows get a chevron |
| **QuickActionGrid** | Four equal tiles (min 72 px), each a tinted secondary button with icon (22 px) over the label (caption semibold) |
| **TagLabel** | Capsule, 12 px semibold, 8×3 px padding, colored text on a 14% tint, optional leading icon |
| **InitialsAvatar** | Circle (36 px default, 64 px on the profile), initials in a rounded semibold font at 40% of the size, tint text on a 15% tint |
| **JerseyBadge** | "#12" or "—", subhead semibold tabular muted, min-width 40 px |
| **TeamChatRow** | A 40 px circle with the tint gradient and a white MessagesSquare icon, "Team chat" (headline), and "Coaches, parents, and players" (caption muted), plus a chevron |
| **ChatBubble** | Max 75% width, radius 18 px, 14×9 px padding. Mine: accent fill, white text, right-aligned. Others: `--field`, `--ink`, left-aligned. Author name (caption semibold muted) above the first message in a run; time (11 px faint) below. Deleted messages are italic |
| **SponsorCard** | 44 px rounded tile with a Store icon, "Team sponsor" (caption muted), name (subhead semibold), tagline (caption muted). Opens `link_url` in a new tab |
| **EmptyState** | Centered 40 px muted icon, title (headline), description (subhead muted), optional primary button |
| **TeamSwitcher** | Top-bar dropdown: sport emoji + team name (semibold, 1 line, truncated). Menu lists every team with a check on the current one |
| **BellButton** | Bell icon. With unread > 0, BellDot with an accent dot |

## Icons (lucide-react)

| Meaning | Icon | Meaning | Icon |
|---|---|---|---|
| Home tab | `House` | Location | `MapPin` / `Map` |
| Schedule tab | `Calendar` | Time | `Clock` |
| Team tab | `Users` | Notes | `StickyNote` |
| Messages tab | `MessagesSquare` | Announcement | `Megaphone` |
| More tab | `Ellipsis` | Dues | `CircleDollarSign` |
| Practice | `Dumbbell` | Season report | `ChartColumn` |
| Game | `Trophy` | Settings | `Settings` |
| Other event | `CalendarDays` | Add player / invite | `UserPlus` / `Link` |
| Going / Maybe / Can't go | `CircleCheck` / `CircleHelp` / `CircleX` | Staff-only thread | `Lock` |
| Bell / unread / muted | `Bell` / `BellDot` / `BellOff` | Parents thread / everyone thread | `UsersRound` / `Users` |
| Pro | `Sparkles` | RSVP reminder / needs response | `Hand` |
| Amount due | `CreditCard` | Email / phone | `Mail` / `Phone` |
| Take attendance | `ClipboardCheck` | Enter score | `Hash` |
| Edit | `Pencil` | Cancel event | `OctagonX` |
| Remove from roster | `Archive` | Share / copy | `Share2` / `Copy` |
| Report / block | `Flag` / `Ban` | Delete | `Trash2` |
| Password show/hide | `Eye` / `EyeOff` | Reset password code | `KeyRound` |
| Coach persona | `ClipboardList` | Parent persona | `HeartHandshake` |
| Player persona | `Shirt` | Players-only info | `ShieldCheck` |
| Sponsor | `Store` | New thread / new announcement | `SquarePen` |

**Sport icons:** use emoji so every sport is recognizable: 🏀 basketball, ⚽ soccer, ⚾ baseball, 🥎 softball, 🏐 volleyball, 🏈 football, 🏒 hockey, 🥍 lacrosse, 🏅 other.

**Inbox kinds:**
- `announcement` → Megaphone;
- `event_created` / `event_updated` / `event_reminder` → Calendar;
- `rsvp_reminder` → Hand;
- `message_new` / `event_thread_reply` → MessagesSquare;
- anything else → Bell.

## Motion
Subtle only: 150–200 ms fades and slides for dialogs and sheets. Respect `prefers-reduced-motion`. On mobile, dialogs open as bottom sheets; on desktop, as centered modals.
