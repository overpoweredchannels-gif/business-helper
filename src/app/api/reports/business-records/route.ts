import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";
import { allPages } from "@/lib/supabase/all-pages";
import { reportRange, type ReportSection } from "@/lib/print/business-report";

export const maxDuration = 60;

export async function GET(request: Request) {
  const permission = await requireOwner(request);
  if (!permission.allowed || !permission.actor) return NextResponse.json({ ok: false, error: "Owner access required" }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams; const range = reportRange(params.get("from") ?? "", params.get("to") ?? "");
    const db = createSupabaseService(); const org = permission.actor.organizationId;
    const definitions = [
      ["Sales invoices", "sales_transactions", "sale_date", ["invoice_number", "sale_date", "customer_id", "status", "payment_type", "total_amount"]],
      ["Purchases", "purchase_transactions", "purchase_date", ["invoice_number", "purchase_date", "supplier_id", "status", "total_amount"]],
      ["Customer payments", "customer_payments", "payment_date", ["payment_date", "customer_id", "amount", "payment_method", "reference_number", "notes"]],
      ["Supplier payments", "supplier_payments", "payment_date", ["payment_date", "supplier_id", "amount", "payment_method", "reference_number", "notes"]],
      ["Expenses", "expenses", "expense_date", ["expense_date", "expense_type", "amount", "notes"]],
      ["Inventory movements", "inventory_transactions", "created_at", ["created_at", "product_id", "movement_type", "quantity_delta", "reason", "reference_type", "reference_id"]],
      ["New customers", "customers", "created_at", ["created_at", "customer_name", "shop_name", "city", "phone"]],
      ["New products", "products", "created_at", ["created_at", "name", "sku", "unit_type", "reorder_level"]],
      ["Recorded activity", "audit_logs", "created_at", ["created_at", "actor_profile_id", "action", "entity_type", "entity_id", "entity_label", "description"]],
    ] as const;
    const sections: ReportSection[] = [];
    const transactionIds: Record<string, string[]> = {};
    for (const [title, table, date, columns] of definitions) {
      const result = await allPages<Record<string, any>>((from, to) => {
        let query = db.from(table).select("*").eq("organization_id", org);
        query = date === "created_at" ? query.gte(date, range.start).lt(date, range.end) : query.gte(date, range.from).lte(date, range.to);
        return query.order(date).order("id").range(from, to);
      });
      if (result.error) throw new Error(`${title}: ${result.error.message}`);
      if (["sales_transactions", "purchase_transactions"].includes(table)) transactionIds[table] = result.data!.map(row => row.id);
      sections.push({ title, columns: [...columns], rows: result.data!.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? ""]))) });
    }
    for (const [table, parent, foreignKey, columns] of [
      ["sales_items", "sales_transactions", "sales_transaction_id", ["sales_transaction_id", "product_id", "quantity", "bonus", "unit_mode", "selling_price", "discount"]],
      ["purchase_items", "purchase_transactions", "purchase_transaction_id", ["purchase_transaction_id", "product_id", "quantity", "unit_mode", "purchase_price"]],
    ] as const) {
      const rows: Record<string, unknown>[] = []; const ids = transactionIds[parent] ?? [];
      for (let start = 0; start < ids.length; start += 100) {
        const result = await allPages<Record<string, any>>((from, to) => db.from(table).select("*").eq("organization_id", org).in(foreignKey, ids.slice(start, start + 100)).order("id").range(from, to));
        if (result.error) throw new Error(result.error.message);
        rows.push(...result.data!.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? ""] ))));
      }
      sections.push({ title: table === "sales_items" ? "Sales invoice lines" : "Purchase invoice lines", columns: [...columns], rows });
    }
    // Replace foreign IDs with human-readable names and invoice numbers.
    for (const [field, table, name] of [["customer_id", "customers", "customer_name"], ["supplier_id", "suppliers", "supplier_name"], ["product_id", "products", "name"], ["actor_profile_id", "profiles", "display_name"], ["sales_transaction_id", "sales_transactions", "invoice_number"], ["purchase_transaction_id", "purchase_transactions", "invoice_number"]]) {
      const refs = await allPages<Record<string, any>>((from, to) => db.from(table).select(`id,${name}`).eq("organization_id", org).order("id").range(from, to));
      if (refs.error) throw new Error(refs.error.message);
      const labels = new Map(refs.data!.map(row => [row.id, row[name]]));
      for (const section of sections) for (const row of section.rows) if (row[field]) row[field] = labels.get(row[field]) ?? row[field];
    }
    return NextResponse.json({ ok: true, ...range, sections }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Report failed" }, { status: 400 }); }
}
