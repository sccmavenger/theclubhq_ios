# Platform migration roadmap

**Priority:** after the Club Support pilot foundation and its RLS safety fix in `docs/CLUBS.md`. This extends existing roadmap #5 (CSV roster import/bulk invite), not a replacement or an immediate diversion from club delivery.

| Stage | Scope | Gate |
|---|---|---|
| M0 | Reuse current CSV/Excel roster import and existing invite paths; add Team/Club Settings entry | Audit current code and RLS |
| M1 | GroupMe OAuth connection, group discovery, multi-team mapping, member preview | Provider registration and OAuth test |
| M2 | Individual DM test, reviewed invitations, idempotent queue, progress dashboard | Provider DM/send policy validated with consenting tester |
| M3 | Club director bulk workflow for 20+ teams | Club pilot safety and permission tests pass |
| M4 | Explore TeamSnap, BAND, GameChanger import adapters and schedules | Per-provider API availability and terms validation |

Non-goals for first release: historical message migration, member emails from GroupMe, inferred guardianship, automatic player creation, ongoing bidirectional sync.

Dependencies: `docs/CLUBS.md` Phase 0 safety (org-level roles only) and Phase 1 director/team-management paths; `docs/ARCHITECTURE.md` backend protocol, Supabase Edge Functions and RLS; existing roster/import/invite mechanisms.

Definition of done: a coach connects their own GroupMe account, selects a group, maps to an authorized team, reviews unverified candidates, sends opted-in invites individually, and sees accurate accepted/failed/joined statuses without duplicate sends. A director can map multiple groups to different teams without exposing parent data across teams.
