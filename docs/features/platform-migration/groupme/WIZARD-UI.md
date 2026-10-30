# GroupMe wizard — UI contract

iOS uses SwiftUI, existing Team Settings / Club Settings, `ClubHQBackend` abstraction and DemoBackend previews. Reuse current typography/colors and native controls.

| Step | Primary CTA | Secondary | Empty/error behavior |
|---|---|---|---|
| Welcome | Connect GroupMe | Not now | Explain data not available |
| Connect | Authorize | Cancel | Permission denied, callback failure, reconnect |
| Group selection | Continue | Refresh / Switch account | No groups: instructions to join a group |
| Team mapping | Review members | Back | Group unmapped; no destinations |
| People review | Compose invitations | Exclude / Back | Duplicates, nickname-only identities |
| Compose | Send test; then Review recipients | Edit | Test failure remains non-destructive |
| Confirmation | Send N individual DMs | Cancel | Exact recipient count and message shown |
| Progress | View results / Cancel pending | — | Partial failures and rate limits |
| Completion | Return to team / View invitations | Disconnect | Accurate status totals |

### Suggested screen copy
- Welcome: “Bring your GroupMe team to ClubHQ. Choose groups, review people, and send invitations. Your GroupMe messages stay where they are.”
- Members: “GroupMe shares nicknames, not everyone’s email or athlete details. Each family completes those details when joining ClubHQ.”
- Confirmation: “You are about to send N individual messages from your connected GroupMe account. Review the recipients and message carefully.”
- Progress: “Sent via GroupMe API” rather than “Delivered” unless separately verified.
- Club mapping: “A group you belong to is not automatically owned by this club. Choose the correct ClubHQ team.”
- Completion: “Families can finish joining through their invitation link; team access is granted after the existing ClubHQ verification process.”

### Illustrative invite message
“Hi {nickname}, our basketball team is moving scheduling, RSVPs and team updates to ClubHQ. Join here: {invite_url}. Questions? Reply to me here. — {team_or_club_name}”

A nickname may not be a person's real name. Make personalization optional. Include message length validation. Support a preflight test to the sender or consenting test member only.

### Accessibility and mobile
Readable dynamic type, VoiceOver labels, minimum 44pt touch targets, clear progress resumability, disabled send until exact confirmation, safe-area and compact iPhone layouts, and iPad-friendly multi-team list. DemoBackend fixtures use fictitious groups and candidates.
