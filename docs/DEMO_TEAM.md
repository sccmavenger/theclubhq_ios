# Demo world for 2.0 (seeded 2026-10-29)

The production database was reset on 2026-10-29 (backup in `.secrets/backups/`) and seeded with
4 independent teams and a 16-team club. **Every login, team code and the club code:**
`.secrets/demo-logins.md` (gitignored, 74 rows). All demo passwords: **`ClubHQ-Demo-2026!`**.
Demo emails are `info+…@teamclubhq.com`, which has no inbox (OQ-16), so sign in with the password.

**Reset before a demo:** `node scripts/seed-demo.mjs --wipe` from a folder with the `postgres` npm
package installed (it reads `.env.local`). It wipes all app data and every account except
dguilloryjr@msn.com and dguilloryjr@gmail.com, then rebuilds the same world with fresh dates.
**Take a backup first.**

## Your account (dguilloryjr@msn.com)
Head coach of **St. Louis Mavericks 14U** and director of **Gateway Rise Basketball Club**, with a
complimentary Coach Pro grant (`pro_grants`). One login shows a coach's team plus the Club tab.

## Independent teams
| Team | Sport | Head coach (login) | Highlights |
|---|---|---|---|
| **Avengers 12U** | Basketball | **Captain America** (info+avengers-captain-america@teamclubhq.com); assistant **Nick Fury** | 17 Avengers on the roster (Iron Man, Thor Odinson, The Hulk, Black Widow, Hawkeye Barton, Scarlet Witch, Quicksilver Maximoff, The Vision, The Falcon, War Machine, Black Panther, Spider-Man Parker, Doctor Strange, Captain Marvel, Ant-Man Lang, The Wasp, Winter Soldier). Parents include Howard Stark, Frigga and Odin Odinson, May Parker. Themed chat. |
| **St. Louis Mavericks 14U** | Basketball | You; assistant Marcus Bell | Coach Pro, a 13+ player login |
| **Gateway FC 10U Girls** | Soccer | Maria Alvarez; assistant Dana Kim | 14 players, Tue/Thu practices |
| **Arch City Aces 14U Volleyball** | Volleyball | Tamara Reed | 11 players, a 13+ player login |

## Gateway Rise Basketball Club
- **16 teams**, 3rd–8th grade boys and girls, Elite and Gold, each with a head coach (8 with an
  assistant) and 10 players. 7th–8th grade teams have a 13+ player login.
- Directors: you and **Angela Price** (info+rise-director-angela-price@teamclubhq.com). Club Pro
  grant on the club, so club teams don't count against coaches' limits.
- Club announcements on every team ("From Gateway Rise Basketball Club"): winter registration and
  picture day.
- Club events linked across teams: **picture day** (16 teams, staggered slots), **parent meeting**
  (16), **spring tryouts info night** (the six 7th–8th grade teams).
- **Taylor Morgan** (info+rise-parent-taylor.morgan@teamclubhq.com) has kids on Rise 7th Boys Elite
  and Rise 5th Girls Elite: one family calendar and one push per club announcement.

## Every team has
- Families who joined themselves (D-048): one guardian per child, a co-parent on one family, and
  emergency contacts
- Three past weeks (practices with attendance, Saturday games with scores) and four upcoming weeks:
  practices, Saturday games, a tournament weekend (two pool games plus a bracket game with time TBD)
  and one cancelled practice
- RSVPs: the next practice and game nearly full, the following ones partly answered (for "who
  hasn't responded"), with notes on maybe/no
- Announcements, a pinned team chat, a parents-only carpool thread, and a coaches thread where
  there's an assistant
- Dues: season dues (about two-thirds paid, one waived) and a tournament entry fee
- Inbox items for the coach (new message, RSVP reminder, family joined) and for the first families

## Suggested demo script
1. **Captain America (coach):** Home shows the next event and RSVP counts; open a game for the
   availability list, then **Take Attendance**.
2. **Schedule:** the tournament weekend, the cancelled practice, Calendar sync.
3. **Team:** roster, a player profile, emergency contacts, **Invite Families** (team code).
4. **Messages:** team chat, the parents-only carpool thread.
5. **Dues:** mark a Venmo payment as paid.
6. **You (msn):** **Club** tab, with 16 teams by grade, next events and RSVPs; post a club
   announcement to 6th grade only; club events.
7. **Taylor Morgan (parent):** one schedule across two club teams, one-tap RSVP.

**Not for App Review or marketing:** the Avengers team uses Marvel character names. Keep it out
of App Store screenshots and reviewer accounts (guideline 5.2, intellectual property).
