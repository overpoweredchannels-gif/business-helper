import { NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/identity/api-context";
import { createSupabaseService } from "@/lib/supabase/server";
import { hasSalesTool } from "@/lib/sales/access";

export const runtime = "nodejs";

type PriceRow = {
  product_id: string;
  last_selling_price: number;
  unit_mode: "main" | "subunit";
  last_sold_at: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await resolveActor(request);
  if (!context.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: context.error ?? "Unauthorized" }, { status: context.status ?? 401 });
  }

  const { id: customerId } = await params;
  const supabase = createSupabaseService();
  const organizationId = context.actor.organizationId;

  const canViewAllSales = context.actor.isOwner
    || context.actor.permissions?.includes("sales_view")
    || context.actor.permissions?.includes("sales_manage")
    || context.actor.permissions?.includes("administration");
  if (!canViewAllSales && !hasSalesTool(context.actor.salesAccess ?? {}, "invoice") && !hasSalesTool(context.actor.salesAccess ?? {}, "orders")) {
    return NextResponse.json({ ok: false, error: "Sales permission is required." }, { status: 403 });
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (customerError) {
    return NextResponse.json({ ok: false, error: customerError.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from("sales_transactions")
    .select("id, sale_date, created_at, status")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .not("status", "in", "(cancelled,void)")
    .order("sale_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (transactionsError) {
    return NextResponse.json({ ok: false, error: transactionsError.message }, { status: 500 });
  }
  if (!transactions?.length) {
    return NextResponse.json({ ok: true, prices: [] satisfies PriceRow[] });
  }

  const transactionRank = new Map(transactions.map((transaction, index) => [String(transaction.id), index]));
  const transactionDate = new Map(
    transactions.map((transaction) => [
      String(transaction.id),
      String(transaction.sale_date ?? transaction.created_at),
    ]),
  );
  const { data: items, error: itemsError } = await supabase
    .from("sales_items")
    .select("id, sales_transaction_id, product_id, selling_price, unit_mode, created_at")
    .in("sales_transaction_id", transactions.map((transaction) => transaction.id));

  if (itemsError) {
    return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 });
  }

  const sortedItems = [...(items ?? [])].sort((left, right) => {
    const rankDifference =
      (transactionRank.get(String(left.sales_transaction_id)) ?? Number.MAX_SAFE_INTEGER) -
      (transactionRank.get(String(right.sales_transaction_id)) ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) return rankDifference;
    return String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""));
  });

  const pricesByProduct = new Map<string, PriceRow>();
  for (const item of sortedItems) {
    const productId = String(item.product_id);
    if (pricesByProduct.has(productId)) continue;
    const price = Number(item.selling_price);
    if (!Number.isFinite(price) || price < 0) continue;
    pricesByProduct.set(productId, {
      product_id: productId,
      last_selling_price: price,
      unit_mode: item.unit_mode === "subunit" ? "subunit" : "main",
      last_sold_at: transactionDate.get(String(item.sales_transaction_id)) ?? String(item.created_at),
    });
  }

  return NextResponse.json({ ok: true, prices: [...pricesByProduct.values()] });
}
