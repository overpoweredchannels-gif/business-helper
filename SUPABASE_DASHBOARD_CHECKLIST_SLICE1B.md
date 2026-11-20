# Supabase Dashboard Checklist — Slice 1b (email-link auth fix)

Do the DISPOSABLE project FIRST, verify, then repeat the same steps on
PRODUCTION. The code cannot set any of this — it all lives in the Supabase
dashboard, and the code expects exactly the link formats below.

- Disposable project: **rtfowunsyrdygyvubnvs**
  Dashboard: https://supabase.com/dashboard/project/rtfowunsyrdygyvubnvs
  Site URL for this project: **http://localhost:3000** (the local dev server)
- Production project: **lhqmtgrstvwtysfjjmhz**
  Dashboard: https://supabase.com/dashboard/project/lhqmtgrstvwtysfjjmhz
  Site URL for this project: **https://business-helper-ten.vercel.app**

## 1. Site URL

Authentication → URL Configuration → Site URL.

- Disposable: `http://localhost:3000`
- Production: `https://business-helper-ten.vercel.app`

This is the base the email templates build their links from
(`{{.SiteURL}}`). It must be the app's own domain — never a different
domain, never a URL with a path after it.

## 2. Redirect URLs (allow-list)

Authentication → URL Configuration → Redirect URLs. ADD the entries below.
**Keep every existing entry** — the `aankh://auth/callback` deep link and
any `localhost` entries stay exactly as they are. Only add what is missing.

Disposable (add both):
- `http://localhost:3000/auth/callback`
- `http://localhost:3000/auth/callback?type=recovery`

Production (add both):
- `https://business-helper-ten.vercel.app/auth/callback`
- `https://business-helper-ten.vercel.app/auth/callback?type=recovery`

Why both forms: the signup link lands on `/auth/callback`; the password
reset link lands on `/auth/callback?type=recovery` (that is the
`emailRedirectTo` the app passes to `resetPasswordForEmail`). If the
dashboard refuses the `?type=recovery` form, use the wildcard form instead
for that entry (`https://business-helper-ten.vercel.app/auth/callback*` on
production, `http://localhost:3000/auth/callback*` on disposable) — it
covers both.

Do NOT add any other domain, any `*` on a different host, or a URL that
points at the desktop `aankh://` scheme with a different path. The
callback no longer takes any destination from the link — it routes by
link type (confirm → onboarding or dashboard, recovery → /reset). The
dashboard list above is the only thing Supabase will accept as a
`redirect_to`.

## 3. Email templates

Authentication → Email Templates. Edit ONLY the link inside each template
below. Keep the subject and the rest of the body text as they are.

### Confirm signup

Find the link in the template body (it currently uses
`{{.ConfirmationURL}}` — the old PKCE link) and replace it with:

```
{{.SiteURL}}/auth/callback?token_hash={{.TokenHash}}&type=email&origin={{.RedirectTo}}
```

- `{{.TokenHash}}` is the hashed token the new callback redeems with
  `verifyOtp`. It works in ANY browser — the email link opens in the
  default browser, which has no PKCE verifier stored, so the old
  `{{.ConfirmationURL}}` (`?code=...`) link can never work there.
- `origin={{.RedirectTo}}` carries the redirect URL the app passed at
  signup — `aankh://auth/callback` for a desktop-app signup,
  `https://…/auth/callback` for a web signup. The callback only checks
  whether it starts with `aankh://`: if it does, it shows the "Email
  verify ho gayi, ab Aankh app mein sign in karein." screen instead of
  routing to onboarding in the browser (the browser session cannot be
  handed to the app — the app provisions on its own sign-in). It never
  redirects to this value.
- `next` was REMOVED from the link: the callback decides the
  destination from the link type (fresh user → onboarding, existing
  user → dashboard), so a full-URL RedirectTo can no longer loop or be
  rejected by a path allow-list.
- Do NOT use `{{.Token}}` (the 6-digit code) — the app does not offer a
  code-entry screen.

### Reset password

Find the link in the template body (currently `{{.ConfirmationURL}}`) and
replace it with:

```
{{.SiteURL}}/auth/callback?token_hash={{.TokenHash}}&type=recovery
```

- Same token_hash mechanism, type `recovery`. The callback verifies it,
  then sends the user to `/reset`, which shows the new-password form only
  for a valid recovery session.
- Do NOT use `{{.Token}}` here either.

### Leave unchanged

- **Magic Link** template — untouched. (The app does not use magic-link
  sign-in; its template keeps working as before.)
- **Change Email Address** template — untouched.
- **Invite User** template — untouched.

## 4. Verify the Email provider settings (check only, do not change)

Authentication → Providers → Email.

- "Confirm email" must be ON (it already is on both projects — the
  disposable project sends confirmation mail, which is how the old bug was
  proven). If it is off, the signup flow changes meaning; do not toggle it
  without asking.
- "Secure email change" — leave as it is.

## 5. Verify on disposable FIRST

Before touching production, prove the disposable setup works:

1. Run the regression test (needs the valid disposable service key in the
   vault first):
   `python3 ~/workspace/custom-connectors/custom.supabase-service-role/bin/run-email-auth-regression.py`
   It must end with "test-email-auth-regression: all assertions passed".
2. Manual browser checks (use a real email address you control, e.g. a
   `+alias` of your Gmail — the disposable mailer sends real mail):
   - Sign up with a fresh email in one browser, open the confirmation link
     in a DIFFERENT browser → onboarding, not the login page.
   - Request a password reset, open the link in a different browser → the
     `/reset` form appears, set a new password → dashboard opens, and the
     other sessions are signed out.
   - Open `/reset` with no session → the "link expired" screen, not the
     password form.
   - Sign up inside the desktop app, open the confirmation link in the
     default browser → the "Email verify ho gayi, ab Aankh app mein sign
     in karein." screen appears (not onboarding in the browser). Then
     sign in inside the app → onboarding/dashboard there.
   - Open an OLD-style PKCE `?code=` link → the clear "can't be used in
     this browser" screen, never a silent bounce to the login page.
3. Only when all of that passes on disposable, repeat steps 1–3 on the
   production project, then repeat the manual checks against the live app.
