import { NextRequest, NextResponse } from "next/server";
import { detectQueryLanguage } from "@/lib/ai/business-intelligence";
import { createSupabaseService } from "@/lib/supabase/server";
import { loadRawBusinessData } from "@/lib/brain/supabase-loader";
import { UnifiedAssistant } from "@/lib/assistant/assistant";
import { formatRs } from "@/lib/ai/business-intelligence";
import { 
  getExecutiveAIResponse, 
  getExecutiveDashboardData,
  createExecutiveConversationContext,
  saveExecutiveConversationContext
} from "@/lib/ai/executive-conversation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query_type, message, organization_id, executive_name, language, report_type } = body as {
      query_type?: string;
      message?: string;
      organization_id?: string;
      executive_name?: string;
      language?: "english" | "urdu" | "roman_urdu";
      report_type?: "morning" | "daily" | "weekly" | "monthly";
    };

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
    const intent = assistant.router.classify(message || "");

    const response = await getExecutiveAIResponse(
      organization_id,
      message || "",
      executive_name,
      language || detectQueryLanguage(message || ""),
      report_type,
      intent,
      assistant.store.store,
      rawData
    );

    return NextResponse.json(response);
  } catch (err) {
    console.error("[Executive AI] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const organization_id = searchParams.get("organization_id");
    const executive_name = searchParams.get("executive_name");
    const language = searchParams.get("language") as "english" | "urdu" | "roman_urdu" | null;
    const report_type = searchParams.get("report_type") as "morning" | "daily" | "weekly" | "monthly" | null;

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
    const dashboard = await getExecutiveDashboardData(
      organization_id,
      executive_name,
      language || "english",
      report_type || "morning",
      assistant.store.store,
      rawData
    );

    return NextResponse.json(dashboard);
  } catch (err) {
    console.error("[Executive Dashboard] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
