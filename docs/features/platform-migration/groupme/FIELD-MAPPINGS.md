# GroupMe → ClubHQ field mappings

| Source | Destination | Rule |
|---|---|---|
| `group.id` | `migration_sources.external_group_id` | Stable external source ID; not the ClubHQ team ID |
| `group.name` | Suggested destination team mapping | User must confirm |
| `group.image_url` | Source preview | Not automatically team logo |
| `member.user_id` | `migration_candidates.external_user_id` | DM recipient key |
| `member.id` | `external_membership_id` | Membership key, **not** DM recipient |
| `member.nickname` | `display_name_unverified` | Not legal name, athlete name, parent role |
| `member.image_url` | Optional temporary preview | Do not persist unnecessarily |
| `member.muted`, `app_installed` | Optional diagnostics | Not proof of DM eligibility |
| Member email, phone | Not available | Never fabricate; collect through ClubHQ registration |
| Group membership | Candidate/invite | Never directly create a ClubHQ member/role |

## Matching
- Dedup by provider + `user_id` for a source account; preserve separate destination team invitations when appropriate.
- Existing ClubHQ matches must have verified linkage, not name coincidence.
- One GroupMe account can represent a parent with multiple kids; one person can belong to multiple groups/teams.
- The registration/join flow collects verified email, guardian-to-athlete relationships and role subject to current policies.
- Every candidate requires destination team or skip; changing mapping after preview invalidates send preview.

## Import scope
Group names and nicknames are used to facilitate invitations; no messages, schedules, media, scores or files are silently copied. Manual GroupMe schedule-text handling in `MoveFromGroupMeView` is separate functionality.
