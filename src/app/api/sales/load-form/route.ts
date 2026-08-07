import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";
import { buildLoadForm, LoadFormFilters } from "@/lib/sales/load-form-service";

export const runtime = "nodejs";

/**
 * GET /api/sales/load-form
 *
 * Aggregates confirmed sales into a distributor Load Form grouped by salesman
 * then customer.
 *
 * Query params:
 *   customer_ids  comma-separated customer ids (OR filter)
 *   salesman_ids  comma-separated salesman profile ids - created_by_profile_id (OR)
 *   date_from     YYYY-MM-DD inclusive lower bound on sale_date
 *   date_to       YYYY-MM-DD inclusive upper bound on sale_date
 *
 * Response: { ok, summary: { org_name, org_address, org_phone, salesmen, ... } }
 * where each salesman has `customers` and each customer has `lines` with
 * packing/cartons/pcs/bonus/total_value/bonus_value.
 */
export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (error || !actor) {
    return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  }

  const { searchParams } = new URL(request.url);
  const splitIds = (val: string | null) =>
    (val ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const filters: LoadFormFilters = {
    organizationId: actor.organizationId ?? "",
    customerIds: splitIds(searchParams.get("customer_ids")),
    salesmanIds: splitIds(searchParams.get("salesman_ids")),
    dateFrom: searchParams.get("date_from"),
    dateTo: searchParams.get("date_to"),
  };

  try {
    const supabase = createSupabaseService();

    const { data: org } = await supabase
      .from("organizations")
      .select("name, address, city, phone")
      .eq("id", actor.organizationId)
      .maybeSingle();

    filters.org = org ?? null;

    const result = await buildLoadForm(supabase, filters);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, summary: result.summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}