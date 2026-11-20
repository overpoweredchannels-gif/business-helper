import { NextRequest, NextResponse } from "next/server";

/**
 * Shared CORS helpers for CLOUD routes called from the desktop app
 * (HYBRID Slice 1 provision, Slice 2 staff login/me — hardening rule 1:
 * desktop origin only, never a wildcard).
 *
 * The desktop serves its pages from the local standalone server on a RANDOM
 * loopback port, so no fixed origin can be allowlisted. The only origins
 * that can ever be the desktop are loopback origins, which by definition
 * come from the user's own machine — reflecting one is safe, and a website
 * origin can never be loopback. Same-origin web calls carry no Origin
 * header and need no CORS headers.
 */
export const DESKTOP_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

export function corsHeadersFor(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !DESKTOP_ORIGIN_RE.test(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

export function applyCors<T extends NextResponse>(response: T, headers: Record<string, string>): T {
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

/**
 * Preflight for desktop cross-origin calls (a POST with Authorization +
 * Content-Type, or any request carrying an Authorization header, triggers
 * one). The browser must be able to read every response — including 401s —
 * so the route handlers apply the same headers via applyCors.
 */
export function desktopPreflightResponse(request: NextRequest, methods: string): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeadersFor(request),
      "Access-Control-Allow-Methods": `${methods}, OPTIONS`,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
