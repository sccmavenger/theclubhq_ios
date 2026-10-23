# teamclubhq.com

A static site with no build step, deployed to **Cloudflare Pages**. Routes are in `_redirects`, headers in `_headers`.

| URL | File | Purpose |
|---|---|---|
| `/` | `index.html` | Landing page |
| `/join/<token>` | `join.html` | Team invite: opens the app, or shows the code to paste |
| `/auth/callback` | `auth-callback.html` | Supabase email confirm / password reset → app |
| `/payments/return` | `payments-return.html` | After Stripe Checkout / Connect onboarding |
| `/privacy`, `/terms`, `/support` | `*.html` | Required by App Review. **Privacy and Terms are DRAFTS** that need legal review |
| `/download` | `download.html` | "Coming soon" until the App Store listing exists |
| `/.well-known/apple-app-site-association` | Universal Links | Replace `TEAMID` with your Apple Developer Team ID |

## Deploy
Cloudflare Pages project **`teamclubhq`** (production branch `main`; custom domains `teamclubhq.com`, `www.teamclubhq.com`).
From the repo root: `scripts/deploy-site.sh` (uses `npx wrangler`; sign in once with `npx wrangler login`).

## One-time setup (GoDaddy domain → Cloudflare)
The domain stays registered at GoDaddy. Only DNS moves to Cloudflare.

1. **Cloudflare account** (free) → *Add a domain* → `teamclubhq.com` → Free plan. Cloudflare imports your existing DNS records. Check that any email (MX) records came across.
2. Cloudflare shows **two nameservers** (e.g. `ada.ns.cloudflare.com`).
3. **GoDaddy** → My Products → `teamclubhq.com` → DNS → **Nameservers** → *Change* → "I'll use my own nameservers" → enter the two Cloudflare nameservers → Save. This takes from minutes up to 24 hours.
4. **Cloudflare** → Workers & Pages → Create → Pages → *Upload assets* → upload the contents of this `site/` folder. Or connect the GitHub repo with build output directory `site`.
5. In the Pages project → **Custom domains** → add `teamclubhq.com` and `www.teamclubhq.com`.
6. Check: open `https://teamclubhq.com/join/test123`. It should show the invite page with code `test123`.

## Supabase settings that point here
Authentication → URL Configuration:
- **Site URL:** `https://teamclubhq.com`
- **Redirect URLs:** `https://teamclubhq.com/auth/callback`, `clubhq://auth-callback`

## Email from @teamclubhq.com
For production auth emails, use a custom SMTP provider, e.g. **Resend**:
1. Add `teamclubhq.com` in Resend. It gives you SPF, DKIM, and MX records; add them in Cloudflare DNS.
2. Add a DMARC record: `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@teamclubhq.com`.
3. Supabase → Authentication → Emails → **SMTP settings**: host `smtp.resend.com`, port 465, user `resend`, password = your Resend API key, sender `no-reply@teamclubhq.com`, name "ClubHQ".
