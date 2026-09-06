import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { buildFinancialLedger } from "@/lib/ai/financial-ledger";
import { processFinancialQuery, FinancialQueryKind } from "@/lib/ai/financial-intelligence";
import { loadRawBusinessData } from "@/lib/brain/supabase-loader";
import { UnifiedAssistant } from "@/lib/assistant/assistant";
import { requirePermission } from "@/lib/identity/authorization";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const permission = await requirePermission(req, "reports_view");
    if (!permission.allowed || !permission.actor?.organizationId) {
      return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
    }
    const organizationId = permission.actor.organizationId;

    const supabase = createSupabaseService();
    const rawData = await loadRawBusinessData(supabase, organizationId);

    if (!rawData) {
      return NextResponse.json({ ok: false, error: "Organization data not found" }, { status: 404 });
    }

    rawData.organizationId = organizationId;

    const assistant = new UnifiedAssistant(rawData, { organizationId });
    const intent = assistant.router.classify("Give me a financial summary");

    if (intent.module !== "financial" || !intent.queryType) {
      return NextResponse.json({ ok: false, error: `Query not routed to financial module. Routed to: ${intent.module}` }, { status: 400 });
    }

    const ledger = buildFinancialLedger(rawData, new Date());
    const result = processFinancialQuery(intent.queryType as FinancialQueryKind, ledger, intent, "Financial Summary API");

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: result.message });
  } catch (err) {
    console.error("API Error:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
