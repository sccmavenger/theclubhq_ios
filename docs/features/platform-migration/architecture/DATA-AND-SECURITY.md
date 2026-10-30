# Data and security architecture

## Existing constraints
`docs/ARCHITECTURE.md` describes SwiftUI → `ClubHQBackend` → Supabase/mobile-api, with RLS-first policy. `docs/CLUBS.md` Phase 0 identifies a critical org-wide team access bug: membership with matching org must **not** grant all-team access unless it is an org-level role (`team_id IS NULL`). **Do not deploy director multi-team migration until this gate is fixed and tested.**

## Proposed backend components
- Provider adapter: `MigrationProvider` with connect, list groups, list candidates, disconnect, capabilities.
- `GroupMeProvider` server-only OAuth and API.
- `MigrationService` for sessions, mapping, preview, confirmations, invitations, status and cancel/retry.
- Durable invitation worker with per-recipient idempotency and provider-aware backoff.

Suggested models, subject to repo/schema audit:
- `external_connections`: owner, provider, encrypted token ref, status, timestamps.
- `migration_sessions`: actor, team/club scope, workflow stage, idempotency/status.
- `migration_sources`: external group IDs, names, selected destination mappings.
- `migration_candidates`: source member user ID/nickname, dedup identity, exclusion, verified linkage nullable.
- `migration_campaigns`: message snapshot, confirm actor/time, target scope.
- `migration_invitations`: source recipient, ClubHQ invite reference, source GUID, queued/accepted/failed status, retry counts.
- `migration_audit_events`: actor, affected tenant/team, action, outcome, redacted metadata.

Favor existing invitations/roles/tables; avoid parallel identity systems. Additive database migrations and RLS policies only, with rollback strategy and tests.

## Security checks
- Validate actor membership/capability on every endpoint and again immediately before commit/send.
- Validate source group belongs to authorized GroupMe account.
- Prevent IDOR across clubs, teams and providers.
- OAuth anti-CSRF, short-lived state/session, callback replay prevention, safe secret storage.
- Individual invitations use opaque scoped, time-limited tokens; forwarded links must not bypass registration and team approval.
- No unverified parent-child linkage or direct athlete account creation.
- Remove provider tokens on disconnect without deleting completed ClubHQ accounts.
- Respect provider terms; obtain confirmation for outreach, opt-outs, throttling, retention/privacy minimization.
- Instrument errors but redact credentials, group invite links and personal details.

## Suggested API shape (adapt to mobile-api router)
- `start-groupme-auth`, `complete-groupme-auth`, `disconnect-groupme`
- `list-migration-groups`, `create-migration-session`, `map-migration-groups`
- `preview-migration-candidates`, `preview-migration-invites`
- `send-migration-test`, `confirm-migration-send`, `migration-status`, `cancel-pending-migration`, `retry-migration-failures`

Demo fixtures and integration tests should require no real GroupMe account or secret.
