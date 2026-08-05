import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { Customer } from "@/lib/tradeos/types";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "customers_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const supabase = createSupabaseService();
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, customer_name, shop_name, phone, whatsapp, city, area, customer_type, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method, is_active, notes",
    )
    .eq("organization_id", permission.actor.organizationId)
    .order("customer_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ customers: (data ?? []) as Customer[] });
}