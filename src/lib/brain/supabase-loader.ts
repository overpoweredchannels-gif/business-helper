import { initializeBusinessBrain } from "./bootstrap";
import type { MemoryWriterRawData } from "./contracts/memory";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    tasksRes,
    alertsRes,
  ] = await Promise.all([
    supabase.from("products").select("id, name, brand_id, category_id, unit_type, last_purchase_price, default_selling_price, minimum_stock_level, reorder_level, track_batch, track_expiry, is_active, created_at, updated_at").eq("organization_id", organizationId).order("name", { ascending: true }),
    supabase.from("customers").select("id, customer_name, shop_name, phone, city, area, customer_type, credit_policy, credit_limit, credit_days, allow_over_limit, allow_overdue_sales, preferred_payment_method, created_at, updated_at").eq("organization_id", organizationId).order("customer_name", { ascending: true }),
    supabase.from("suppliers").select("id, supplier_name, contact_person, phone, city, notes, created_at, updated_at").eq("organization_id", organizationId).order("supplier_name", { ascending: true }),
    supabase.from("profiles").select("id, display_name, email, role, is_active, created_at, updated_at").eq("organization_id", organizationId).order("email", { ascending: true }),
    supabase.from("sales_transactions").select("id, customer_id, invoice_number, created_at, sale_date, payment_type, credit_due_date").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("sales_items").select("id, sales_transaction_id, product_id, quantity, selling_price, purchase_price_snapshot, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("purchase_transactions").select("id, supplier_id, invoice_number, created_at, purchase_date, payment_type").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("purchase_items").select("id, purchase_transaction_id, product_id, quantity, purchase_price, selling_price, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("expenses").select("id, expense_type, amount, notes, expense_date, created_at, supplier_id, customer_id").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("customer_payments").select("id, customer_id, amount, payment_date, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("supplier_payments").select("id, supplier_id, amount, payment_date, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title, task_type, priority, status, due_date, created_at, completed_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("ai_alerts").select("id, alert_type, title, summary, severity, status, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);

  const hasError = [
    productsRes, customersRes, suppliersRes, staffRes,
    salesTxRes, salesItemsRes, purchaseTxRes, purchaseItemsRes,
    expensesRes, customerPaymentsRes, supplierPaymentsRes,
    tasksRes, alertsRes,
  ].some((r) => r.error);

  if (hasError) {
    console.error("Supabase queries failed during raw data load");
    return null;
  }

  const data: MemoryWriterRawData = {
    organizationId,
    organizationName: "", // Will be filled by bootstrap if needed
    ownerName: "", // Will be filled by bootstrap if needed
    timezone: "Asia/Karachi",
    products: (productsRes.data ?? []) as MemoryWriterRawData["products"],
    customers: (customersRes.data ?? []) as MemoryWriterRawData["customers"],
    suppliers: (suppliersRes.data ?? []) as MemoryWriterRawData["suppliers"],
    staff: (staffRes.data ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      display_name: String(p.display_name ?? p.email ?? ""),
      role: p.role ? String(p.role) : null,
      phone: null,
      is_active: p.is_active != null ? Boolean(p.is_active) : null,
      created_at: p.created_at ? String(p.created_at) : undefined,
      updated_at: p.updated_at ? String(p.updated_at) : undefined,
    })),
    salesTransactions: (salesTxRes.data ?? []) as MemoryWriterRawData["salesTransactions"],
    salesItems: (salesItemsRes.data ?? []) as MemoryWriterRawData["salesItems"],
    purchaseTransactions: (purchaseTxRes.data ?? []) as MemoryWriterRawData["purchaseTransactions"],
    purchaseItems: (purchaseItemsRes.data ?? []) as MemoryWriterRawData["purchaseItems"],
    expenses: (expensesRes.data ?? []) as MemoryWriterRawData["expenses"],
    customerPayments: (customerPaymentsRes.data ?? []) as MemoryWriterRawData["customerPayments"],
    supplierPayments: (supplierPaymentsRes.data ?? []) as MemoryWriterRawData["supplierPayments"],
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
