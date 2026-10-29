# GroupMe migration — product specification

## Problem and goal
Coaches and directors already manage teams in GroupMe. ClubHQ guides them through moving team communications and memberships without rebuilding invite lists manually. The importer is **reviewed and one-time**. GroupMe members are prospective invitations, not ClubHQ identities, athletes, verified guardians or coaches.

## Entrypoints
- Team Settings → Migrating from another platform → GroupMe.
- Club Settings → Migrating from another platform → GroupMe, for an authorized `program_director` / applicable club administration role.
- Optional non-blocking coach onboarding link: “Already managing a team elsewhere?”
- Reuse existing capabilities and checks; only current team/club authorizers can send invitations.

## Wizard
0. Welcome: what moves and does not move; no destructive GroupMe changes.
1. Connect GroupMe: OAuth in system browser; account identified; revoke/reconnect.
2. Select groups: paginated list of groups this GroupMe account belongs to; searchable; no implied club ownership.
3. Map groups: team mode → current team; club mode → existing teams, authorized draft creation, or skip. Many groups per team possible but flagged for duplication; club-wide chat is not a player roster.
4. Review people: nicknames, source IDs, destination teams, deduplicated candidates, existing verified linkage, skipped people, missing contacts. No nickname-only auto-match.
5. Compose: sender identity and message; optional nickname personalization; invitation URL; test with one consenting person; explicit confirmation.
6. Send: durable queue and progress, retryable failures only, rate-limit response, cancel unsent messages.
7. Complete: sent, API accepted, failed, skipped, link opened, joined; GroupMe history retained on original platform.

## Privacy and identity
- No GroupMe member email/phone in documented group membership API.
- ClubHQ's invitation/registration collects email, athlete details, guardian relationship and consent.
- Existing ClubHQ parent visibility remains own-child-only; no inference of underage user identity.
- Never import group-level messaging history by default.
- A successful API send does **not** mean delivered/read.
- No automated repeated unsolicited outreach. Allow exclusion, opt-out and clear per-recipient history.

## Nonfunctional
Backend-owned OAuth, tokens, invitations and dispatch. Secure token encryption, RLS and permission validation at every step; short-lived invitations; audit trail; low-volume pilot before scaling; clear recovery from disconnected accounts and limited provider API access.
