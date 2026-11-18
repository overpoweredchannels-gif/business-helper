import assert from "node:assert/strict";
import {
  DESKTOP_AUTH_CALLBACK_URL,
  DESKTOP_AUTH_RECOVERY_CALLBACK_URL,
  isDesktopAuthCallbackUrl,
  parseDesktopAuthCallback,
} from "../src/lib/offline/desktop-auth-callback";

assert.equal(
  DESKTOP_AUTH_CALLBACK_URL,
  "aankh://auth/callback",
  "The allowlisted URL is exactly aankh://auth/callback",
);
assert.equal(
  DESKTOP_AUTH_RECOVERY_CALLBACK_URL,
  "aankh://auth/callback?type=recovery",
  "The recovery URL carries type=recovery",
);

assert.equal(
  isDesktopAuthCallbackUrl("aankh://auth/callback?code=abc"),
  true,
  "A code deep link is recognised",
);
assert.equal(
  isDesktopAuthCallbackUrl("aankh://auth/callback#access_token=x&refresh_token=y"),
  true,
  "A hash deep link is recognised",
);
assert.equal(
  isDesktopAuthCallbackUrl("https://example.com/auth/callback?code=abc"),
  false,
  "An https URL is not a desktop deep link",
);
assert.equal(isDesktopAuthCallbackUrl(""), false, "An empty string is not a deep link");
assert.equal(
  isDesktopAuthCallbackUrl(undefined),
  false,
  "A non-string is not a deep link",
);

// PKCE code links — the normal Google / email-verification case.
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/callback?code=abc123"),
  { ok: true, mode: "code", code: "abc123", type: null },
  "A code link parses to code mode",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/callback?code=abc123&type=recovery"),
  { ok: true, mode: "code", code: "abc123", type: "recovery" },
  "A recovery code link preserves type=recovery",
);

// Implicit hash links — access + refresh tokens from the fragment.
assert.deepEqual(
  parseDesktopAuthCallback(
    "aankh://auth/callback#access_token=at&refresh_token=rt&type=recovery",
  ),
  {
    ok: true,
    mode: "tokens",
    accessToken: "at",
    refreshToken: "rt",
    type: "recovery",
  },
  "A hash-token link parses to tokens mode with its type",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/callback#access_token=at&refresh_token=rt"),
  {
    ok: true,
    mode: "tokens",
    accessToken: "at",
    refreshToken: "rt",
    type: null,
  },
  "A hash-token link without a type parses with type null",
);

// Supabase error links surface their message instead of a generic failure.
assert.deepEqual(
  parseDesktopAuthCallback(
    "aankh://auth/callback?error=access_denied&error_description=User%20denied%20access",
  ),
  { ok: false, error: "User denied access" },
  "A query error link reports its description",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/callback#error=server_error"),
  { ok: false, error: "server_error" },
  "A hash error link reports its error code",
);

// Malformed links fail closed — the app shows the error, never a
// silent return to login.
assert.deepEqual(
  parseDesktopAuthCallback("https://example.com/auth/callback?code=abc"),
  { ok: false, error: "That sign-in link is not valid." },
  "An https link is rejected",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://other/callback?code=abc"),
  { ok: false, error: "That sign-in link is not valid." },
  "A wrong deep-link host is rejected",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/signin?code=abc"),
  { ok: false, error: "That sign-in link is not valid." },
  "A wrong deep-link path is rejected",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/callback"),
  { ok: false, error: "That sign-in link has no sign-in code." },
  "A bare callback link with no code or tokens is rejected",
);
assert.deepEqual(
  parseDesktopAuthCallback("aankh://auth/callback#access_token=at"),
  { ok: false, error: "That sign-in link has no sign-in code." },
  "A hash link with only an access token is rejected",
);
assert.deepEqual(
  parseDesktopAuthCallback(""),
  { ok: false, error: "That sign-in link is not valid." },
  "An empty string is rejected",
);
assert.deepEqual(
  parseDesktopAuthCallback("not a url"),
  { ok: false, error: "That sign-in link is not valid." },
  "A non-URL string is rejected",
);

console.log("test-desktop-auth-callback: all assertions passed");
