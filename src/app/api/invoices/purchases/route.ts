import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { resolveActor } from "@/lib/identity/api-context";
import { queryPurchaseLedger } from "@/lib/invoices/invoice-ledger-service";
import type { InvoiceStatus } from "@/lib/invoices/types";

export const runtime = "nodejs";

/**
 * GET /api/invoices/purchases
 *
 * Purchase Ledger — Part 2 (invoice number search, full or partial) and
 * Part 3 (universal filters: invoice number, date, supplier, status) of the
 * Invoice Management Foundation.
 *
 * Query params:
 *   search        full or partial invoice number, e.g. "PUR-000125" or "125"
 *   date_from     ISO date/datetime, inclusive lower bound on purchase_date
 *   date_to       ISO date/datetime, inclusive upper bound on purchase_date
 *   supplier_id   filter by supplier
 *   status        invoice lifecycle status
 *   limit         page size (default 50, max 500)
 *   offset        page offset (default 0)
 */
export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const supabase = createSupabaseService();

    const result = await queryPurchaseLedger(supabase, {
      organizationId: actor.organizationId,
      search: searchParams.get("search") ?? searchParams.get("invoice_number"),
      dateFrom: searchParams.get("date_from"),
      dateTo: searchParams.get("date_to"),
      supplierId: searchParams.get("supplier_id"),
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
