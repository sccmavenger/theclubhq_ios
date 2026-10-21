# Demo team for coach demos — "St. Louis Mavericks 14U"

Owner / head coach: **dguilloryjr@msn.com** (your normal login). It has a complimentary Coach Pro
entitlement (`app_store_subscriptions.original_transaction_id = comp-owner-dguilloryjr`,
environment "Comp"), so every Pro feature shows in demos.

| Who | Login | Password |
|---|---|---|
| Head coach (you) | dguilloryjr@msn.com | your password |
| Assistant coach (Marcus Bell) | info+mav-assistant@teamclubhq.com | ClubHQ-Demo-2026! |
| Parent of Jalen (Tasha Carter) | info+mav-tasha.carter@teamclubhq.com | ClubHQ-Demo-2026! |
| Player, age 14 (Jalen Carter) | info+mav-jalen@teamclubhq.com | ClubHQ-Demo-2026! |
| Other parents | info+mav-<first>.<last>@teamclubhq.com (e.g. carlos.reyes, keisha.thompson) | ClubHQ-Demo-2026! |

All demo emails are plus-addresses that deliver to the info@teamclubhq.com inbox.

**Contents:**
- 12 players with positions, birthdates, guardians, and emergency contacts
- 15 events: 2 past games (W 52–44, L 38–41) and 3 past practices with attendance; upcoming practices, a home game, team photos, a 2-game tournament Saturday, and another home game
- RSVPs with notes
- 3 announcements
- Team chat, a parents-only "Tournament carpool" thread, and a staff "Coaches" thread
- Dues: Fall season ($175; 8 paid, 1 waived, 3 unpaid) and tournament entry ($45; 3 paid)
- 2 inbox notifications
- Team code **MAVSSH7M77**, valid 90 days, for demoing a parent joining

**Reset before a demo:** `node scripts/seed-demo-team.mjs` (needs the `postgres` npm package and `.env.local`). It rebuilds the team with fresh dates and reuses the same logins.

## Suggested 5-minute demo script
1. **Coach Home:** next practice, RSVP counts, "who hasn't responded", unpaid dues.
2. **Event:** availability list, then **Take Attendance**.
3. **Schedule:** tournament weekend; **+** to add a weekly practice in seconds.
4. **Team:** roster, player profile, emergency contacts, and **Invite Families** (team code).
5. **Messages:** team chat, plus the parents-only carpool thread.
6. **Dues:** create a request, then mark a cash/Venmo payment as paid.
7. **Pro:** Team → Season Report (attendance %), then Export.
8. Sign in as **Tasha (parent)** on a second phone: the family view, with one-tap RSVP.
