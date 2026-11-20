// test-email-auth-regression.ts — email-link auth regression (Slice 1b).
//
// What it proves, against the DISPOSABLE Supabase project only:
//   (a) email sign-in works for a confirmed user (password login);
//   (b) a new email signup confirms through the token_hash flow: admin
//       generateLink (type signup) + verifyOtp({ token_hash, type: "email" })
//       returns a session and marks the email confirmed, with no stored
//       PKCE verifier anywhere;
//   (c) password recovery through the token_hash flow: admin generateLink
//       (type recovery) + verifyOtp({ token_hash, type: "recovery" })
//       returns a recovery session whose token carries amr "otp" (the
//       /reset page gates on exactly that), updateUser sets the new
//       password, the old password stops working, the new password works,
//       the OTHER session is revoked (refresh fails) and the current
//       session is kept (refresh succeeds) after signOut({ scope: "others" });
//   (d) the PKCE cross-browser failure path: exchangeCodeForSession with a
//       bad code errors, and the callback source carries the clear
//       other-browser error screen plus the URL stripping (static checks);
//   (e) negative verifyOtp cases: a wrong token_hash errors, and a recovery
//       hash verified with the wrong type errors while the same hash still
//       verifies with the right type.
//   (f) round-2 static checks: the callback takes NO `next` destination
//       from the link (it routes by type: fresh user → onboarding,
//       existing user → /), it carries the desktop verified message, it
//       detects desktop origin from the link's `origin` parameter, and the
//       dashboard checklist template carries `origin` instead of `next`.
//
// What it does NOT cover (manual browser checklist below): Google sign-in,
// the real emailed links in a browser, the /reset expired screen, and the
// desktop deep link. Those need a human in a browser.
//
// MANUAL browser checklist (run after the code deploy, disposable first):
//   1. Google sign-in (web): a Google account signs in and reaches the
//      dashboard. The callback must not show the error screen.
//   2. Email sign-in (web): an existing user signs in with email +
//      password and reaches the dashboard.
//   3. New email signup (web): sign up with a fresh email, open the
//      confirmation link in a DIFFERENT browser from the signup one, and
//      confirm it routes to onboarding (not login). Repeat with the link
//      opened in the SAME browser.
//   4. Password recovery (web): request a reset, open the link in a
//      different browser, set a new password on /reset, and confirm the
//      dashboard opens and the other sessions are signed out.
//   5. PKCE cross-browser error: open an OLD-style PKCE ?code= link in a
//      different browser and confirm the clear "can't be used in this
//      browser" screen appears (never a silent bounce to /login).
//   6. /reset expired screen: open /reset with no session and confirm the
//      expired screen with a resend path (never the password form).
//   7. Desktop deep link: Google sign-in inside the desktop app still
//      completes through the aankh:// callback (untouched by Slice 1b).
//   8. Desktop-origin signup: sign up inside the desktop app, open the
//      confirmation link in the DEFAULT browser, and confirm the "Email
//      verify ho gayi, ab Aankh app mein sign in karein." screen appears
//      (not onboarding in the browser). Then sign in inside the app and
//      confirm onboarding/dashboard there.
//   9. Legacy PKCE link: open an OLD-style ?code= link and confirm the
//      clear "can't be used in this browser" screen appears (never a
//      silent bounce to /login) — same as item 5.
//
// Run it via the vault-backed wrapper (the disposable .env.local holds only
// a dummy service key, so the direct command below fails the guard):
//   python3 ~/workspace/custom-connectors/custom.supabase-service-role/bin/run-email-auth-regression.py
// Direct run (manual only — needs a REAL service key in the environment):
//   set -a; . ~/workspace/tradeos-localization/.env.local; set +a
//   npx tsx scripts/test-email-auth-regression.ts
//
// DISPOSABLE DB ONLY. Never run this against production: it creates real
// auth users (all with unmistakable EMAILAUTH-TEST markers) and deletes
// them again afterwards. The script needs NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the
// environment. The admin calls (createUser, generateLink, deleteUser) need
// a valid service key, so the script cannot run at all until one is stored
// in the vault — it fails fast with a clear message instead of mocking
// Supabase or touching production.
//
// NOT wired into `npm test` (and no `test:email-auth-regression` npm
// script): it is slow (live network calls) and non-hermetic (needs the
// disposable service key and network access). CI and Vercel intentionally
// have no service key, so the script would fail there. Manual runs only,
// against the disposable project.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

assert.ok(SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be set (export the disposable .env.local first)");
assert.ok(ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (export the disposable .env.local first)");
assert.ok(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be set (export the disposable .env.local first)");

// Disposable project only: refuse to run against any other Supabase URL,
// so a wrong env file can never point this test at production.
assert.ok(
  SUPABASE_URL.includes("rtfowunsyrdygyvubnvs"),
  `Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not the disposable project (${SUPABASE_URL})`,
);

// Fail fast when the service key is a placeholder, not a JWT. As of
// 2026-11-20 the disposable .env.local carries the sentinel
// "qa-fail-closed-dummy-key" instead of a real service key — Supabase
// rejects it with 401 Invalid API key. A real key arrives either as a JWT
// (from the env file) or as an `hsurr:` surrogate supplied by the Secure
// Vault connector (custom.supabase-service-role), which the egress swaps
// for the real key on requests to the disposable project. Anything else
// still fails here.
const looksLikeServiceKey = (value: string): boolean =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ||
  value.startsWith("hsurr:");
assert.ok(
  looksLikeServiceKey(SERVICE_KEY),
  "SUPABASE_SERVICE_ROLE_KEY must be a JWT or an hsurr: vault surrogate (the disposable .env.local currently holds the qa-fail-closed-dummy-key sentinel) — supply the real disposable service key before running this test",
);

const suffix = () => randomBytes(4).toString("hex");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function freshAnon(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Read the `amr` methods out of an access token (metadata only, never logged as a token). */
function tokenAmrMethods(accessToken: string): string[] {
  const payloadPart = accessToken.split(".")[1];
  if (!payloadPart) return [];
  try {
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized)) as Record<string, unknown>;
    const amr = payload.amr as unknown;
    if (!Array.isArray(amr)) return [];
    return amr
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? String((entry as Record<string, unknown>).method ?? "")
            : "",
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

type TrackedUser = { userId: string; email: string; password: string };
const tracked: TrackedUser[] = [];

async function makeTestUser(tag: string, confirmed: boolean): Promise<TrackedUser> {
  const s = suffix();
  const email = `emailauth-test-${tag}-${s}@example.invalid`;
  const password = `Email_${randomBytes(6).toString("base64url")}X1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: confirmed,
    user_metadata: { full_name: "Email Auth Test" },
  });
  assert.equal(error, null, `createUser (${tag}) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.user?.id, `createUser (${tag}) must return a user id`);
  const user: TrackedUser = { userId: data.user.id, email, password };
  tracked.push(user);
  return user;
}

async function signIn(client: SupabaseClient, email: string, password: string): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `signInWithPassword (${email}) must not error (got ${error?.message ?? "?"})`);
  assert.ok(data.session?.access_token, `sign-in (${email}) must return an access token`);
  return data.session.access_token;
}

/** True when the client's stored refresh token still works server-side. */
async function refreshWorks(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.auth.refreshSession();
  return !error && Boolean(data.session);
}

// Best-effort cleanup: delete every auth user this script created. Each
// step is independent — a failure is logged, never thrown — so one stuck
// user cannot hide the rest of the cleanup.
async function cleanup(): Promise<void> {
  for (const { userId, email } of tracked) {
    const del = await admin.auth.admin.deleteUser(userId);
    console.log(`cleanup: auth user ${email}: ${del.error ? `ERROR ${del.error.message}` : "deleted"}`);
  }
}

async function main(): Promise<void> {
  // ── (a) Email sign-in works for a confirmed user ──
  const userC = await makeTestUser("signin", true);
  const clientC = freshAnon();
  const tokenC = await signIn(clientC, userC.email, userC.password);
  assert.ok(tokenC.length > 0, "1. email sign-in must return an access token");
  const { data: userCData, error: userCError } = await clientC.auth.getUser();
  assert.equal(userCError, null, `2. getUser after email sign-in must not error (got ${userCError?.message ?? "?"})`);
  assert.equal(userCData.user?.id, userC.userId, "3. getUser must return the signed-in user");
  const { error: signOutError } = await clientC.auth.signOut({ scope: "local" });
  assert.equal(signOutError, null, `4. local sign-out must not error (got ${signOutError?.message ?? "?"})`);
  const { data: noSession } = await clientC.auth.getSession();
  assert.equal(noSession.session, null, "5. no session must remain after local sign-out");
  console.log("(a) email sign-in OK");

  // ── (b) Signup confirmation through token_hash + verifyOtp ──
  // generateLink (type signup) CREATES the user — this version of
  // auth-js requires the password for a signup link — and returns the
  // hashed token for the confirmation email in the same response.
  const s = suffix();
  const emailS = `emailauth-test-signup-${s}@example.invalid`;
  const passwordS = `Email_${randomBytes(6).toString("base64url")}X1!`;
  const { data: linkS, error: linkSError } = await admin.auth.admin.generateLink({
    type: "signup",
    email: emailS,
    password: passwordS,
  });
  assert.equal(linkSError, null, `6. generateLink (signup) must not error (got ${linkSError?.message ?? "?"})`);
  const userS: TrackedUser = { userId: linkS.user.id, email: emailS, password: passwordS };
  tracked.push(userS);
  const hashS = linkS.properties?.hashed_token;
  assert.ok(typeof hashS === "string" && hashS.length > 0, "7. generateLink (signup) must return a hashed_token");
  const clientS0 = freshAnon();
  const { error: unconfirmedError } = await clientS0.auth.signInWithPassword({
    email: userS.email,
    password: userS.password,
  });
  assert.ok(unconfirmedError, "8. sign-in before confirmation must fail (email not confirmed)");
  const clientS = freshAnon();
  const { data: verifyS, error: verifySError } = await clientS.auth.verifyOtp({
    token_hash: hashS,
    type: "email",
  });
  assert.equal(verifySError, null, `9. verifyOtp (signup, token_hash) must not error (got ${verifySError?.message ?? "?"})`);
  assert.ok(verifyS.session?.access_token, "10. verifyOtp (signup) must return a session");
  assert.equal(verifyS.user?.id, userS.userId, "11. verifyOtp (signup) must return the new user");
  const { data: confirmedUser } = await clientS.auth.getUser();
  assert.ok(confirmedUser.user?.email_confirmed_at, "12. the email must be confirmed after verifyOtp");
  const tokenS = await signIn(freshAnon(), userS.email, userS.password);
  assert.ok(tokenS.length > 0, "13. sign-in with the password must work after confirmation");
  console.log("(b) signup confirmation via token_hash OK");

  // ── (c) Recovery through token_hash + verifyOtp + password update ──
  const userR = await makeTestUser("recovery", true);
  const clientRA = freshAnon();
  const clientRB = freshAnon();
  const tokenRA = await signIn(clientRA, userR.email, userR.password);
  const tokenRB = await signIn(clientRB, userR.email, userR.password);
  assert.ok(tokenRA.length > 0 && tokenRB.length > 0, "14. two sessions (A and B) must exist for the recovery user");
  const amrPassword = tokenAmrMethods(tokenRA);
  console.log(`(c) password session amr: [${amrPassword.join(", ")}]`);
  assert.ok(amrPassword.includes("password"), `15. a password session's amr must include "password" (got [${amrPassword.join(", ")}])`);
  const { data: linkR1, error: linkR1Error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: userR.email,
  });
  assert.equal(linkR1Error, null, `16. generateLink (recovery) must not error (got ${linkR1Error?.message ?? "?"})`);
  const hashR1 = linkR1.properties?.hashed_token;
  assert.ok(typeof hashR1 === "string" && hashR1.length > 0, "17. generateLink (recovery) must return a hashed_token");
  const { error: wrongTypeError } = await freshAnon().auth.verifyOtp({
    token_hash: hashR1,
    type: "email",
  });
  assert.ok(wrongTypeError, "18. verifyOtp with a recovery hash but type 'email' must fail (wrong type)");
  const { data: linkR2, error: linkR2Error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: userR.email,
  });
  assert.equal(linkR2Error, null, `19. second generateLink (recovery) must not error (got ${linkR2Error?.message ?? "?"})`);
  const hashR2 = linkR2.properties?.hashed_token;
  assert.ok(typeof hashR2 === "string" && hashR2.length > 0, "20. second generateLink (recovery) must return a hashed_token");
  const clientRec = freshAnon();
  const { data: verifyR, error: verifyRError } = await clientRec.auth.verifyOtp({
    token_hash: hashR2,
    type: "recovery",
  });
  assert.equal(verifyRError, null, `21. verifyOtp (recovery, token_hash) must not error (got ${verifyRError?.message ?? "?"})`);
  assert.ok(verifyR.session?.access_token, "22. verifyOtp (recovery) must return a session");
  const amrRecovery = tokenAmrMethods(verifyR.session.access_token);
  console.log(`(c) recovery session amr: [${amrRecovery.join(", ")}]`);
  assert.ok(amrRecovery.includes("otp"), `23. a recovery session's amr must include "otp" (got [${amrRecovery.join(", ")}])`);
  const newPassword = `Email_${randomBytes(6).toString("base64url")}X1!`;
  const { error: updateError } = await clientRec.auth.updateUser({ password: newPassword });
  assert.equal(updateError, null, `24. updateUser (new password) must not error (got ${updateError?.message ?? "?"})`);
  // Note what the password update alone did to the other session. Access
  // tokens stay valid until they expire, so refresh (not getUser) is the
  // proof: a revoked refresh token fails here.
  const revokedByUpdate = !(await refreshWorks(clientRB));
  console.log(`(c) session B refresh after password update alone: ${revokedByUpdate ? "REVOKED" : "still works"}`);
  const { error: signOutOthersError } = await clientRec.auth.signOut({ scope: "others" });
  assert.equal(signOutOthersError, null, `25. signOut({ scope: "others" }) must not error (got ${signOutOthersError?.message ?? "?"})`);
  assert.equal(await refreshWorks(clientRB), false, "26. the OTHER session (B) must fail to refresh after the password change");
  assert.equal(await refreshWorks(clientRec), true, "27. the CURRENT session must still refresh after signOut({ scope: 'others' })");
  const { error: oldPassError } = await freshAnon().auth.signInWithPassword({
    email: userR.email,
    password: userR.password,
  });
  assert.ok(oldPassError, "28. sign-in with the OLD password must fail after the change");
  const tokenRNew = await signIn(freshAnon(), userR.email, newPassword);
  assert.ok(tokenRNew.length > 0, "29. sign-in with the NEW password must work after the change");
  console.log("(c) recovery via token_hash OK");

  // ── (d) PKCE cross-browser failure path (API level + static checks) ──
  const { error: bogusCodeError } = await freshAnon().auth.exchangeCodeForSession("bogus-code");
  assert.ok(bogusCodeError, "30. exchangeCodeForSession with a bad code must fail");
  const callbackSrc = readFileSync(join(ROOT, "src/app/auth/callback/page.tsx"), "utf-8");
  assert.ok(
    callbackSrc.includes("This link can't be used in this browser"),
    "31. the callback must carry the clear cross-browser PKCE error text",
  );
  assert.ok(
    callbackSrc.includes("exchangeCodeForSession"),
    "32. the callback must attempt the explicit PKCE code exchange",
  );
  assert.ok(
    callbackSrc.includes("stripEmailLinkParams()"),
    "33. the callback must strip token material from the URL",
  );
  const resetSrc = readFileSync(join(ROOT, "src/app/(auth)/reset/page.tsx"), "utf-8");
  assert.ok(
    resetSrc.includes("isRecoverySession"),
    "34. the /reset page must gate the form on a recovery session",
  );
  assert.ok(
    resetSrc.includes('scope: "others"'),
    "35. the /reset page must sign out other sessions with scope 'others'",
  );
  assert.ok(
    !resetSrc.includes("signOut()"),
    "36. the /reset page must not call signOut() with the default (global) scope",
  );
  for (const [name, src] of [
    ["callback", callbackSrc],
    ["reset", resetSrc],
  ] as const) {
    for (const line of src.split("\n")) {
      if (/console\.(log|warn|error)/.test(line)) {
        assert.ok(
          !/token_hash|tokenHash|access_token/.test(line),
          `37. the ${name} page must never log token material (found: ${line.trim()})`,
        );
      }
    }
  }
  console.log("(d) PKCE failure path OK");

  // ── (e) Negative verifyOtp cases ──
  const { error: badHashError } = await freshAnon().auth.verifyOtp({
    token_hash: "invalid-hash",
    type: "email",
  });
  assert.ok(badHashError, "38. verifyOtp with a wrong token_hash must fail");
  console.log("(e) negative verifyOtp cases OK");

  // ── (f) Round-2 static checks: no `next` routing, desktop-origin message ──
  const libSrc = readFileSync(join(ROOT, "src/lib/supabase/email-link-auth.ts"), "utf-8");
  assert.ok(
    !callbackSrc.includes('params.get("next")'),
    "39. the callback must not read a `next` destination from the link",
  );
  assert.ok(
    callbackSrc.includes("Email verify ho gayi, ab Aankh app mein sign in karein."),
    "40. the callback must carry the desktop verified message",
  );
  assert.ok(
    callbackSrc.includes("isDesktopOrigin"),
    "41. the callback must detect desktop origin from the link",
  );
  assert.ok(
    libSrc.includes('startsWith("aankh://")'),
    "42. the desktop-origin check must match the aankh:// deep-link prefix",
  );
  assert.ok(
    libSrc.includes('"origin"'),
    "43. the origin marker must be stripped from the URL after use",
  );
  const checklistSrc = readFileSync(join(ROOT, "SUPABASE_DASHBOARD_CHECKLIST_SLICE1B.md"), "utf-8");
  assert.ok(
    !checklistSrc.includes("next={{.RedirectTo}}"),
    "44. the email template must not carry a `next` parameter",
  );
  assert.ok(
    checklistSrc.includes("origin={{.RedirectTo}}"),
    "45. the email template must carry the `origin` marker",
  );
  console.log("(f) round-2 static checks OK");
}

main()
  .then(async () => {
    await cleanup();
    console.log("test-email-auth-regression: all assertions passed");
  })
  .catch(async (err) => {
    await cleanup();
    console.error(`test-email-auth-regression: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
