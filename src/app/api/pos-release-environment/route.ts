import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production" || process.env.POS_RELEASE_TEST_TARGET !== "disposable-pos-atomic-sales") {
    return new NextResponse(null, { status: 404 });
  }

  const urls = [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL].filter(Boolean);
  if (!urls.length) return NextResponse.json({ error: "Supabase URL is not configured" }, { status: 503 });

  return NextResponse.json({ supabaseUrls: urls.map(value => new URL(value!).origin) }, {
    headers: { "cache-control": "no-store" },
  });
}
