# Generates branded ClubHQ auth email templates (Supabase Go-template syntax).
import json, pathlib
def page(heading, intro, footer):
    return f"""<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:20px" cellpadding="0" cellspacing="0">
<tr><td style="padding:32px 32px 8px"><div style="font-size:20px;font-weight:700;color:#2457f5">ClubHQ</div></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="font-size:22px;margin:0 0 12px">{heading}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 20px;color:#334155">{intro}</p>
<div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#eef2ff;border-radius:14px;padding:18px 0;color:#1838c9">{{{{ .Token }}}}</div>
<p style="font-size:14px;line-height:1.5;margin:20px 0 0;color:#64748b">This code expires in 1 hour. {footer}</p></td></tr>
<tr><td style="padding:24px 32px 32px"><p style="font-size:12px;color:#94a3b8;margin:0">ClubHQ · The ad-free team app for coaches, parents, and players · <a href="https://teamclubhq.com" style="color:#94a3b8">teamclubhq.com</a></p></td></tr>
</table></td></tr></table></body></html>"""
t = {
  "confirmation": ("Confirm your email", "Welcome to ClubHQ! Enter this code in the app to finish creating your account:", "If you didn't sign up for ClubHQ, you can ignore this email."),
  "recovery": ("Reset your password", "Enter this code in the ClubHQ app to choose a new password:", "If you didn't ask to reset your password, you can ignore this email — your password won't change."),
  "magic_link": ("Your sign-in code", "Enter this code in the ClubHQ app to sign in:", "If you didn't try to sign in, you can ignore this email."),
  "email_change": ("Confirm your new email", "Enter this code in the ClubHQ app to confirm your new email address:", "If you didn't request this change, contact info@teamclubhq.com."),
  "reauthentication": ("Confirm it's you", "Enter this code in the ClubHQ app to continue:", "If you didn't request this, contact info@teamclubhq.com."),
}
out = pathlib.Path(__file__).parent
for name, (h, i, f) in t.items():
    (out / f"{name}.html").write_text(page(h, i, f))
print("templates:", ", ".join(t))
