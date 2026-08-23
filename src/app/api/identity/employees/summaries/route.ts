import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/identity/authorization";
import { createSupabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const permission = await requirePermission(request, "administration");
  if (!permission.allowed || !permission.actor) {
    return NextResponse.json({ ok: false, error: permission.reason ?? "Forbidden" }, { status: 403 });
  }
  const organizationId = permission.actor.organizationId;
  const supabase = createSupabaseService();
  const [employeesResult, customersResult, transactionsResult, allocationsResult, routesResult, territoriesResult] = await Promise.all([
    supabase.from("employees").select("id, profile_id, full_name, designation, phone, status, employee_id, assigned_territory_id, assigned_route_id").eq("organization_id", organizationId).order("full_name"),
    supabase.from("customers").select("id, customer_name, shop_name, assigned_salesman_id, assigned_territory_id").eq("organization_id", organizationId),
    supabase.from("sales_transactions").select("id, customer_id, invoice_number, total_amount, status, created_by_profile_id, sale_date, created_at").eq("organization_id", organizationId),
    supabase.from("customer_payment_allocations").select("sales_transaction_id, amount").eq("organization_id", organizationId),
    supabase.from("sales_routes").select("id, name, territory_id, assigned_salesman_id").eq("organization_id", organizationId),
    supabase.from("territories").select("id, name").eq("organization_id", organizationId),
  ]);
  const error = [employeesResult.error, customersResult.error, transactionsResult.error, allocationsResult.error, routesResult.error, territoriesResult.error].find(Boolean);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const allocationsByTransaction = new Map<string, number>();
  for (const allocation of allocationsResult.data ?? []) {
    const id = String(allocation.sales_transaction_id);
    allocationsByTransaction.set(id, (allocationsByTransaction.get(id) ?? 0) + Number(allocation.amount ?? 0));
  }
  const validTransactions = (transactionsResult.data ?? []).filter((transaction) => !["cancelled", "void"].includes(String(transaction.status)));
  const routeById = new Map((routesResult.data ?? []).map((route) => [String(route.id), route]));
  const territoryById = new Map((territoriesResult.data ?? []).map((territory) => [String(territory.id), territory]));

  const employees = (employeesResult.data ?? []).map((employee) => {
    const assignedCustomers = (customersResult.data ?? []).filter((customer) => String(customer.assigned_salesman_id) === String(employee.id));
    const assignedCustomerIds = new Set(assignedCustomers.map((customer) => String(customer.id)));
    const portfolioInvoices = validTransactions.filter((transaction) => assignedCustomerIds.has(String(transaction.customer_id)));
    const authoredInvoices = validTransactions.filter((transaction) => employee.profile_id && String(transaction.created_by_profile_id) === String(employee.profile_id));
    const customerRows = assignedCustomers.map((customer) => {
      const invoices = validTransactions.filter((transaction) => String(transaction.customer_id) === String(customer.id));
      const totalSales = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount ?? 0), 0);
      const remaining = invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total_amount ?? 0) - (allocationsByTransaction.get(String(invoice.id)) ?? 0)), 0);
      const unpaid = invoices.filter((invoice) => Number(invoice.total_amount ?? 0) - (allocationsByTransaction.get(String(invoice.id)) ?? 0) > 0.005).length;
      return { ...customer, invoice_count: invoices.length, total_sales: totalSales, remaining_balance: remaining, unpaid_invoices: unpaid };
    });
    const totalSales = portfolioInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount ?? 0), 0);
    const remainingBalance = portfolioInvoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total_amount ?? 0) - (allocationsByTransaction.get(String(invoice.id)) ?? 0)), 0);
    const unpaidInvoices = portfolioInvoices.filter((invoice) => Number(invoice.total_amount ?? 0) - (allocationsByTransaction.get(String(invoice.id)) ?? 0) > 0.005).length;
    const route = employee.assigned_route_id ? routeById.get(String(employee.assigned_route_id)) : null;
    const territory = employee.assigned_territory_id ? territoryById.get(String(employee.assigned_territory_id)) : null;
    return {
      ...employee,
      assigned_route_name: route?.name ?? null,
      assigned_territory_name: territory?.name ?? null,
      assigned_customer_count: assignedCustomers.length,
      invoice_count: portfolioInvoices.length,
      authored_invoice_count: authoredInvoices.length,
      total_sales: totalSales,
      remaining_balance: remainingBalance,
      unpaid_invoices: unpaidInvoices,
      customers: customerRows,
    };
  });
  return NextResponse.json({ ok: true, employees, routes: routesResult.data ?? [], territories: territoriesResult.data ?? [] });
}
