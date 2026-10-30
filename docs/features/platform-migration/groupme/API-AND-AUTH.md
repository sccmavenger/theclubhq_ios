# GroupMe API, OAuth, and sending contract

**Official docs:** https://dev.groupme.com/docs/v3 and https://dev.groupme.com/tutorials/oauth

## Connection
GroupMe officially documents OAuth 2.0 **implicit** authorization:
`https://oauth.groupme.com/oauth/authorize?client_id=CLIENT_ID`. The registered HTTPS callback receives `access_token`. Implement a backend-controlled callback and a securely correlated nonce/session; validate redirect context and current ClubHQ actor, prevent replay, and avoid leaking token-bearing callback URLs through logs, referrers or analytics. If modern mitigations cannot be safely implemented for its supported flow, pause and document a safer supported connection approach; do not invent a PKCE code exchange that GroupMe does not document.

Store credential server-side, encrypted, scoped to ClubHQ actor and team/club authorized use. Do not send provider secrets to clients or commit them. Support revocation/disconnection and expired/invalid token recovery.

## Read endpoints
- `GET https://api.groupme.com/v3/groups?page=N&per_page=N` → authorized account's active groups. Paginate until done; group may include `members`.
- `GET https://api.groupme.com/v3/groups/:id` → a group's details and `members`.
- `GET https://api.groupme.com/v3/users/me` → connected account profile, **not member emails**.
- Header: `X-Access-Token: <secret>`, never URL query string.

## DM experiment
Community-client documentation describes `POST https://api.groupme.com/v3/direct_messages`:
```json
{"message":{"recipient_id":"GROUPME_USER_ID","source_guid":"GENERATED_UUID","text":"Invitation text"}}
```
This is not established as a guaranteed commercial bulk send contract in official docs. **Gate implementation behind one consenting-recipient test and terms/rate-policy review.** GroupMe bots send to groups, not individual user DMs. Never use membership `id` in place of `user_id`.

Generate and persist per-invitation `source_guid` before dispatch. Deduplicate per destination + provider user + campaign. Queue with conservative throughput, stop on provider refusal and rate-limit responses; manual review before retries. No bypass via account cycling. Record response and errors redacted of secrets; distinguish API accepted from read/delivered.

## References
- Official: https://dev.groupme.com/docs/v3
- OAuth: https://dev.groupme.com/tutorials/oauth
- Status responses: https://dev.groupme.com/docs/responses
- Terms: https://dev.groupme.com/terms
- Community DM contract (verify): https://tangled.org/dunkirk.sh/group-me-not/blob/main/docs/messaging.md
