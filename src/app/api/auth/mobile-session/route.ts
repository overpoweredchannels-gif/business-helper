import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type MobileSessionBody = {
  accessToken?: unknown;
  refreshToken?: unknown;
  destination?: unknown;
};

const safeDestination = (value: unknown) => value === "/onboarding" ? "/onboarding" : "/";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const headerAccessToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const body = await request.json().catch(() => ({} as MobileSessionBody));
  // Android WebView does not reliably retain custom headers on POST requests.
  // Accept the access token in the HTTPS JSON body as well as the standard
  // Authorization header so the same validated session can be bridged safely.
  const bodyAccessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const accessToken = headerAccessToken || bodyAccessToken;
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ ok: false, error: "A complete mobile session is required." }, { status: 401 });
  }

  const destination = safeDestination(body.destination);
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ ok: false, error: "The mobile session is invalid or expired." }, { status: 401 });
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError) {
    return NextResponse.json({ ok: false, error: "The TradeOS web session could not be opened." }, { status: 401 });
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}
