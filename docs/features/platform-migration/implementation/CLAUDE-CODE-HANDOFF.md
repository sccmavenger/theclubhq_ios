# Claude Code handoff — implement safely

## Mission
Implement a gated, review-first GroupMe migration wizard in the ClubHQ iOS app and shared backend, preserving club priorities and existing functionality.

## First action: read and audit
Read `docs/ROADMAP.md`, `docs/CLUBS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, this folder, and relevant SwiftUI, `ClubHQBackend`, `SupabaseBackend`, `DemoBackend`, invite, role/RLS and `mobile-api` code. Locate `MoveFromGroupMeView` and current CSV roster-import implementation. Report exact reusable components and any discrepancy between these design artifacts and code. **Do not assume this spec reflects implemented database tables.**

## Execution order
1. Ensure club RLS Phase 0 safety fix and test it before club-wide queries.
2. Create provider-neutral migration domain/protocol and feature flag, use existing invite and access patterns.
3. Build DemoBackend wizard and tests using fictional sources/people.
4. Implement secure server-side GroupMe authorization and paginated group/member discovery.
5. Implement review/mapping/dedup, keeping unverified nickname identity distinct.
6. Implement one consenting individual DM test only; validate provider support and terms, capture results.
7. After gate passes, implement queue, reviewed bulk send, opt-out, idempotency, backoff, progress and audit.
8. Roll out to independent coaches, then directors with multi-team mapping.
9. Run relevant iOS/Supabase tests, RLS cross-team privacy tests and regression checks.

## Stop conditions / owner input
- OAuth flow cannot be secured with provider-supported mechanisms.
- GroupMe DM endpoint or terms forbid intended usage.
- Club RLS scope bug remains unfixed.
- Existing invitation flow cannot securely bind a person to destination team.
- Schema/code or existing user changes conflict with this proposal.

## Deliverables
Implementation plan and file-level impact map; additive migrations; feature flag; SwiftUI screens/protocol/backend wiring; secure API; tests; docs; demo walkthrough; pilot rollout/checklist. Make small PRs. Do not change production secrets or send real DMs without explicit authorized test/campaign confirmation.
