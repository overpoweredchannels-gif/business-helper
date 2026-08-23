"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  ClipboardList, Loader2, Search, Plus, Trash2, AlertCircle, CheckCircle2, X, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Draft {
  id: string;
  so_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  notes?: string | null;
  customers?: { customer_name?: string; shop_name?: string };
  sales_order_items?: Array<{ product_id: string; quantity_ordered: number; unit_price: number; discount?: number }>;
}

interface Customer {
  id: string;
  customer_name: string;
  shop_name?: string;
  phone?: string;
}

interface AssignmentSummary {
  territory?: { id?: string; name?: string } | null;
  route?: { id?: string; name?: string } | null;
  eligible_customer_count?: number;
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  current_stock: number;
  default_selling_price: number;
}

interface DraftItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  stock: number;
}

export default function DraftsPage() {
  const searchParams = useSearchParams();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [showNew, setShowNew] = useState(searchParams.get("new") === "1");

  // New draft form
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [assignment, setAssignment] = useState<AssignmentSummary | null>(null);
  const [recentPrices, setRecentPrices] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/sales/drafts/mine");
      const data = await res.json();
      if (data.ok) {
        setDrafts(data.drafts ?? []);
      } else {
        setError(data.error || "Failed to load drafts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFormData = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/identity/staff/sales-options");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load assigned customers and products");
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setAssignment(data.assignment ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load sale options");
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    loadFormData();
  }, [loadDrafts, loadFormData]);

  useEffect(() => {
    if (searchParams.get("new") === "1") setShowNew(true);
  }, [searchParams]);

  const selectCustomer = useCallback(async (nextCustomerId: string) => {
    setCustomerId(nextCustomerId);
    setItems([]);
    setRecentPrices({});
    if (!nextCustomerId) return;
    try {
      const response = await authorizedFetch(`/api/customers/${nextCustomerId}/pricing`);
      const data = await response.json();
      if (!response.ok || !data.ok) return;
      setRecentPrices(Object.fromEntries((data.prices ?? []).map((price: { product_id: string; last_selling_price: number }) => [String(price.product_id), Number(price.last_selling_price)])));
    } catch {
      // The product default remains available if price history cannot be loaded.
    }
  }, []);

  useEffect(() => {
    const requestedCustomerId = searchParams.get("customer");
    if (requestedCustomerId && !customerId && customers.some((customer) => customer.id === requestedCustomerId)) {
      void selectCustomer(requestedCustomerId);
    }
  }, [customerId, customers, searchParams, selectCustomer]);

  const submitDraft = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (!customerId) throw new Error("Select a customer");
      if (items.length === 0) throw new Error("Add at least one product");
      const res = await authorizedFetch("/api/sales/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          routeId: assignment?.route?.id,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create draft");
      setMessage({ type: "ok", text: `Draft ${data.draft?.so_number ?? ""} created and sent for approval.` });
      setItems([]);
      setCustomerId("");
      setNotes("");
      setShowNew(false);
      await loadDrafts();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to create draft" });
    } finally {
      setSaving(false);
    }
  };

  const addItem = (p: Product) => {
    const existing = items.find((i) => i.productId === p.id);
    if (existing) {
      setItems(items.map((i) => (i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setItems([...items, { productId: p.id, productName: p.name, quantity: 1, unitPrice: recentPrices[String(p.id)] ?? Number(p.default_selling_price ?? 0), stock: Number(p.current_stock ?? 0) }]);
    }
  };

  const updateQty = (id: string, qty: number) => {
    setItems(items.map((i) => (i.productId === id ? { ...i, quantity: Math.max(1, qty) } : i)));
  };

  const updatePrice = (id: string, price: number) => {
    setItems(items.map((item) => item.productId === id ? { ...item, unitPrice: Math.max(0, price) } : item));
  };

  const removeItem = (id: string) => {
    setItems(items.filter((i) => i.productId !== id));
  };

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">My Sales</h1>
          <p className="text-sm text-body mt-1">Create sales for your assigned customers. Your manager approves them before invoicing.</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {showNew ? <X className="size-4" /> : <Plus className="size-4" />}
          {showNew ? "Close" : "New Sale"}
        </button>
      </div>

      {message && (
        <div className={cn(
          "flex items-start gap-2 rounded-2xl border p-4 text-sm",
          message.type === "ok" ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive-bg text-destructive",
        )}>
          {message.type === "ok" ? <CheckCircle2 className="size-4 mt-0.5 shrink-0" /> : <AlertCircle className="size-4 mt-0.5 shrink-0" />}
          {message.text}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive-bg p-4 text-sm text-destructive">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {showNew && (
        <div className="rounded-2xl border border-border bg-card p-6 grid gap-5">
          <div>
            <h2 className="font-semibold text-foreground mb-1">New Sale</h2>
            <p className="text-xs text-body mb-4">
              {[assignment?.territory?.name, assignment?.route?.name].filter(Boolean).join(" · ") || "Direct customer assignments"} · {customers.length} eligible customer(s)
            </p>
            <label className="text-sm font-medium text-foreground">Customer</label>
            <div className="relative mt-1.5">
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <select
                value={customerId}
                onChange={(e) => void selectCustomer(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-card px-3.5 pr-10 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.shop_name || c.customer_name}</option>
                ))}
              </select>
            </div>
            {customers.length === 0 && <p className="mt-2 text-xs text-destructive">No customers are assigned to your route, territory, or employee profile. Ask your manager to assign them first.</p>}
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Products</label>
            <div className="relative mt-1.5 mb-3">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {productSearch.trim() && (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border mb-4">
                {products
                  .filter((p) => (p.name + " " + (p.sku ?? "")).toLowerCase().includes(productSearch.toLowerCase()))
                  .slice(0, 15)
                  .map((p) => (
                    <button key={p.id} onClick={() => addItem(p)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40 text-left">
                      <div>
                        <div className="text-foreground font-medium">{p.name}</div>
                        <div className="text-xs text-body">Stock: {p.current_stock}</div>
                      </div>
                        <div className="text-right"><div className="text-sm font-semibold text-foreground">{fmt(recentPrices[String(p.id)] ?? p.default_selling_price)}</div>{recentPrices[String(p.id)] != null && <div className="text-[10px] text-primary">Last customer price</div>}</div>
                    </button>
                  ))}
                {products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                  <div className="px-4 py-3 text-sm text-body">No products found.</div>
                )}
              </div>
            )}

            {items.length > 0 && (
              <div className="rounded-lg border border-border divide-y divide-border">
                {items.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{item.productName}</div>
                      <label className="mt-1 flex items-center gap-1 text-xs text-body">Price <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updatePrice(item.productId, Number(event.target.value))} className="w-24 rounded border border-input bg-card px-2 py-1 text-xs text-foreground" /></label>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.productId, item.quantity - 1)} className="size-7 rounded-md border border-border text-foreground hover:bg-muted">−</button>
                      <span className="w-8 text-center text-sm font-medium text-foreground">{item.quantity}</span>
                      <button onClick={() => updateQty(item.productId, item.quantity + 1)} className="size-7 rounded-md border border-border text-foreground hover:bg-muted">+</button>
                      <span className="w-20 text-right text-sm font-semibold text-foreground">{fmt(item.quantity * item.unitPrice)}</span>
                      <button onClick={() => removeItem(item.productId)} className="size-7 rounded-md text-destructive hover:bg-destructive/10">
                        <Trash2 className="size-4 mx-auto" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                  <span className="text-sm font-medium text-foreground">Total</span>
                  <span className="font-heading font-bold text-foreground">{fmt(total)}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Order notes..."
              className="w-full mt-1.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <button
            onClick={submitDraft}
            disabled={saving || customers.length === 0}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-primary-foreground font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {saving ? "Sending for approval..." : "Send for approval"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading drafts...</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <ClipboardList className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No drafts yet.</p>
          <p className="text-xs text-light-text mt-1">Create a draft from a visit or use the New draft button.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{d.so_number}</div>
                <div className="text-xs text-body">{d.customers?.shop_name || d.customers?.customer_name}</div>
                <div className="text-xs text-light-text mt-0.5">{new Date(d.created_at).toLocaleDateString()}</div>
                {d.status === "rejected" && d.notes && (
                  <div className="text-xs text-destructive mt-1 line-clamp-2">
                    {d.notes.replace(/^\[Rejected:\s*|\]\s*$/g, "").trim()}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={d.status} />
                <span className="font-semibold text-foreground">{fmt(d.total_amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending_approval: "bg-warning/10 text-warning",
    approved: "bg-success/10 text-success",
    rejected: "bg-destructive/10 text-destructive",
    converted: "bg-primary/10 text-primary",
    draft: "bg-muted text-muted-foreground",
  };
  const labels: Record<string, string> = {
    pending_approval: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    converted: "Converted to invoice",
    draft: "Draft",
  };
  return (
    <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap", styles[status] ?? "bg-muted text-muted-foreground")}>
      {labels[status] ?? status}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}
