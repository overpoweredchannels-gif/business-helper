"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatPKR } from "@/lib/tradeos/formatters";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { format } from "date-fns";

interface CustomerHistoryProps {
  organizationId: string | null;
  supabase: any;
  actorProfileId: string | null;
  createAuditLog: (params: any) => Promise<void>;
  customerId?: string | null;
}

export default function CustomerHistory({
  organizationId,
  supabase,
  actorProfileId,
  createAuditLog,
  customerId,
}: CustomerHistoryProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(customerId ?? null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [salesTransactions, setSalesTransactions] = useState<any[]>([]);
  const [customerPayments, setCustomerPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    fetchCustomers();
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !selectedCustomerId) return;
    fetchCustomerHistory();
  }, [organizationId, selectedCustomerId]);

  // If customerId is passed as prop, lock the selection
  useEffect(() => {
    if (customerId) {
      setSelectedCustomerId(customerId);
    }
  }, [customerId]);

  const fetchCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_name, shop_name, phone, city, credit_limit, credit_policy, credit_days")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("customer_name", { ascending: true });

      if (error) throw error;
      setCustomers(data ?? []);
    } catch (err) {
      console.error("Failed to fetch customers:", err);
    }
  };

  const fetchCustomerHistory = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [salesRes, paymentsRes] = await Promise.all([
        supabase
          .from("sales_transactions")
          .select(`
            id, invoice_number, invoice_type, total_amount, status, created_at,
            sales_items(id, product_id, quantity, unit_price, total_price, unit_mode)
          `)
          .eq("organization_id", organizationId)
          .eq("customer_id", selectedCustomerId)
          .order("created_at", { ascending: false }),
        supabase
          .from("customer_payments")
          .select("id, amount, payment_method, reference_number, notes, created_at")
          .eq("organization_id", organizationId)
          .eq("customer_id", selectedCustomerId)
          .order("created_at", { ascending: false }),
      ]);

      if (salesRes.error) throw salesRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      setSalesTransactions(salesRes.data ?? []);
      setCustomerPayments(paymentsRes.data ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? `Failed to load history: ${err.message}` : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => {
    const totalSales = salesTransactions
      .filter((t) => t.status !== "cancelled")
      .reduce((sum, t) => sum + Number(t.total_amount || 0), 0);
    const totalPaid = customerPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const outstanding = totalSales - totalPaid;
    const unpaidInvoices = salesTransactions
      .filter((t) => t.status === "pending" || t.status === "partially_paid")
      .map((t) => ({
        invoiceNumber: t.invoice_number,
        date: t.created_at,
        amount: Number(t.total_amount || 0),
        items: t.sales_items?.length ?? 0,
      }));
    return { totalSales, totalPaid, outstanding, unpaidInvoices };
  }, [salesTransactions, customerPayments]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-medium text-foreground">Customer History</h2>
      </div>

      {!customerId && (
        <div className="rounded border border-border bg-card p-4">
          <label className="flex flex-col gap-2 text-sm text-foreground/80">
            <span>Select Customer</span>
            <select
              value={selectedCustomerId ?? ""}
              onChange={(e) => setSelectedCustomerId(e.target.value || null)}
              className="rounded border border-border px-3 py-2 w-full sm:w-80"
            >
              <option value="">Select a customer...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customer_name} {c.shop_name ? `(${c.shop_name})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!selectedCustomerId && !customerId && (
        <div className="rounded border border-border bg-muted/30 p-8 text-center">
          <p className="text-muted-foreground">Select a customer to view their history.</p>
        </div>
      )}

      {selectedCustomerId && selectedCustomer && (
        <div className="space-y-4">
          <div className="rounded border border-border bg-card p-4">
            <h3 className="mb-3 text-lg font-medium text-foreground">
              {selectedCustomer.customer_name}
              {selectedCustomer.shop_name && <span className="ml-2 text-foreground/60">({selectedCustomer.shop_name})</span>}
            </h3>
            <div className="grid gap-3 sm:grid-cols-4 text-sm">
              <div className="rounded border border-border/50 bg-muted/30 p-3">
                <div className="text-muted-foreground/80">Phone</div>
                <div className="font-medium">{selectedCustomer.phone ?? "—"}</div>
              </div>
              <div className="rounded border border-border/50 bg-muted/30 p-3">
                <div className="text-muted-foreground/80">City</div>
                <div className="font-medium">{selectedCustomer.city ?? "—"}</div>
              </div>
              <div className="rounded border border-border/50 bg-muted/30 p-3">
                <div className="text-muted-foreground/80">Credit Policy</div>
                <div className="font-medium capitalize">{selectedCustomer.credit_policy?.replace("_", " ") ?? "Cash Only"}</div>
              </div>
              <div className="rounded border border-border/50 bg-muted/30 p-3">
                <div className="text-muted-foreground/80">Credit Limit</div>
                <div className="font-medium">{formatPKR(selectedCustomer.credit_limit)}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded border border-success/20 bg-success/5 p-4">
              <div className="text-sm text-muted-foreground/80">Total Sales</div>
              <div className="text-2xl font-bold text-success">{formatPKR(totals.totalSales)}</div>
            </div>
            <div className="rounded border border-primary/20 bg-primary/5 p-4">
              <div className="text-sm text-muted-foreground/80">Total Paid</div>
              <div className="text-2xl font-bold text-primary">{formatPKR(totals.totalPaid)}</div>
            </div>
            <div className={`rounded border p-4 ${totals.outstanding > 0 ? "border-destructive/20 bg-destructive/5" : "border-success/20 bg-success/5"}`}>
              <div className="text-sm text-muted-foreground/80">Outstanding Balance</div>
              <div className={`text-2xl font-bold ${totals.outstanding > 0 ? "text-destructive" : "text-success"}`}>
                {formatPKR(totals.outstanding)}
              </div>
            </div>
          </div>

          {totals.unpaidInvoices.length > 0 && (
            <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
              <h4 className="mb-3 text-sm font-medium text-destructive">Unpaid Invoices ({totals.unpaidInvoices.length})</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-destructive/30 text-left text-xs uppercase tracking-wide text-destructive/80">
                      <th className="py-2 pr-3 font-medium">Invoice</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Amount</th>
                      <th className="py-2 font-medium">Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.unpaidInvoices.map((inv) => (
                      <tr key={inv.invoiceNumber} className="border-b border-destructive/10">
                        <td className="py-2 pr-3 font-medium text-destructive">{inv.invoiceNumber}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{format(new Date(inv.date), "dd MMM yyyy")}</td>
                        <td className="py-2 pr-3 text-destructive font-medium">{formatPKR(inv.amount)}</td>
                        <td className="py-2 text-muted-foreground">{inv.items}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded border border-border bg-card p-4">
            <h4 className="mb-3 text-sm font-medium text-foreground">All Sales Transactions</h4>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : salesTransactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales transactions found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground/80">
                      <th className="py-2 pr-3 font-medium">Invoice</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Amount</th>
                      <th className="py-2 font-medium">Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesTransactions.map((tx) => (
                      <tr key={tx.id} className="border-b border-border/50">
                        <td className="py-2 pr-3 font-medium text-foreground">{tx.invoice_number}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{format(new Date(tx.created_at), "dd MMM yyyy HH:mm")}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{tx.invoice_type}</td>
                        <td className="py-2 pr-3">
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            tx.status === "paid" ? "bg-success/10 text-success" :
                            tx.status === "pending" ? "bg-warning/10 text-warning" :
                            tx.status === "partially_paid" ? "bg-primary/10 text-primary" :
                            "bg-destructive/10 text-destructive"
                          }`}>{tx.status}</span>
                        </td>
                        <td className="py-2 pr-3 text-foreground">{formatPKR(tx.total_amount)}</td>
                        <td className="py-2 text-muted-foreground">{tx.sales_items?.length ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded border border-border bg-card p-4">
            <h4 className="mb-3 text-sm font-medium text-foreground">Payments Received</h4>
            {customerPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground/80">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Method</th>
                      <th className="py-2 pr-3 font-medium">Amount</th>
                      <th className="py-2 pr-3 font-medium">Reference</th>
                      <th className="py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerPayments.map((p) => (
                      <tr key={p.id} className="border-b border-border/50">
                        <td className="py-2 pr-3 text-muted-foreground">{format(new Date(p.created_at), "dd MMM yyyy HH:mm")}</td>
                        <td className="py-2 pr-3 capitalize">{p.payment_method}</td>
                        <td className="py-2 pr-3 text-success font-medium">{formatPKR(p.amount)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{p.reference_number ?? "—"}</td>
                        <td className="py-2 text-muted-foreground">{p.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {message && (
        <p className={`text-sm ${message.startsWith("Failed") ? "text-destructive" : "text-success"}`}>{message}</p>
      )}
    </div>
  );
}