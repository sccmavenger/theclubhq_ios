# ClubHQ Club Portal: plan (draft for the owner)

Written 2026-10-30. Builds on [CLUBS.md](CLUBS.md) (D-044) and the admin portal (D-041).
**Mockup:** [`design/club-portal/mockup.html`](../design/club-portal/mockup.html). Open it in a browser and click through the left menu. All data in it is fake.

**Goal:** a web portal at **teamclubhq.com/club**. A director signs in with the **same ClubHQ login as the app** and runs every team in the club from a laptop. Coaches and parents stay in the app, and parents still never see the club (decision 6).

## 1. Where directors are today (app review)

| Area | In the app today | Gap |
|---|---|---|
| Create a club | Start a Club, then admin approval (D-051) | — |
| Add teams | One at a time, or a pasted list (`club-create-teams`, up to the per-call max) | No file upload, no duplicate check, small screen for 20+ rows |
| Coaches | Invite by email with a code; remove; cancel an invite; Contacts picker | No list of all coaches across the club, no "invite still not accepted" nudge |
| Club code | Show, share, reset | — |
| Overview | Teams grouped by grade; filters; roster, families joined, next event and RSVPs per team; "needs a coach" | Nothing ranks *what needs attention*; no club-wide totals over time |
| Act on a team | Full head-coach powers through "Open Team" | — |
| Club announcements | To everyone or by grade, gender, level, season or picked teams, with a reach preview | No history of what was sent, no scheduling, no "only families who haven't paid or RSVP'd" |
| Club events | Create on many teams; cancel on all | **Can't edit** a club event; no club calendar |
| Delete team | Directors only (D-046) | — |
| Seasons | `season` is a text label on each team | **No rollover** (decision 13) |
| Directors | The creator is the director | **No "add a second director"** |
| Branding | `brand_color` column exists | No logo or color UI |
| Dues | Per team only, through Open Team | No club-wide view |
| iPad | iPhone layout stretched | No split view (CLUBS.md Phase 1 promised it) |

**Bottom line:** directors can run a club on the phone, but the bulk jobs are cramped there: setting up 24 teams, chasing coaches and families, season rollover, and reports. Every competitor does these jobs on the web.

## 2. How competitors do it

| Product | Where directors work | What the director console offers | Price model |
|---|---|---|---|
| **TeamSnap for Clubs & Leagues / TeamSnap ONE** | Web (go.teamsnap.com), "My Organizations" | Org- and division-level admins; registration dashboard; financial reports (payments, deposits, outstanding); scheduler for many teams at once; org-wide settings that override teams; message the whole org, teams, age groups; 2026: official scores, standings | Quote only |
| **SportsEngine HQ** | Web | Home dashboard (registrations, invoicing collected/owed); drag-and-drop rostering; bulk schedule upload; directory messaging by group/roster; background-check credentials for coaches; custom and financial reports | $799–$2,199/yr |
| **LeagueApps** | Web | Program dashboard (timeline, live status, message players, copy program, overdue invoices); program summary across up to 40 programs; role-based admin access; facility booking | Quote |
| **PlayMetrics** | Web plus app | Director dashboard (season and practice plans, schedules, results, form status); tryouts and evaluations; drag-and-drop team formation; forms with deadlines and reminders; curriculum | Quote |
| **Spond Club** | Web (separate from the Spond app) | Every group in one view or filtered; import existing groups "without members noticing"; member register with custom fields; targeted messages (members, guardians, payment contacts) with an email fallback; payments and reports; multiple admins with roles | Free; earns on payments |
| **TeamLinkt** | Web | Registration and payment dashboard; build teams and assign coaches; background-check and certification tracking; scheduler with blackout dates and facilities | Free core plus add-ons |
| **GameChanger (basketball clubs, 2026)** | Mostly app | Create teams or invite existing ones; schedule all teams; standings; extra admins; **new** org-wide announcements; streaming and highlights | Free for directors; fans pay |

**Patterns worth copying**
1. **A web console for directors, the app for everyone else.** Every club product except GameChanger works this way.
2. **The first screen is "what needs me."** Owed money, unfilled registrations, missing coaches. LeagueApps' director keeps the program summary "on the flat screen on my wall".
3. **Bulk everything:** upload a team list, schedule many teams at once, message by group, copy a season forward.
4. **Coach compliance** (background checks) is standard at SportsEngine and TeamLinkt.
5. **Importing teams without disrupting families** (Spond's pitch). We already do this with the club code, which brings a team in and families see no change.

**Where incumbents are weak, and where we win**
- They are **heavy and registration-first**. Setup takes weeks, there's a sales call, and admin tools are "browser only" with dated UIs (a top SportsEngine complaint, COMPETITIVE_ANALYSIS §5). ClubHQ's pitch: *a 24-team club running in an afternoon*, with a paste or upload of the team list.
- **Parents hate club clutter.** We keep the club invisible to parents. Club messages arrive as their own team's announcement, one push even with two kids.
- **Privacy:** directors never see private coach↔parent threads (D-009). That's a selling point for clubs worried about liability.
- **Basketball schedule import** (CNR sheets, leagues, iCal: D-042/043/047) at club scale. Nobody else reads the director's actual tournament sheet.
- **We are not** building registration, tryouts or a website builder now (Phase D at the earliest).

## 3. Proposal

### Sign-in (same login as the app)
- **Email + password**, the same Supabase account as the app. Also an **emailed 6-digit code**, which covers people who signed up with *Sign in with Apple* and have no password (the code flow is already used for confirmation and reset). Real "Sign in with Apple" on the web needs an Apple Services ID; it comes later.
- Only accounts with a `program_director` role on an **approved** club get past the sign-in screen. Everyone else sees "This portal is for club directors. Coaches and parents use the app," with a download link.
- Optional authenticator-app two-step (the admin portal already has the flow). Sessions expire after 12 hours.
- **Separate from the admin portal.** Different path, session key and storage. The admin portal stays MFA-required and ClubHQ-staff only.

### Architecture
- Static site under `site/club/`, deployed with the existing Pages project (`scripts/deploy-site.sh`). Same no-SDK, no-framework approach as `site/adminportal`: `api.js`, `app.js`, `ui.js`, and a strict CSP. The CSP already allows the Supabase host.
- It calls **the same `mobile-api` club actions the app uses** (`club-overview`, `club-create-teams`, `club-assign-coach`, `club-announcement`, `club-event`, `delete-team`, …). Each action already checks `requireDirector`, and RLS already scopes data. So **permissions are written once and the app and web can't disagree**. CORS already allows browser calls.
- New server work goes into new `mobile-api` actions, so the iPhone and iPad get them too.

### Screens (all in the mockup)
| Screen | What it does | Server |
|---|---|---|
| **Overview** | Totals (teams, players, families joined, RSVP rate with weekly trend). "Needs your attention" ranked list (no coach, invite not accepted, few families joined, nothing scheduled, unanswered RSVPs for a big weekend), each with a one-click fix. This weekend's games. Teams-at-a-glance table | `club-overview` + new `club-health` |
| **Teams** | Sortable and filterable table (grade, gender, level, status), multi-select bulk actions (message, club event, set level, invite assistant), export CSV | existing + `club-update-team` in bulk |
| **Team page** | Coaches (invite, replace, remove), upcoming events with RSVP counts, roster with family-joined, RSVP, attendance and dues per player, delete team | `club-team-detail` (new, read) |
| **Coaches & staff** | Every coach across the club, their teams, last active, pending invites with resend; background-check date and expiry (Phase C) | `club-staff` (new) |
| **Families** | Every player and their guardians, with filters for not joined, owes dues, on 2+ teams; message the selection | `club-families` (new) |
| **Calendar** | Month view across all or filtered teams; club events highlighted; **edit** a club event for all teams; gym double-booking warning; import one tournament for many teams | `club-event-update` (new), Phase B import |
| **Messages** | Composer with audience chips and live reach, "who on those teams" (families + coaches, coaches only, unpaid, no RSVP), a preview of the parent's push, a sent history with read rate | `club-announcement` + new targeting and history |
| **Add teams (CSV)** | Upload .csv/.xlsx or paste, check (normalize grade and gender, flag bad emails and duplicates), create and email coach codes | `club-create-teams` (existing) + coach-invite email |
| **New season** | Wizard: name, dates → teams and coaches to copy (optionally bump grade) → players to carry over → review; the old season is archived read-only | `club_seasons` + `club-rollover` (new) |
| **Reports** | RSVP and attendance by team, club-wide dues (collected, marked paid, outstanding), CSV export, Monday digest email | new aggregates |
| **Club settings** | Name, logo, color, time zone, club code, directors (add or remove a second director), plan | `club-add-director`, branding (new) |

### Privacy and safety rules (unchanged, enforced by the server)
- No private coach↔parent threads ever. The team chat stays app-only in Phase A (reading kids' chats on the web is a bigger exposure).
- Directors see family data the way a head coach does on each team. **Exports are logged** to `audit_logs`, and so are deletions, director changes and code resets.
- Parent contact details are shown only as names plus a "joined" status. Email addresses appear only in an export, which the director must confirm.

## 4. Phases

| Phase | Scope | Size |
|---|---|---|
| **A: Portal v1 (pilot-ready)** | Sign-in (password + email code), director gate, Overview with attention list, Teams table + filters + export, Team page (read + coaches), Messages (existing targeting) + sent history, Add teams from CSV/paste, Club settings (code, **second director**, branding). App: **edit club event**, iPad split view | ~1.5–2 weeks |
| **B: Day-to-day** | Calendar with club-event edit and conflicts, Families screen, message targeting (coaches only / unpaid / no RSVP), scheduled sends, bulk team edits, import one tournament for many teams (D-042 at club scale) | ~1.5 weeks |
| **C: Seasons and compliance** | Season rollover wizard (decision 13), Reports + Monday digest email, coach background-check tracking (dates only) | ~1.5 weeks |
| **D: Revenue (later)** | Club billing on the web ($2.50/player/season, min $499; needs OQ-18), registration forms and waivers, tryouts | separate plan |

Testing follows docs/TESTING.md: a `d05x_club_portal_check.mjs` live check (a director sees only their club; a coach and a parent are refused; exports are logged; no private threads) plus a Chromium UI check like `admin_portal_ui_check.mjs`.

## 5. Questions for the owner
1. **Directors and family contact info:** may directors export guardian emails and phones (useful for clubs; a privacy exposure), or only message through ClubHQ?
2. **Team chat on the web:** keep it app-only (recommended for v1), or let directors read and post from the portal?
3. **Second director:** same powers as the owner (including delete team and adding directors), or a lesser "club staff" role?
4. **Background checks:** does 3D Basketball Academy track them today (e.g. AAU/USA Basketball requirements)? If yes, Phase C moves up.
5. **Season timing:** when does 3D roll over to Winter or Spring? That decides whether rollover is in Phase A or C.
6. **Logo and colors** for 3D Basketball Academy (still open from CLUBS.md).
