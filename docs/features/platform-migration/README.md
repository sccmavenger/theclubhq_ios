# Platform Migration — Claude Code handoff

**Status:** planned, documentation-only. **Priority:** after pilot-ready Club Support; extends roadmap roster import (#5). No implementation is authorized by this folder alone.

## Purpose

Help coaches and club directors transition from existing team tools to ClubHQ. The first connected provider is GroupMe. Import source groups and unverified member nicknames/IDs, map them to approved ClubHQ teams, review candidates, and send individual opt-in-oriented invitations. Do not create parent/athlete identities or grant roles from GroupMe records.

## Start here

1. [Roadmap and sequencing](ROADMAP.md)
2. [GroupMe product specification](groupme/GROUPME-MIGRATION-SPEC.md)
3. [GroupMe API and authentication](groupme/API-AND-AUTH.md)
4. [Fields and identity model](groupme/FIELD-MAPPINGS.md)
5. [Wizard screens and copy](groupme/WIZARD-UI.md)
6. [Backend integration and privacy](architecture/DATA-AND-SECURITY.md)
7. [Claude Code implementation handoff](implementation/CLAUDE-CODE-HANDOFF.md)
8. [Acceptance tests and checklist](implementation/ACCEPTANCE-CHECKLIST.md)

## Existing repo integrations

- `docs/ROADMAP.md` #5: roster CSV / TeamSnap export. Extend, don't replace.
- `docs/CLUBS.md` D-044: director role, multi-team access, and critical `can_access_team` RLS safety prerequisite.
- `docs/ARCHITECTURE.md`: `ClubHQBackend`, `SupabaseBackend`, `DemoBackend`, `mobile-api`, Supabase RLS.
- Apple Intelligence roadmap references `MoveFromGroupMeView` for **manual schedule text**; keep it separate from OAuth/member migration.

## Rules

- Review-first; no import or message send until explicit confirmation.
- One-time migration, not two-way synchronization.
- No access token or invitation token in repo, client logs, analytics, or URLs shared beyond callback needs.
- Build functionality behind a feature flag and verify provider terms before launch.
- Keep existing Club Support, current onboarding, RSVP and athlete media regression-safe.
