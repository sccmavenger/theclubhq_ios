# ClubHQ — Clubs (D-044)

Plan for clubs with many teams, from the owner interview on 2026-10-28. The pilot club is
**3D Basketball Academy**: 20+ teams, run by one or two directors who don't coach every team.
Roadmap #10. The admin portal (D-041) already treats clubs as first-class (`organizations`, `pro_grants.org_id`).

## Owner decisions (2026-10-28 interview)

| # | Topic | Decision |
|---|---|---|
| 1 | Pilot | 3D Basketball Academy, a **large** club (20+ teams) that needs grouping and bulk tools |
| 2 | Who runs it | One or two **directors** oversee every team without coaching them all |
| 3 | Getting teams in | **Both:** the director creates teams and assigns coaches, *or* sends a **club code** so a coach brings an existing team in |
| 4 | Director powers | **All four:** see everything (schedule, roster, RSVPs, attendance, dues), club announcements (all or filtered), act as head coach on any team, and club events on many teams |
| 5 | Grouping | Grade/birth year, gender, level (Elite/Gold/Select…) **and** season |
| 6 | Parents | **The club is invisible to parents.** They only ever see their team |
| 7 | Club messages | Appear as a **team announcement labeled "From 3D Basketball Academy"** (or the director's name). No club area |
| 8 | Chats | Directors read and post in each team's **main chat only**. Private coach↔parent threads stay private (two-adult rule, D-009) |
| 9 | Siblings | Kids on two teams in one club happen, but aren't the main case. The existing cross-team family view covers it |
| 10 | Billing | **Free pilot through a club Pro grant** from the admin portal. Club billing ($2.50/player/season, min $499) after the pilot. Payment outside IAP still needs OQ-18 |
| 11 | Device | **App first** (iPhone, laid out for iPad). A web dashboard for bulk setup later |
| 12 | Coach leaves | **The club owns the team.** Roster, schedule and families stay. The director removes the coach and assigns a new one |
| 13 | New season | **Copy forward:** keep names and coaches, choose which players carry over. Old seasons are archived but viewable |
| 14 | Bulk setup | **All three:** paste/CSV a team list (name, grade, gender, level, coach email), a club code for coaches, and one-at-a-time |
| 15 | First slice | **All four** are needed for the pilot: club home, club announcements, club events, and setup |

## What exists today

- `organizations` (`type` = `club` / `independent`); every team has an `org_id`. A `program_director` role sits on the org (`team_id` null).
- `context` already returns every team in a director's club, so directors see them in the team switcher. But editing is head-coach-only (RLS `has_team_role(..., 'head_coach')` and `requireHeadCoach`), so a director can only look.
- `create-team` with "Part of a club" **always creates a new organization**. Ten coaches typing "3D Nation" make ten clubs. There is no way to join an existing club.
- Team limits are per coach (1 free, 3 with Coach Pro, D-011), which doesn't fit club teams.
- **Privacy bug to fix first:** `private.can_access_team` grants access to every team in an org for **any** role row whose `org_id` matches, including head and assistant coaches, whose rows carry `org_id`. Harmless while each team is its own org; with a real club, every coach could read every team's roster. Org-wide access must come only from org-level rows (`team_id IS NULL`), the same rule `mobile-api` `rolesOnTeam` already uses.

## Status (2026-10-29)
- **Phase 0 shipped:** club-wide access only from club-level roles (`20261029130000_club_access.sql`). The live check proved the leak first (coach B read team A's roster, the director read a private thread), then passed 10/10 (`supabase/tests/d044_phase0_check.mjs`).
- **Phase 1 built (TestFlight build 22, branch `clubs`):** server (`20261029140000_clubs.sql`, `20261029160000_club_chat_and_lookup.sql`, club actions in `mobile-api`, live check 27/27 `d044_phase1_check.mjs`) and app (Club tab for directors, setup, composer, Join/Start a Club).
  - Directors' tab bar is Home, Schedule, Team, Messages, **Club**; More opens from the Club tab's person button (iPhone shows five tabs).
  - Not yet: season rollover, web dashboard, club billing, editing a club event (cancel works), club branding in the app.

## Plan

### Phase 0 — Safety (before any multi-team club exists)
- Migration: `can_access_team` / `parent_can_read_team` / thread helpers grant org-wide access only for org-level roles (`team_id IS NULL`, role `program_director` or `club_admin`). Live test: two coaches in one club can't read each other's team; the director can read both.

### Phase 1 — Pilot-ready club (3D Basketball Academy)
**Data**
- `organizations`: `slug`, `brand_color`, `sport`, `time_zone`.
- `teams`: `grade` (or birth year), `gender`, `level`, `club_season_id`.
- `club_seasons` (name, dates, `archived_at`); `club_invites` (club code for coaches, and per-coach invites by email with the team pre-assigned).
- Directors = `program_director` on the org. The club owner can add a second director.

**Server (`mobile-api`)**
- `create-club`, `club-invite` / `join-club` (bring an existing team in: the team's `org_id` moves to the club, its families come too).
- `club-create-teams` (one, or a pasted/CSV list) and `assign-coach` (email invite, or an existing member) / `remove-coach`.
- Directors may do every head-coach action on club teams: `requireHeadCoach` and the head-coach RLS policies accept `program_director` on the team's org.
- `club-overview`: every team with grade/gender/level, head coach, roster size, next event, RSVP rate, and families joined vs. roster.
- `club-announcement`: to all teams or a filter (grade, gender, level, season, or picked teams). Written into each team's announcements with `from_club` set, so parents see "From 3D Basketball Academy" on their own team. One push per family, even with two kids on two teams.
- `club-event`: tryouts, parent meeting or picture day, created on every matching team, linked by a `club_event_id` so edits and cancellations apply to all at once.
- Team limits: teams in a club with a live club Pro grant don't count against the coach's 1/3 limit.

**App**
- A **Club** tab, shown only to directors: club home (teams grouped by grade → gender → level, with filters), team cards, and tap-through to any team with full head-coach powers.
- Setup: create club, club code and share sheet, add teams (one, or paste a list), assign and replace coaches.
- Composer for club announcements and club events with the group filter and a "sends to N teams / M families" preview.
- Team chat: directors appear in each team's main chat (not private threads).
- iPad: split view (team list | team detail).
- Coaches: "Join a club" with a code (Team → Settings).

**Admin portal:** grant Pro to a club (already supported) and show club counts on the Teams screen.

### Phase 2 — Seasons and scale
- Season rollover: copy teams forward (names, coaches, chosen players) and archive the old season, still viewable.
- Web dashboard for bulk setup (CSV upload, coach invites) at teamclubhq.com/club.
- Club director weekly digest (roadmap): RSVP health, teams without upcoming events, families not joined.
- Schedule import at club scale: import a whole CNR tournament or league once and place every club team's games (D-042/D-043).

### Phase 3 — Revenue and paperwork
- Club billing (OQ-18 first), registration forms and waivers.

## Open questions for the owner
- Can a club director also see **dues** details per family, or only totals? (Assumed: everything, per decision 4.)
- Does 3D Basketball Academy have a logo and colors to load for the pilot?
- Who is the second director, if any?
