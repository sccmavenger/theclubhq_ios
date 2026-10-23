# ClubHQ — Roadmap: the next 10 builds

> *Every kid, every team, every tournament, in one ad-free app.*
> Items 1–4 make that true. Items 5–7 make coaches stay and pay. Items 8–10 turn teams into clubs.

Written 2026-10-23. Strategy and positioning: [`PRODUCT_STRATEGY.md`](PRODUCT_STRATEGY.md).
Owner blockers: [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md). Integration research behind items 3, 4, 8 and 9 is in the appendix.

**Where we are:** 1.0 (build 9) is in App Review. Build 11 is on TestFlight with the welcome tour,
the coach setup checklist, and co-parent invites (D-035). Coach Pro can be purchased (D-034). Card
payments are off; families pay dues through Venmo and Cash App buttons (D-033).

Sizes are rough: **S** ≈ days, **M** ≈ 1–2 weeks, **L** ≈ several weeks.

## Now: deliver on the core promise (next 4–6 weeks)

| # | Build | Why it matters | Size | Blocked by |
|---|---|---|---|---|
| 1 | **Push notifications, event reminders and RSVP nudges** | Retention starts here: "Practice tomorrow 6pm, tap to RSVP," and coaches get nudges for families who haven't replied. The push code is written but not running (D-012, D-021). It needs the APNs key and a scheduled reminder job. | M | APNs key (OQ-04) |
| 2 | **Calendar subscribe feed** (one feed per family, covering all kids) | "Calendar sync is free" is a headline promise. The ICS feed went away with the old web app and was never rebuilt as an Edge Function (D-024 item 2). The `calendar_tokens` table already exists. | S | — |
| 3 | **Import any team calendar** (iCal subscription) | Pulls in GameChanger, TeamSnap, SportsEngine, LeagueApps, PlayMetrics and Exposure, so "one family calendar for every kid" becomes real. A server job checks for changes every 15–30 minutes and pushes **"time changed"** alerts, which beats those apps' own calendar sync (up to a 24-hour lag). | M | — (alerts need #1) |
| 4 | **Tournament import: paste a link** | The St. Louis wedge: CNR's Google Sheets first, then Exposure and Tourney Machine. Adds a tournament-weekend view with every game, venue, court and bracket placeholder, refreshed through the weekend. | M–L | — |
| 5 | **Roster import and bulk invite** (CSV / TeamSnap export) | Shortens coach setup to under 10 minutes, timed for the TeamSnap ONE migration pain. | S | — |

## Next: revenue and game day (about 1–3 months out)

| # | Build | Why it matters | Size | Blocked by |
|---|---|---|---|---|
| 6 | **Card payments live** (Stripe Connect and Apple Pay), payment plans, auto-reminders for unpaid dues | Revenue line #1 in the strategy. The schema and Edge Functions are built; `AppConfig.cardPaymentsEnabled` is off. | M | Stripe account with Connect (OQ-08) |
| 7 | **Game-day mode:** widgets, Live Activity, directions, carpool | "Court 3, 9:40, arrive by 9:10" on the Lock Screen. It's a visible native advantage that web-first competitors can't match. | M | — |
| 8 | **Schedule from a screenshot, PDF or text**, parsed on the device | Covers everything else: flyers, Facebook posts, emailed PDFs. Apple's on-device Foundation Models plus the Vision OCR tool return structured events for the coach to review before saving. It's private and costs nothing per use. | M | — |
| 9 | **Results, stats and video links** | A "Watch on GameChanger" link on teams and events, a GameChanger stats CSV upload (Coach Pro), and player season pages. This lays the groundwork for Family+ (v2.0) without building a video pipeline yet. | M | — |

## Later: grow from teams to clubs

| # | Build | Why it matters | Size | Blocked by |
|---|---|---|---|---|
| 10 | **Club layer:** a director view across teams, club-wide announcements, registration forms and waivers | GameChanger started recruiting basketball clubs in Oct 2026. Signing a club brings every team at once and leads to Club SaaS revenue. The iPhone app is the only client, so this starts as an in-app, iPad-friendly view. | L | — |

**On deck but not in the top 10:** Spanish localization, Android, the daily RSVP digest, local sponsorship cards, fundraising (pending legal review).

## Unblockers (owner tasks, not features)

| Task | Unblocks | Ref |
|---|---|---|
| Create the APNs .p8 key and store it as Edge Function secrets | #1, and the alerts in #3 and #4 | OQ-04 |
| Create a Stripe account with Connect enabled, and pick the business entity | #6 | OQ-08 |
| Set up a support@ inbox (teamclubhq.com has no MX record, so replies bounce) | Support, App Review contact | OQ-16 |
| Check the Resend plan before launch volume | Invite and code emails at scale | OQ-17 |
| Run a trademark check on "ClubHQ" | Marketing spend | OQ-11 |
| Rotate the credentials that were shared in chat | Security hygiene | OQ-13 |

Items **2, 3 and 5** have no blockers and can start immediately.

---

## Appendix: integration research (2026-10-22)

Every source below except GameChanger publishes iCal links per team or game, which is why item 3 covers so much ground.

| Platform | Public API? | Calendar feed? | How ClubHQ gets in |
|---|---|---|---|
| **GameChanger** | **None.** No API keys, OAuth, webhooks or Zapier. Their terms (§3.4) ban bots, reverse engineering and commercial scraping. | Yes, per team (Team → ⚙ → Schedule Sync). Staff and families get practices; fans get games only. | iCal import (#3). A stats CSV upload exported by the coach (#9). Stream and clip share links only; there's no embeddable player (#9). |
| **CNR Basketball (STL)** | No | No | Each tournament is a **public Google Sheet**: one tab per bracket with *Team, Score, vs, Score, Team, Day, Time, Location*. Venue codes map to addresses on the "Tourney Info" tab. Fetch with `pub?output=csv&gid=…` (#4). |
| **SportsEngine Tourney** (formerly Tourney Machine) | Unofficial JSON search (`api.tourneymachine.com/v2/Tournaments/Search`) | **No** | Parse the team page (`Team.aspx?IDTournament=…&IDDivision=…&IDTeam=…`), an HTML table (#4). PlayMetrics bought SportsEngine in May 2026, so expect changes. |
| **Exposure Events / Exposure Basketball** | Official REST API, but it needs the event director's key and secret | Per-game `.ics` links on team pages | Public team page and iCal links (#4). The official API only through director partnerships. |
| TeamSnap, SportsEngine HQ, LeagueApps, PlayMetrics | Mostly closed | Yes, per team or per player | iCal import (#3). TeamSnap's roster CSV export feeds #5. |

**Ground rules for importers:** run them server-side so a broken parser can be fixed without App Review. Only fetch pages a user pasted in; never crawl. Cache results and poll politely. Store `source` and `external_uid` on each event so a later sync updates or removes it instead of creating a duplicate. Show "Last synced at…" with a link back to the original page.

**Competitive note:** in Sept–Oct 2026 GameChanger added basketball club management (club schedules, rosters, RSVPs, club-wide messaging, automatic streaming, auto-highlights) and launched "GameChanger for Basketball Clubs" on Oct 9. So ClubHQ should be positioned *alongside* GameChanger: families keep it for streaming and scoring, and ClubHQ is the one family calendar and inbox across every app.

### Sources
- GameChanger: [Bulk Schedule Upload](https://gc.com/post/organizations-bulk-schedule-importer), [Team Settings / Schedule Sync](https://help.gc.com/hc/en-us/articles/115005864006-Team-Settings), [Exporting Season Stats](https://help.gc.com/hc/en-us/articles/360043583651-Exporting-Season-Stats), [External Cameras](https://help.gc.com/hc/en-us/articles/360060555011-Live-Streaming-from-an-External-Camera), [Video Clips on the Web](https://help.gc.com/hc/en-us/articles/37034153219725-Video-Clips-on-the-Web), [Scoreboard Widget](https://help.gc.com/hc/en-us/articles/35264725635725-Scoreboard-Widget-for-Individual-Teams), [Terms](https://gc.com/terms), [No public API (GC Stats)](https://gcstats.app/gamechanger-api/), [Basketball club expansion (YSBR)](https://youthsportsbusinessreport.com/gamechanger-basketball-expansion-adds-club-management-autostream-and-automated-highlights/)
- CNR: [Oct 3–4 tournament page](https://www.cnrbasketball.org/october-3-4-tournament-schedule-results/)
- SportsEngine Tourney: [tourneymachine.com](https://tourneymachine.com/), [App Store listing](https://apps.apple.com/us/app/sportsengine-tourney/id1121895111), [JSON collector example](https://github.com/jhgelwicks-maker/woodgoods-collectors)
- Exposure: [API getting started](https://basketball.exposureevents.com/api/getting-started), [Games API](https://basketball.exposureevents.com/api/resources/games)
- Calendar feeds: [TeamSnap](https://helpme.teamsnap.com/article/1245-subscribe-to-a-team-schedule), [TeamSnap roster export](https://helpme.teamsnap.com/article/461-export-roster-list), [SportsEngine](https://help.sportsengine.com/en/articles/6307106-how-to-subscribe-to-an-ical-feed), [LeagueApps](https://support.leagueapps.com/hc/en-us/articles/360039381354-Calendar-Sync), [PlayMetrics](https://schedulecaddie.com/how-to/playmetrics-to-google-calendar/)
