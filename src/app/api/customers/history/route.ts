import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "sales_view");
  if (!permission.allowed || !permission.actor?.organizationId) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }

  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  const [customersResult, transactionsResult, paymentsResult, allocationsResult, ordersResult, productsResult, profilesResult] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, customer_name, shop_name, organization_name, contact_person, phone, whatsapp, city, area, address, shipping_address, customer_type, credit_policy, credit_limit, credit_days, is_active, notes, assigned_salesman_id, assigned_territory_id")
        .eq("organization_id", organizationId)
        .order("customer_name", { ascending: true }),
      supabase
        .from("sales_transactions")
        .select("id, customer_id, invoice_number, invoice_type, total_amount, status, sale_date, created_at, created_by_profile_id, payment_type, credit_due_date")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("customer_payments")
        .select("id, customer_id, amount, payment_date, payment_method, notes, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("customer_payment_allocations")
        .select("customer_payment_id, sales_transaction_id, amount")
        .eq("organization_id", organizationId),
      supabase
        .from("sales_orders")
        .select("id, customer_id, so_number, status, order_date, expected_date, created_at, created_by_profile_id")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select("id, name, unit_type, subunit_type")
        .eq("organization_id", organizationId),
      supabase
        .from("profiles")
        .select("id, display_name, email")
        .eq("organization_id", organizationId),
    ]);

  const firstError = [
    customersResult.error,
    transactionsResult.error,
    paymentsResult.error,
    allocationsResult.error,
    ordersResult.error,
    productsResult.error,
    profilesResult.error,
  ].find(Boolean);
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const transactionIds = (transactionsResult.data ?? []).map((row) => row.id);
  const orderIds = (ordersResult.data ?? []).map((row) => row.id);
  const [itemsResult, orderItemsResult] = await Promise.all([
    transactionIds.length
      ? supabase
          .from("sales_items")
          .select("id, sales_transaction_id, product_id, quantity, selling_price, discount, unit_mode, created_at")
          .in("sales_transaction_id", transactionIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? supabase
          .from("sales_order_items")
          .select("id, sales_order_id, product_id, quantity_ordered, quantity_delivered, unit_price, discount, unit_mode, created_at")
          .in("sales_order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (itemsResult.error || orderItemsResult.error) {
    return NextResponse.json(
      { ok: false, error: itemsResult.error?.message ?? orderItemsResult.error?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    customers: customersResult.data ?? [],
    transactions: transactionsResult.data ?? [],
    salesItems: itemsResult.data ?? [],
    payments: paymentsResult.data ?? [],
    allocations: allocationsResult.data ?? [],
    orders: ordersResult.data ?? [],
    orderItems: orderItemsResult.data ?? [],
    products: productsResult.data ?? [],
    profiles: profilesResult.data ?? [],
  });
}
