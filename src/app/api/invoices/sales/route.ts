import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/identity/authorization";
import { querySalesLedger } from "@/lib/invoices/invoice-ledger-service";
import type { InvoiceStatus } from "@/lib/invoices/types";

export const runtime = "nodejs";

/**
 * GET /api/invoices/sales
 *
 * Sales Ledger — Part 2 (invoice number search, full or partial) and
 * Part 3 (universal filters: invoice number, date, customer, salesman,
 * payment type, status) of the Invoice Management Foundation.
 *
 * Query params:
 *   search        full or partial invoice number, e.g. "SAL-000125" or "125"
 *   date_from     ISO date/datetime, inclusive lower bound on sale_date
 *   date_to       ISO date/datetime, inclusive upper bound on sale_date
 *   customer_id   filter by customer
 *   salesman_id   filter by the profile that created the sale (created_by_profile_id)
 *   payment_type  "cash" | "credit"
 *   status        invoice lifecycle status
 *   limit         page size (default 50, max 500)
 *   offset        page offset (default 0)
 */
export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "sales_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const actor = permission.actor;

  try {
    const { searchParams } = new URL(request.url);
    const supabase = createSupabaseService();

    const result = await querySalesLedger(supabase, {
      organizationId: actor.organizationId,
      search: searchParams.get("search") ?? searchParams.get("invoice_number"),
      dateFrom: searchParams.get("date_from"),
      dateTo: searchParams.get("date_to"),
      customerId: searchParams.get("customer_id"),
      salesmanProfileId: searchParams.get("salesman_id"),
      paymentType: searchParams.get("payment_type"),
      status: (searchParams.get("status") as InvoiceStatus | null) ?? null,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      offset: searchParams.get("offset") ? Number(searchParams.get("offset")) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
