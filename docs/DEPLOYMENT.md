# ClubHQ — Backend Deployment Runbook

Everything the iOS app needs on its Supabase project, **TeamClubHQ** (`qpchhtakmxcfqtbjjpvi`, D-028).
All changes are additive (DECISIONS D-003). There is no web client; the earlier web prototype is retired.
Credentials for the Management API and CLI are in the repo's gitignored `.env.local`.

Steps marked 🤖 can be done through the Supabase MCP. Steps marked 👤 need the owner
(secrets, Apple/Stripe consoles).

## 0. Preflight 🤖
1. Confirm the target is the TeamClubHQ project (`SUPABASE_PROJECT_REF` in `.env.local`).
2. List tables and confirm the core ones exist (`teams`, `players`, `events`, `rsvps`, `message_threads`, `notification_sends`, `user_roles`).
3. Confirm the helpers exist: `private.can_access_team`, `private.parent_can_read_team`,
   `private.has_team_role`, `private.has_org_role`, `private.has_role`, `private.can_read_thread`.
4. Take a backup / note the latest migration version.

## 1. Migrations 🤖 (apply in order — two transactions on purpose)
| File | What it does |
|---|---|
| `supabase/migrations/20261013120000_player_role_enum.sql` | Adds the `player` value to `app_role` |
| `supabase/migrations/20261013120100_mobile_foundation.sql` | Adds `teams.sport`/`brand_color`, `players.user_id`, `player_invites`, player RSVP policies, player-aware `can_read_thread`, `device_tokens`, `notification_sends.apns_sent_at`, `app_store_subscriptions` + `user_has_coach_pro`/`team_is_pro`, Stripe dues tables, `team_sponsors` |

Post-checks (SQL):
```sql
select enum_range(null::app_role);                       -- includes 'player'
select count(*) from public.device_tokens;               -- 0, no error
select public.team_is_pro('00000000-0000-0000-0000-000000000000');  -- false
```

## 2. Edge Functions 🤖
Deploy from `supabase/functions/` (shared code is in `_shared/`):

| Function | JWT verification | Purpose |
|---|---|---|
| `mobile-api` | **on** | Every privileged iOS action (DECISIONS D-005) |
| `apns-dispatch` | off (own secret) | Pushes `notification_sends` to iPhones (D-021) |
| `stripe-webhook` | off (Stripe signature) | Marks dues paid; Connect account status |
| `appstore-notifications` | off (re-verifies with Apple) | Coach Pro renewals, expirations, refunds |
| `calendar-feed` | off (secret token in the URL) | Calendar subscription (.ics) for Schedule → Calendar Sync (D-036) |
| `admin-api` | **on** (+ admin row and MFA checked inside) | Audited admin-portal writes (D-041) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

Smoke test (signed-in user JWT):
```bash
curl -X POST "$SUPABASE_URL/functions/v1/mobile-api" \
  -H "Authorization: Bearer $USER_JWT" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{"action":"context"}'
```

## 3. Function secrets 👤
Each feature degrades gracefully until its secrets are set. For example, push is skipped and the in-app inbox still works.

| Secret | Needed for | Where it comes from |
|---|---|---|
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (.p8 contents), `APNS_BUNDLE_ID` | Push | Apple Developer → Keys |
| `APNS_DISPATCH_SECRET` | Cron → `apns-dispatch` | Any long random string |
| `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`, `APPSTORE_PRIVATE_KEY`, `APPSTORE_BUNDLE_ID` | Coach Pro verification | App Store Connect → Users and Access → Integrations → In-App Purchase key |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Dues | Stripe Dashboard (Connect enabled) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (PKCS#8 PEM), `VAPID_SUBJECT` | Admin-portal web-push alerts (D-041). Set 2026-10-25 | Generated P-256 key pair (no vendor) |
| `PAYMENTS_RETURN_URL` | After Stripe onboarding/checkout | A page on the web app, e.g. `https://<domain>/payments/return` |

## 4. Schedules 🤖 (after `APNS_DISPATCH_SECRET` is stored in Vault)
```sql
select vault.create_secret('<APNS_DISPATCH_SECRET>', 'apns_dispatch_secret');
select cron.schedule('clubhq-apns-dispatch', '* * * * *', $$
  select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/apns-dispatch',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'apns_dispatch_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

## 5. Auth configuration 👤/🤖
- **Sign in with Apple:** Authentication → Providers → Apple. Add the app's bundle ID as an authorized client ID.
- **Redirect URLs:** add `clubhq://` (deep links) and the web domain.
- **Email confirmation:** either setting works. The app handles both "signed in" and "check your email".

## 6. Webhooks 👤
- **Stripe:** endpoint `<SUPABASE_URL>/functions/v1/stripe-webhook`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `account.updated`, `charge.refunded`. Enable "Listen to events on Connected accounts" for `account.updated`.
- **App Store Server Notifications v2:** production and sandbox URLs both set to `<SUPABASE_URL>/functions/v1/appstore-notifications`.

## 7. Point the app at the project 🤖
In `ClubHQ/Core/AppConfig.swift` set `supabaseURL` and `supabasePublishableKey` (the publishable/anon key, which is safe in clients; RLS protects data). Demo Mode remains available from the sign-in screen.

## 8. Acceptance checklist
- [ ] Sign up on iOS → create team → invite link → second account joins as parent with a child.
- [ ] Coach creates an event; the parent sees it and RSVPs; the coach sees the count.
- [ ] Team chat message from web shows on iOS and vice versa.
- [ ] Push arrives on a real iPhone for a web-posted announcement (needs APNs secrets + cron).
- [ ] Parent generates a player code for a 13+ child; the child's account joins; the child sees team chat but not "parents" threads.
- [ ] Coach connects Stripe; the parent pays → item shows Paid (webhook).
- [ ] Sandbox Coach Pro purchase → `app_store_subscriptions` row → second team creation allowed.
- [ ] Delete account removes roles/links and signs out.

## 9. Admin portal (D-041)
- Migration `20261025010434_admin_portal.sql` (applied 2026-10-25): admin tables, report-evidence bucket, `admin_*` read functions, Pro grants in `user_has_coach_pro` / `team_is_pro`.
- The portal is part of the site: `site/adminportal/`, published by `scripts/deploy-site.sh` to https://teamclubhq.com/adminportal. Its CSP and `noindex` headers are in `site/_headers`.
- Add an admin: Settings → Admins in the portal (owner), or `insert into platform_admins (email, role) values (...)`.
- Due account deletions run from the portal's Overview banner (no cron job yet; `pg_cron` isn't enabled).
- Live checks: `node supabase/tests/d041_live_check.mjs` and `supabase/tests/admin_portal_ui_check.mjs` (see file headers).
