ClubHQ Web is the web/Android version of the ClubHQ iPhone app. It's an ad-free youth-sports team app for coaches, parents, and players 13+, and it shares the iPhone app's production Supabase backend.

Source of truth, in order:
1. docs/clubhq/SPEC.md
2. docs/clubhq/API.md
3. docs/clubhq/DESIGN.md
4. docs/clubhq/ACCEPTANCE.md
5. docs/clubhq/ios-reference/ (iPhone SwiftUI source)
6. docs/clubhq/server-reference/ (server source)
7. docs/clubhq/screenshots/

When something isn't covered: pick the simplest option consistent with these, log it in docs/clubhq/ASSUMPTIONS.md, and continue without asking.

Never:
- create or modify Supabase tables, migrations, RLS policies, Edge Functions, storage, or cron jobs;
- enable Lovable Cloud or connect a Supabase integration;
- use a service-role key or any secret;
- rewrite src/lib/clubhq/api.ts, rules.ts, or types.ts (extend them only if strictly needed, keeping behavior identical to the iOS app);
- add analytics, ads, trackers, third-party scripts, or web fonts;
- show purchase buttons or upgrade prompts (Coach Pro is sold only in the iPhone app);
- let players start conversations or post outside team-wide threads;
- remove the neutral birth-year age gate on sign-up.

Always:
- all backend access goes through src/lib/clubhq/api.ts;
- business rules come from src/lib/clubhq/rules.ts;
- snake_case data fields;
- mobile-first (360 px Android Chrome);
- light and dark mode;
- WCAG AA;
- exact copy from SPEC.md;
- timestamps in local time; date-only fields through rules.ts helpers;
- production domain: app.teamclubhq.com.
