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
