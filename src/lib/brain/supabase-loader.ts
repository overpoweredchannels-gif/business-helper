import { initializeBusinessBrain } from "./bootstrap";
import type { MemoryWriterRawData } from "./contracts/memory";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTimeZone } from "../regional/settings";
import { resolveBooksCurrency } from "../books/currency";

export async function loadRawBusinessData(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<MemoryWriterRawData | null> {
  const [
    productsRes,
    customersRes,
    suppliersRes,
    staffRes,
    salesTxRes,
    salesItemsRes,
    purchaseTxRes,
    purchaseItemsRes,
    expensesRes,
    customerPaymentsRes,
    supplierPaymentsRes,
    purchaseReturnsRes,
    purchaseReturnItemsRes,
    salesReturnsRes,
    salesReturnItemsRes,
    supplierAllocationsRes,
    customerAllocationsRes,
    tasksRes,
    alertsRes,
  ] = await Promise.all([
    supabase.from("products").select("id, name, brand_id, category_id, unit_type, last_purchase_price, default_selling_price, minimum_stock_level, reorder_level, track_batch, track_expiry, is_active, created_at, updated_at").eq("organization_id", organizationId).order("name", { ascending: true }),
    supabase.from("customers").select("id, customer_name, shop_name, phone, city, area, customer_type, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method, created_at, updated_at").eq("organization_id", organizationId).order("customer_name", { ascending: true }),
    supabase.from("suppliers").select("id, supplier_name, contact_person, phone, city, notes, created_at, updated_at").eq("organization_id", organizationId).order("supplier_name", { ascending: true }),
    supabase.from("profiles").select("id, display_name, email, role, is_active").eq("organization_id", organizationId).order("email", { ascending: true }),
    supabase.from("sales_transactions").select("id, customer_id, invoice_number, created_at, sale_date, payment_type, credit_due_date").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("sales_items").select("id, sales_transaction_id, product_id, quantity, selling_price, purchase_price_snapshot, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("purchase_transactions").select("id, supplier_id, invoice_number, created_at, purchase_date, payment_type").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("purchase_items").select("id, purchase_transaction_id, product_id, quantity, purchase_price, selling_price, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("expenses").select("id, expense_type, amount, notes, expense_date, created_at, supplier_id, customer_id").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("customer_payments").select("id, customer_id, amount, payment_date, voided_at, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("supplier_payments").select("id, supplier_id, amount, payment_date, voided_at, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    // J1b — returns + payment allocations: the exact inputs the
    // dashboard tile's allocation engines consume. Optional
    // collections: a failure substitutes [] and the ledgers fall back
    // to their old FIFO behaviour (same tolerance as the other
    // non-core collections).
    supabase.from("purchase_returns").select("id, purchase_transaction_id, status").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("purchase_return_items").select("id, purchase_return_id, quantity, unit_price").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("sales_returns").select("id, sales_transaction_id, status").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("sales_return_items").select("id, sales_return_id, quantity, unit_price, discount").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("supplier_payment_allocations").select("id, supplier_payment_id, purchase_transaction_id, amount").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("customer_payment_allocations").select("id, customer_payment_id, sales_transaction_id, amount").eq("organization_id", organizationId),
    supabase.from("tasks").select("id, title, task_type, priority, status, due_date, created_at, completed_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("ai_alerts").select("id, alert_type, title, summary, severity, status, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);

  // Per-query tolerance: one failing OPTIONAL collection must not discard the
  // whole load (it is substituted with []). Only CORE collections
  // (products/customers/sales/purchase) still fail the load outright.
  const queryResults: Array<{ name: string; core: boolean; error: unknown }> = [
    { name: "products", core: true, error: productsRes.error },
    { name: "customers", core: true, error: customersRes.error },
    { name: "suppliers", core: false, error: suppliersRes.error },
    { name: "staff", core: false, error: staffRes.error },
    { name: "sales_transactions", core: true, error: salesTxRes.error },
    { name: "sales_items", core: false, error: salesItemsRes.error },
    { name: "purchase_transactions", core: true, error: purchaseTxRes.error },
    { name: "purchase_items", core: false, error: purchaseItemsRes.error },
    { name: "expenses", core: false, error: expensesRes.error },
    { name: "customer_payments", core: false, error: customerPaymentsRes.error },
    { name: "supplier_payments", core: false, error: supplierPaymentsRes.error },
    { name: "purchase_returns", core: false, error: purchaseReturnsRes.error },
    { name: "purchase_return_items", core: false, error: purchaseReturnItemsRes.error },
    { name: "sales_returns", core: false, error: salesReturnsRes.error },
    { name: "sales_return_items", core: false, error: salesReturnItemsRes.error },
    { name: "supplier_payment_allocations", core: false, error: supplierAllocationsRes.error },
    { name: "customer_payment_allocations", core: false, error: customerAllocationsRes.error },
    { name: "tasks", core: false, error: tasksRes.error },
    { name: "ai_alerts", core: false, error: alertsRes.error },
  ];

  for (const { name, core, error } of queryResults) {
    if (!error) continue;
    console.error(`Supabase query failed during raw data load: ${name}`, error);
    if (core) {
      return null;
    }
  }

  // Org timezone + books currency (Area J confirmation fix, 2026-11-20).
  // Source of truth: organizations.books_currency with
  // regional_preferences.accountingCurrency fallback, and
  // regional_preferences.timeZone. Best-effort: any failure leaves the
  // legacy defaults in place and the load continues.
  let orgTimeZone = "Asia/Karachi";
  let orgCurrency = "PKR";
  try {
    const orgRes = await supabase
      .from("organizations")
      .select("books_currency, regional_preferences")
      .eq("id", organizationId)
      .maybeSingle();
    const orgRow = (orgRes?.data ?? null) as {
      books_currency?: unknown;
      regional_preferences?: unknown;
    } | null;
    if (!orgRes?.error && orgRow) {
      orgCurrency = resolveBooksCurrency(orgRow.books_currency, orgRow.regional_preferences);
      const prefs = orgRow.regional_preferences;
      const zone =
        prefs && typeof prefs === "object" && !Array.isArray(prefs)
          ? (prefs as Record<string, unknown>).timeZone
          : null;
      orgTimeZone = parseTimeZone(zone) ?? "Asia/Karachi";
    }
  } catch {
    // Defaults stand.
  }

  const data: MemoryWriterRawData = {
    organizationId,
    organizationName: "", // Will be filled by bootstrap if needed
    ownerName: "", // Will be filled by bootstrap if needed
    // Org timezone + books currency are the source of truth for the
    // conversation runtime (Area J confirmation fix, 2026-11-20):
    // "today" resolves in this timezone and confirmation prices show in
    // this currency. Read best-effort from the organizations row — a
    // missing row/column must never fail the load; the legacy defaults
    // (Asia/Karachi / PKR) apply, exactly as before this change.
    timezone: orgTimeZone,
    currency: orgCurrency,
    products: (productsRes.data ?? []) as MemoryWriterRawData["products"],
    customers: (customersRes.data ?? []) as MemoryWriterRawData["customers"],
    suppliers: (suppliersRes.data ?? []) as MemoryWriterRawData["suppliers"],
    staff: (staffRes.data ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      display_name: String(p.display_name ?? p.email ?? ""),
      role: p.role ? String(p.role) : null,
      phone: null,
      is_active: p.is_active != null ? Boolean(p.is_active) : null,
    })),
    salesTransactions: (salesTxRes.data ?? []) as MemoryWriterRawData["salesTransactions"],
    salesItems: (salesItemsRes.data ?? []) as MemoryWriterRawData["salesItems"],
    purchaseTransactions: (purchaseTxRes.data ?? []) as MemoryWriterRawData["purchaseTransactions"],
    purchaseItems: (purchaseItemsRes.data ?? []) as MemoryWriterRawData["purchaseItems"],
    expenses: (expensesRes.data ?? []) as MemoryWriterRawData["expenses"],
    customerPayments: (customerPaymentsRes.data ?? []) as MemoryWriterRawData["customerPayments"],
    supplierPayments: (supplierPaymentsRes.data ?? []) as MemoryWriterRawData["supplierPayments"],
    // J1b — the tile engines' inputs (see the query comment above).
    purchaseReturns: (purchaseReturnsRes.data ?? []) as MemoryWriterRawData["purchaseReturns"],
    purchaseReturnItems: (purchaseReturnItemsRes.data ?? []) as MemoryWriterRawData["purchaseReturnItems"],
    salesReturns: (salesReturnsRes.data ?? []) as MemoryWriterRawData["salesReturns"],
    salesReturnItems: (salesReturnItemsRes.data ?? []) as MemoryWriterRawData["salesReturnItems"],
    // Cash vs credit (2026-11-25): the tile engines' input for the
    // cash-out ignore — explicit allocations to paid-at-entry purchases.
    supplierPaymentAllocations: (supplierAllocationsRes.data ?? []) as MemoryWriterRawData["supplierPaymentAllocations"],
    customerPaymentAllocations: (customerAllocationsRes.data ?? []) as MemoryWriterRawData["customerPaymentAllocations"],
    tasks: (tasksRes.data ?? []).map((t: Record<string, unknown>) => ({
      id: String(t.id),
      title: String(t.title ?? ""),
      task_type: String(t.task_type ?? "general"),
      priority: String(t.priority ?? "medium"),
      status: String(t.status ?? "pending"),
      due_date: t.due_date ? String(t.due_date) : null,
      created_at: String(t.created_at ?? new Date().toISOString()),
      completed_at: t.completed_at ? String(t.completed_at) : null,
    })),
    alerts: (alertsRes.data ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id),
      alert_type: String(a.alert_type ?? "general"),
      title: String(a.title ?? ""),
      summary: a.summary ? String(a.summary) : null,
      severity: String(a.severity ?? "info"),
      status: String(a.status ?? "active"),
      created_at: String(a.created_at ?? new Date().toISOString()),
    })),
  };
  return data;
}

interface BootstrapResult {
  success: boolean;
  organizationName: string;
  productCount: number;
  customerCount: number;
  error?: string;
}

export async function bootstrapOrganizationData(
  supabase: SupabaseClient,
  organizationId: string,
  organizationName: string,
  ownerName: string
): Promise<BootstrapResult> {
  try {
    const data = await loadRawBusinessData(supabase, organizationId);
    if (!data) {
      return { success: false, organizationName, productCount: 0, customerCount: 0, error: "Failed to load raw business data" };
    }

    data.organizationName = organizationName;
    data.ownerName = ownerName;

    const brain = initializeBusinessBrain(data);

    return {
      success: true,
      organizationName: brain.getMemorySnapshot().organizationName,
      productCount: brain.getMemorySnapshot().productCount,
      customerCount: brain.getMemorySnapshot().customerCount,
    };
  } catch (err) {
    return {
      success: false,
      organizationName,
      productCount: 0,
      customerCount: 0,
      error: err instanceof Error ? err.message : "Unknown bootstrap error",
    };
  }
}
