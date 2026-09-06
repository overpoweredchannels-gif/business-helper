import { NextRequest, NextResponse } from "next/server";
import { requireSalesTool } from "@/lib/sales/authorization";
import { canViewAllSales } from "@/lib/sales/access";
import { createSupabaseService } from "@/lib/supabase/server";
import { buildSalesInvoices, SalesInvoiceFilters } from "@/lib/sales/sales-invoice-service";

export const runtime = "nodejs";

/**
 * GET /api/sales/invoices/query
 *
 * Assembles printable sales invoice documents matching the filters:
 *   customer_ids  comma-separated customer ids (OR)
 *   salesman_ids  comma-separated salesman profile ids (OR)
 *   route_ids     comma-separated sales route ids (customers on those routes)
 *   areas         comma-separated customer area names (OR)
 *   cities        comma-separated customer city names (OR)
 *   date_from     YYYY-MM-DD inclusive lower bound on sale_date
 *   date_to       YYYY-MM-DD inclusive upper bound on sale_date
 *
 * Response: { ok, docs: [...] } where each doc is a ready-to-print invoice.
 */
export async function GET(request: NextRequest) {
  const permission = await requireSalesTool(request, "invoices");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const split = (val: string | null) =>
    (val ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const filters: SalesInvoiceFilters = {
    organizationId: permission.actor.organizationId,
    customerIds: split(searchParams.get("customer_ids")),
    salesmanIds: canViewAllSales(permission.actor.role) ? split(searchParams.get("salesman_ids")) : [permission.actor.profileId],
    routeIds: split(searchParams.get("route_ids")),
    areas: split(searchParams.get("areas")),
    cities: split(searchParams.get("cities")),
    dateFrom: searchParams.get("date_from"),
    dateTo: searchParams.get("date_to"),
  };

  try {
    const supabase = createSupabaseService();

    const { data: org } = await supabase
      .from("organizations")
      .select("name, address, city, phone")
      .eq("id", permission.actor.organizationId)
      .maybeSingle();
    filters.org = org ?? null;

    const result = await buildSalesInvoices(supabase, filters);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, docs: result.docs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}