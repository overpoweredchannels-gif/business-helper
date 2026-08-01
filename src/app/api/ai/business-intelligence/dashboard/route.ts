import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { loadRawBusinessData } from "@/lib/brain/supabase-loader";
import { UnifiedAssistant } from "@/lib/assistant/assistant";
import { calculateBusinessIntelligence } from "@/lib/ai/business-intelligence";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const organization_id = searchParams.get("organization_id");

    if (!organization_id) {
      return NextResponse.json({ error: "organization_id is required" }, { status: 400 });
    }

    const supabase = createSupabaseService();
    const rawData = await loadRawBusinessData(supabase, organization_id);

    if (!rawData) {
      return NextResponse.json({ error: "Organization data not found" }, { status: 404 });
    }

    rawData.organizationId = organization_id;

    const assistant = new UnifiedAssistant(rawData);
    const dashboard = calculateBusinessIntelligence(assistant.store.store, rawData);

    return NextResponse.json({
      ok: true,
      organization_id,
      generatedAt: new Date().toISOString(),
      salesForecasting: dashboard.salesForecasting,
      demandPrediction: {
        likelyToSellNext: dashboard.demandPrediction.likelyToSellNext.slice(0, 5),
        categoryDemand: dashboard.demandPrediction.categoryDemand.slice(0, 5),
        slowDemand: dashboard.demandPrediction.slowDemand.slice(0, 5),
        seasonalDemand: dashboard.demandPrediction.seasonalDemand.slice(0, 5),
      },
      smartReorder: dashboard.smartReorder
        .filter((r) => r.urgency === "critical" || r.urgency === "high")
        .slice(0, 10),
      customerIntelligence: {
        highValue: dashboard.customerIntelligence.highValue.slice(0, 5),
        churnRisk: dashboard.customerIntelligence.churnRisk.slice(0, 5),
        inactive: dashboard.customerIntelligence.inactive.slice(0, 5),
        likelyToReorder: dashboard.customerIntelligence.likelyToReorder.slice(0, 5),
      },
      supplierIntelligence: {
        reliable: dashboard.supplierIntelligence.reliable.slice(0, 5),
        delayed: dashboard.supplierIntelligence.delayed.slice(0, 5),
        dependency: dashboard.supplierIntelligence.dependency.slice(0, 5),
      },
      productIntelligence: {
        rising: dashboard.productIntelligence.rising.slice(0, 5),
        declining: dashboard.productIntelligence.declining.slice(0, 5),
        deadStock: dashboard.productIntelligence.deadStock.slice(0, 5),
        highMargin: dashboard.productIntelligence.highMargin.slice(0, 5),
        lowMargin: dashboard.productIntelligence.lowMargin.slice(0, 5),
      },
      businessHealth: dashboard.businessHealth,
      recommendations: dashboard.recommendations.slice(0, 10),
    });
  } catch (err) {
    console.error("[BI Dashboard] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}