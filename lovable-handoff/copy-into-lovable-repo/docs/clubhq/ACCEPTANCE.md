# ClubHQ Web — Acceptance Checklist

Walk this list at the end of each milestone and once more at the end. Every box must pass at **360 px wide (Android Chrome)**, on **desktop (1280 px)**, and in **dark mode**.

## Test accounts (production demo team "St. Louis Mavericks 14U")
These are real accounts on a seeded demo team. The owner gives you the shared password in chat; it's not stored in this repo.

| Role | Email |
|---|---|
| Assistant coach | `info+mav-assistant@teamclubhq.com` |
| Parent (of Jalen) | `info+mav-tasha.carter@teamclubhq.com` |
| Player, age 14 (Jalen) | `info+mav-jalen@teamclubhq.com` |
| Other parents | `info+mav-carlos.reyes@teamclubhq.com`, `info+mav-keisha.thompson@teamclubhq.com` |

- The head coach account belongs to the owner. For head-coach-only checks, create your own throwaway coach account with a new team and delete it at the end (More → Delete Account).
- Demo team code: **MAVSSH7M77**.
- The demo team is reset by the owner before sales demos. Writes are OK, but keep them small and realistic.

## Foundation
- [ ] No console errors on any screen. No network calls except to `qpchhtakmxcfqtbjjpvi.supabase.co`.
- [ ] No migrations, Supabase functions, or Lovable Cloud resources were created. `supabase/` doesn't exist in the repo.
- [ ] Bottom tabs on mobile; sidebar at ≥ 1024 px. Safe-area padding at the bottom on Android.
- [ ] Manifest present; "Add to Home screen" on Android Chrome opens standalone with the ClubHQ icon.
- [ ] Refreshing any deep URL (e.g. `/events/<id>`) works (SPA fallback configured).

## Accounts
- [ ] Create Account with a new email → 6-digit code screen → code auto-submits → onboarding.
- [ ] Wrong code shows "That code is wrong or has expired…" and clears the input. Resend is disabled for 60 s.
- [ ] Birth year making the user under 13 shows the age message; changing the year and retrying within 24 h is still blocked.
- [ ] Sign in with an unconfirmed account sends a fresh code and opens the code screen.
- [ ] Forgot password → code → new password → signed in.
- [ ] Wrong password shows "That email and password don't match."
- [ ] Sign out returns to `/welcome`; the back button doesn't reveal signed-in screens.

## Invite & onboarding
- [ ] Signed out, open `/join/MAVSSH7M77` → invite landing → Create Account → after the code, the parent join screen opens with the code prefilled and the team found.
- [ ] Pasting "enter team code: MAVSS H7M77" or a full invite link finds the team.
- [ ] Invalid code shows the amber expired/invalid message.
- [ ] Join requires child first/last name and an emergency contact name + phone (7+ digits). On success, Home shows the team.
- [ ] Coach: create a team → Home shows the coach layout. Creating a 2nd team shows the free-plan explanation with no purchase button.
- [ ] Player code screen shows the server message for a bad code.

## Home
- [ ] Parent (Tasha): "Coming up" cards with one RSVP row per child. Tapping Going/Maybe/Can't go updates instantly and persists after reload.
- [ ] An event within 4 hours shows "RSVP closed" and disabled buttons.
- [ ] Amount-due card appears when the family has unpaid dues.
- [ ] Coach (assistant): "Up next" with RSVP counts, "Needs attention", quick actions.
- [ ] Player (Jalen): "Up next" with "Are you in?", team chat row.
- [ ] Bell shows unread state; the greeting uses the first name.

## Schedule & events
- [ ] Upcoming/Past toggle; grouped by day with Today/Tomorrow labels; times in local time.
- [ ] Event detail shows type tag, title ("vs Opponent" / "@ Opponent"), time range, maps link, notes.
- [ ] Staff see Availability with counts, notes, and "No reply" rows. Parents don't.
- [ ] Head coach (your test coach): create a weekly-repeating practice (×3) → 3 events appear; edit one; enter a game score → "W 52–44" tag; take attendance (prefilled from RSVPs) → tags shown; cancel → "Cancelled" tag.

## Team
- [ ] Roster with jersey badges and "Your child" / "You" tags; People list with role summaries ("Guardian of Jalen").
- [ ] Player profile shows emergency contacts to staff and that child's guardian only, with working `tel:` and `mailto:` links.
- [ ] Guardian of a 13+ child can create a player login code; under-13 shows the explanation; a missing birthdate shows the birthdate form.
- [ ] Head coach: add, edit, and remove a player; Invite Families shows the spaced code, Share (or copy fallback) and Copy Link.
- [ ] Announcements list; head coach can post one and it appears at the top.
- [ ] Team Settings colors appear only for Pro teams; choosing one re-tints the app.

## Messages
- [ ] Team chat pinned at top; other threads show audience, last message, unread dot.
- [ ] Sending shows the bubble immediately; a second browser sees it within ~5 s.
- [ ] Delete own message → "[deleted]". Report opens an email to info@teamclubhq.com. Block hides that author's messages after reload; "Unblock all members" restores them.
- [ ] Player account: no "New Thread" button; shield info row visible.
- [ ] Staff: New Thread with "Who can see this" options and helper text.
- [ ] Mute toggles and persists.

## Money & reports
- [ ] Parent: Due items preselected, past-due in red, History with status tags; no Pay button while `CARD_PAYMENTS_ENABLED` is false, footer explains paying the coach directly.
- [ ] Head coach: New Payment Request shows "Family pays" / "Your team receives"; the request card shows progress; detail menu marks Paid / Waived / Unpaid.
- [ ] Season Report shows the win/loss record; Pro teams show attendance rates and Export downloads a CSV.

## Inbox & More
- [ ] Inbox lists notifications; tapping one marks it read and navigates (event → event detail, message → chat).
- [ ] Mark All Read clears the bell state.
- [ ] More: rename saves and updates the greeting; team list switches teams; Plan section copy; Delete Account confirm wording.

## Quality
- [ ] Every interactive element is keyboard reachable with a visible focus ring; icon-only buttons have labels.
- [ ] Lighthouse (mobile): Accessibility ≥ 95, Best Practices ≥ 95, Performance ≥ 80.
- [ ] No text overflow at 360 px; long team names truncate with an ellipsis.
- [ ] `docs/clubhq/ASSUMPTIONS.md` lists every assumption you made.
