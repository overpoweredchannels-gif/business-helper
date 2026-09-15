import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { getEntityConfig } from "@/lib/import-export/registry";
import { suggestImportMapping } from "@/lib/import-export/ai-guidance";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  const permission = await requirePermission(request, "import_export");
  if (!permission.allowed || !permission.actor?.organizationId) return NextResponse.json({ ok: false, error: "Import permission required" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 30000) return NextResponse.json({ ok: false, error: "Too many column headings" }, { status: 413 });
    const body = JSON.parse(text); const config = getEntityConfig(body.entity_key);
    if (!config || !Array.isArray(body.headers) || !body.headers.length || body.headers.length > 100 || body.headers.some((header: unknown) => typeof header !== "string" || !header.trim() || header.length > 200)) return NextResponse.json({ ok: false, error: "Choose a supported record type and up to 100 column headings of 200 characters each" }, { status: 400 });
    const suggestions = await suggestImportMapping(body.headers, config.fields);
    return NextResponse.json({ ok: true, suggestions });
  } catch { return NextResponse.json({ ok: false, error: "AI guidance is unavailable or could not interpret these columns. Continue with saved templates or manual mapping; no records were saved." }, { status: 503 }); }
}
