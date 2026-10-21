# ClubHQ Web: Lovable handoff

Everything Lovable needs to build the web/Android version of ClubHQ in one pass, without a long back-and-forth.

| File | What it is | Where it goes |
|---|---|---|
| `1-PROMPT.md` | The build instruction | Paste into Lovable's chat (step 5) |
| `2-KNOWLEDGE.md` | Permanent guardrails | Lovable → Project settings → **Knowledge** (step 4) |
| `copy-into-lovable-repo/` | Spec, API contract, design, acceptance checklist, a tested TypeScript backend client, iPhone and server source for reference, screenshots, icons | Copied into the root of Lovable's GitHub repo (step 3) |

**Why this works without questions:** the prompt points Lovable to the files in its own repo. The spec ends with a "Resolving questions" order: spec, then iPhone source, then server source, then screenshots, then "pick the simplest option and log it in `ASSUMPTIONS.md`". You review the assumptions at the end instead of answering questions as they come up.

## Steps

1. **Create the Lovable project.** Start a new project with this short prompt, so Lovable sets up its template without inventing features:
   > Create an empty Vite + React + TypeScript + Tailwind + shadcn/ui app named "ClubHQ Web" with a single placeholder home page. Don't build any features yet, and don't enable Lovable Cloud or Supabase.
2. **Connect GitHub.** Lovable → GitHub → Connect, which creates a repo. **Make it private.** It will contain the iPhone app's source as reference.
3. **Add the handoff files to that repo:**
   ```sh
   git clone https://github.com/<you>/<lovable-repo>.git
   cp -R ~/GitHub/ClubHQ/lovable-handoff/copy-into-lovable-repo/. <lovable-repo>/
   cd <lovable-repo>
   git add -A
   git commit -m "Add ClubHQ web spec and backend client"
   git push
   ```
   Lovable syncs the push within a few seconds. Check that `docs/clubhq/SPEC.md` shows in Lovable's code view.
4. **Paste `2-KNOWLEDGE.md`** into Project settings → Knowledge.
5. **Paste `1-PROMPT.md`** into the chat as one message.
6. **If Lovable stops partway** (it works in chunks), reply only:
   > Continue with the next milestone in docs/clubhq/SPEC.md §10. Don't ask questions; log assumptions in docs/clubhq/ASSUMPTIONS.md.
7. **For testing**, give Lovable the demo team password in chat (from `docs/DEMO_TEAM.md` in the ClubHQ repo). It's deliberately not stored in the repo.
8. **At the end**, read `docs/clubhq/ASSUMPTIONS.md` and walk `docs/clubhq/ACCEPTANCE.md` yourself on an Android phone.

## If Lovable tries to…
| It does this | Reply |
|---|---|
| Suggests connecting Supabase or Lovable Cloud | "No. The backend already exists. Use src/lib/clubhq/api.ts only (see API.md)." |
| Writes a migration or Edge Function | "Revert that. The backend is fixed (SPEC.md §2)." |
| Rewrites `api.ts` or renames fields to camelCase | "Revert. Use api.ts, rules.ts, and types.ts as-is." |
| Adds a paywall or upgrade button | "Remove it. Coach Pro isn't sold on the web (SPEC.md §2.6)." |
| Asks a product question | "Follow 'Resolving questions' in SPEC.md and log the assumption." |

## Outside Lovable (owner)
1. **Domain:** in Lovable → Settings → Domains, connect **`app.teamclubhq.com`**, then add the DNS records it shows in Cloudflare. Leave `teamclubhq.com` itself on Cloudflare Pages: it serves privacy/terms, the email and payment return pages, and the iPhone invite page.
2. **Invite page for Android parents:** `teamclubhq.com/join/<code>` (`site/join.html`) currently only offers the iPhone app. It needs an "Android or computer? Continue on the web" button linking to `https://app.teamclubhq.com/join/<code>`. *(Claude can make this change in the ClubHQ repo.)*
3. **iPhone invite text:** the coach's "Share Invite" message in the iPhone app (`InviteFamiliesView`) should also include the web link for Android families. *(Small iOS change; ships with the next build.)*
4. **Notifications for web-only parents:** the server records notifications but sends them only as iPhone push. Web users see them in the inbox when they open the site. Emailing notifications through the existing Resend setup would be a server change in `supabase/functions`, not something Lovable should build.

## Verified before handoff
- `src/lib/clubhq/*.ts` type-checks under `strict` with `@supabase/supabase-js` v2.
- A read-only run against production as the demo parent passed all 22 checks: context, events, RSVPs, event detail, roster, members, threads, team chat, announcements, inbox, dues, sponsors, invite lookup, emergency contacts, and error mapping, plus the pure rules.
- The emails are code-only (`{{ .Token }}`), so sign-up and password reset work in a browser with no links or deep-link pages.
- `mobile-api` sends `Access-Control-Allow-Origin: *`, so browser calls work from any domain with no Supabase setting changes.
