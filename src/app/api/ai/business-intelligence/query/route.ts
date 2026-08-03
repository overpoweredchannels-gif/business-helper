import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { resolveActor, buildOrganizationContext } from "@/lib/identity/api-context";
import { loadRawBusinessData } from "@/lib/brain/supabase-loader";
import { UnifiedAssistant } from "@/lib/assistant/assistant";
import { processBusinessIntelligenceQuery, type BusinessIntelligenceQueryKind } from "@/lib/ai/business-intelligence";

const VALID_QUERY_TYPES: BusinessIntelligenceQueryKind[] = [
  "sales_forecast",
  "demand_prediction",
  "reorder_prediction",
  "customer_prediction",
  "supplier_prediction",
  "product_prediction",
  "health_score",
  "recommendations",
];

export async function POST(req: NextRequest) {
  try {
    const { actor, error, status } = await resolveActor(req);
    if (error || !actor) {
      return NextResponse.json({ error }, { status: status ?? 401 });
    }

    const organizationContext = buildOrganizationContext(actor);
    const organization_id = organizationContext.actor.organizationId;
    const body = await req.json();
    const { query_type, message } = body as {
      query_type?: string;
      message?: string;
    };

    // Validate query type
    const resolvedQueryType: BusinessIntelligenceQueryKind =
      query_type && VALID_QUERY_TYPES.includes(query_type as BusinessIntelligenceQueryKind)
        ? (query_type as BusinessIntelligenceQueryKind)
        : "health_score";

    const supabase = createSupabaseService();
    const rawData = await loadRawBusinessData(supabase, organization_id);

    if (!rawData) {
      return NextResponse.json({ error: "Organization data not found" }, { status: 404 });
    }

    rawData.organizationId = organization_id;

    const assistant = new UnifiedAssistant(rawData);
    const intent = assistant.router.classify(message ?? "");

    if (intent.module !== "business-intelligence" || !intent.queryType) {
      return NextResponse.json({ ok: false, error: `Query not routed to business-intelligence module. Routed to: ${intent.module}` }, { status: 400 });
    }

    const result = processBusinessIntelligenceQuery(resolvedQueryType, assistant.store.store, rawData, message ?? "");

    return NextResponse.json({
      ok: result.ok,
      query_type: result.queryType,
      message: result.message,
    });
  } catch (err) {
    console.error("[BI Query] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}