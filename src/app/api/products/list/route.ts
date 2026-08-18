import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "inventory_view");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? "";
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(Math.max(1, Number(searchParams.get("limit") ?? 100) || 100), 1000);

  const supabase = createSupabaseService();
  let query = supabase
    .from("products")
    .select("id, name, sku, unit_type, current_stock, default_selling_price")
    .eq("organization_id", permission.actor.organizationId)
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (search.trim()) {
    query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, products: data ?? [], nextOffset: (data ?? []).length === limit ? offset + limit : null });
}