Build **ClubHQ Web**: the web version of our ClubHQ iPhone app, for parents, coaches, and players on Android phones and computers. It's the same product on the same production backend, so accounts, teams, RSVPs, chat, and dues are shared with the iPhone app.

Everything you need is already in this repo. Read these files completely before writing code, and treat them as the source of truth:

1. `docs/clubhq/SPEC.md`: product spec with every route, screen, piece of copy, rule, and the build order (§10)
2. `docs/clubhq/API.md`: the backend contract
3. `docs/clubhq/DESIGN.md`: colors, type, components, icons
4. `docs/clubhq/ACCEPTANCE.md`: the checklist your work must pass
5. `src/lib/clubhq/api.ts`, `rules.ts`, `types.ts`: a finished, type-checked, production-tested backend client, business rules, and types. **Use them as-is. Don't rewrite them.**
6. References for anything the spec doesn't cover:
   - `docs/clubhq/ios-reference/` (the iPhone app's SwiftUI source)
   - `docs/clubhq/server-reference/` (the server's source)
   - `docs/clubhq/screenshots/` (the iPhone app's look)

Hard rules:
- **Backend:** don't create or change anything in Supabase (no tables, migrations, policies, Edge Functions, storage, or cron). Don't enable Lovable Cloud or connect a Supabase integration. Use only the functions in `src/lib/clubhq/api.ts`. The live iPhone app depends on this backend.
- **Keys:** never use a service-role key or any secret. The publishable key in `api.ts` is the only credential, and it's public by design.
- **No tracking or upsells:** no analytics, ads, trackers, third-party scripts, or web fonts. Minors use this app. Never show purchase buttons or upgrade prompts.
- **Stack:** Vite + React + TypeScript + Tailwind + shadcn/ui, react-router-dom, TanStack Query, lucide-react, sonner. Mobile-first: it must be excellent at 360 px wide in Android Chrome. Add a PWA manifest for "Add to Home screen", but no service worker and no push.
- **Data fields:** keep snake_case field names from `types.ts`. Timestamps display in local time. Date-only fields go through the `rules.ts` helpers.

How to work:
- **Build order:** build the milestones in `SPEC.md` §10 in order, completing each one, including empty, loading, and error states, before moving on. **Don't stop to ask me questions or for confirmation between milestones.**
- **When the docs are silent:** follow "Resolving questions" at the end of `SPEC.md`. Check the spec, then the iOS reference, then the server reference, then the screenshots. If it's still unclear, pick the simplest consistent option, record it in `docs/clubhq/ASSUMPTIONS.md`, and keep going.
- **End of each milestone:** check your work against the matching section of `ACCEPTANCE.md`. Then give me a short summary of what was built and any assumptions made.

Start with Milestone 1 (Foundation) now and continue through Milestone 10.
