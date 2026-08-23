import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";
import { loadSalesmanAssignmentScope } from "@/lib/sales/salesman-workspace-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId || !context.actor.profileId) {
    return NextResponse.json({ ok: false, error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }

  try {
    const scope = await loadSalesmanAssignmentScope({
      organizationId: context.actor.organizationId,
      profileId: context.actor.profileId,
    });
    if (!scope || scope.employee.is_active === false) {
      return NextResponse.json({ ok: false, error: "An active employee profile is required." }, { status: 403 });
    }

    const supabase = createSupabaseService();
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, sku, unit_type, current_stock, default_selling_price")
      .eq("organization_id", context.actor.organizationId)
      .order("name", { ascending: true })
      .limit(1000);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      customers: scope.customers,
      products: products ?? [],
      assignment: {
        territory: scope.territory,
        route: scope.route,
        eligible_customer_count: scope.eligibleCustomerIds.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load sale options." },
      { status: 500 },
    );
  }
}
