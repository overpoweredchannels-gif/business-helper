import { allPages } from "@/lib/supabase/all-pages";
import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";
import { loadSalesmanAssignmentScope } from "@/lib/sales/salesman-workspace-service";
import { hasSalesTool } from "@/lib/sales/access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId || !context.actor.profileId) {
    return NextResponse.json({ ok: false, error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }
  const actor = context.actor;

  try {
    if (!hasSalesTool(context.actor.salesAccess ?? {}, "invoice") && !hasSalesTool(context.actor.salesAccess ?? {}, "orders")) {
      return NextResponse.json({ ok: false, error: "Sales permission is required." }, { status: 403 });
    }
    const scope = await loadSalesmanAssignmentScope({
      organizationId: context.actor.organizationId,
      profileId: context.actor.profileId,
    });
    if (!scope || scope.employee.is_active === false) {
      return NextResponse.json({ ok: false, error: "An active employee profile is required." }, { status: 403 });
    }

    const supabase = createSupabaseService();
    const { data: products, error } = await allPages((from, to) => supabase
      .from("products")
      .select("id, name, sku, unit_type, current_stock, default_selling_price")
      .eq("organization_id", actor.organizationId)
      .order("name", { ascending: true })
      .order("id", { ascending: true }).range(from, to));
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const { data: customers, error: customerError } = await allPages((from, to) => supabase.from("customers")
      .select("id, customer_name, shop_name, phone, area, city, address")
      .eq("organization_id", actor.organizationId).eq("is_active", true)
      .order("customer_name", { ascending: true }).order("id", { ascending: true }).range(from, to));
    if (customerError) throw new Error(customerError.message);

    return NextResponse.json({
      ok: true,
      customers: customers ?? [],
      products: products ?? [],
      assignment: {
        territory: scope.territory,
        route: scope.route,
        eligible_customer_count: customers?.length ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not load sale options." },
      { status: 500 },
    );
  }
}
