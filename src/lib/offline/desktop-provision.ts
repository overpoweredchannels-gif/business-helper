/**
 * Desktop provision skip (2026-11-19).
 *
 * `POST /api/auth/provision` calls `createSupabaseService()`
 * (`src/lib/supabase/server.ts`), which throws without
 * `SUPABASE_SERVICE_ROLE_KEY`. That key is deliberately never shipped in
 * the desktop build — CI bakes in only `NEXT_PUBLIC_SUPABASE_URL` +
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` — so on desktop the provision route
 * always answers 500. `checkAuthUser` in `src/app/page.tsx` used to call
 * it on desktop whenever online, and its catch then nulled the profile /
 * organization and invalidated the dashboard session, so the dashboard
 * read tracker was never activated and every card stayed "Not loaded"
 * forever (run #4 installer, commit 23dadd7, owner signed in).
 *
 * The fix: on desktop, never call provision and load the profile directly
 * with `loadProfile(user.id)` — that reads the profile row with the
 * user's JWT via the browser client, which works on desktop. Web
 * behaviour is exactly unchanged: provision always runs there.
 *
 * The decision is a pure function of two inputs so it is unit-testable:
 * whether this is the desktop shell, and whether the device is online.
 * The offline case keeps the pre-existing Slice S1 skip (the POST cannot
 * succeed offline either); the online desktop case is the 2026-11-19
 * fix (the POST cannot succeed because the local server has no
 * service-role key, even online).
 */
export function shouldRunProvision(input: { isDesktop: boolean; isOnline: boolean }): boolean {
  // Web: provision always runs, online or offline (unchanged behaviour).
  if (!input.isDesktop) return true;
  // Desktop: the local server has no SUPABASE_SERVICE_ROLE_KEY, so the
  // provision route 500s whether online or offline — never call it.
  return false;
}

/**
 * Desktop auth-callback routing (2026-11-19).
 *
 * `src/app/auth/callback/page.tsx` used to POST /api/auth/provision after
 * every Google sign-in / email verification and, on ANY non-OK response
 * (including the desktop 500 — same missing service-role key as above),
 * pushed the user back to /login. So on desktop a user who had just
 * completed sign-in was bounced to login and never reached the dashboard
 * or onboarding, even after the checkAuthUser provision skip. The fix:
 * on desktop the callback skips the provision POST and routes by reading
 * the user's own profile row with the browser client instead.
 *
 * Pure mapping so it is unit-testable: a profile with an organization
 * goes home; a profile without one (new user) goes to onboarding.
 */
export function resolveDesktopCallbackRoute(hasOrganization: boolean): "/" | "/onboarding" {
  return hasOrganization ? "/" : "/onboarding";
}
