import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";
import type { PerformanceSale } from "@/lib/sales/performance";

export async function GET(request: NextRequest) {
  const { actor, error, status } = await resolveActor(request);
  if (!actor) return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
  try {
    const db = createSupabaseService();
    const sales: PerformanceSale[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await db.from("sales_transactions")
        .select("id, invoice_number, sale_date, created_at, customer_id, total_amount, status, customers(customer_name, shop_name), sales_items(quantity, selling_price, discount, products(name, brand_id, brands(name)))")
        .eq("organization_id", actor.organizationId)
        .eq("created_by_profile_id", actor.profileId)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + 499);
      if (result.error) throw new Error(result.error.message);
      sales.push(...(result.data as unknown as PerformanceSale[]));
      if (result.data.length < 500) break;
    }
    return NextResponse.json({ ok: true, sales }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (reason) {
    return NextResponse.json({ ok: false, error: reason instanceof Error ? reason.message : "Could not load your sales." }, { status: 500 });
  }
}
