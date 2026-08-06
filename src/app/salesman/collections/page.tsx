"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  Banknote, Loader2, ChevronDown, AlertCircle, CheckCircle2, Plus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Collection {
  id: string;
  amount: number;
  method: string;
  status: string;
  created_at: string;
  reference_number?: string | null;
  customers?: { customer_name?: string; shop_name?: string };
}

interface Customer {
  id: string;
  customer_name: string;
  shop_name?: string;
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "cheque" | "bank_transfer">("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [colRes, custRes] = await Promise.all([
        authorizedFetch("/api/collections"),
        authorizedFetch("/api/customers"),
      ]);
      const colData = await colRes.json();
      const custData = await custRes.json();
      if (colData.ok) setCollections(colData.collections ?? []);
      if (Array.isArray(custData.customers)) setCustomers(custData.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const amt = Number(amount);
      if (!customerId) throw new Error("Select a customer");
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const payload: any = { customerId, amount: amt, method };
      if (referenceNumber.trim()) payload.referenceNumber = referenceNumber.trim();
      if (notes.trim()) payload.notes = notes.trim();
      const res = await authorizedFetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to record collection");
      setMessage({ type: "ok", text: "Collection recorded. It awaits approval." });
      setCustomerId(""); setAmount(""); setReferenceNumber(""); setNotes("");
      setShowNew(false);
      await loadData();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to record collection" });
    } finally {
      setSaving(false);
    }
  };

  const pendingTotal = collections.filter((c) => c.status === "pending").reduce((s, c) => s + Number(c.amount), 0);
  const approvedTotal = collections.filter((c) => c.status === "approved").reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">Collections</h1>
          <p className="text-sm text-body mt-1">Record cash, cheque, or bank transfer payments from customers.</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {showNew ? <X className="size-4" /> : <Banknote className="size-4" />}
          {showNew ? "Close" : "Record collection"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs font-medium text-light-text uppercase tracking-wide mb-1">Pending approval</div>
          <div className="font-heading font-bold text-2xl text-warning">{fmt(pendingTotal)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs font-medium text-light-text uppercase tracking-wide mb-1">Approved total</div>
          <div className="font-heading font-bold text-2xl text-success">{fmt(approvedTotal)}</div>
        </div>
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
          <h2 className="font-semibold text-foreground">Record a collection</h2>

          <div>
            <label className="text-sm font-medium text-foreground">Customer</label>
            <div className="relative mt-1.5">
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-card px-3.5 pr-10 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.shop_name || c.customer_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Amount</label>
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Method</label>
              <div className="mt-1.5">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as any)}
                  className="w-full h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
                >
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
            </div>
          </div>

          {method !== "cash" && (
            <div>
              <label className="text-sm font-medium text-foreground">
                {method === "cheque" ? "Cheque number" : "Transfer reference"}
              </label>
              <input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={method === "cheque" ? "e.g. CHQ-00123" : "e.g. IBTRX-8842"}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes"
              className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-primary-foreground font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
            {saving ? "Recording..." : "Record collection"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading collections...</p>
        </div>
      ) : collections.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Banknote className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No collections recorded yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {collections.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{c.customers?.shop_name || c.customers?.customer_name}</div>
                <div className="text-xs text-body capitalize">{c.method.replace("_", " ")}{c.reference_number ? ` · ${c.reference_number}` : ""}</div>
                <div className="text-xs text-light-text mt-0.5">{new Date(c.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-3">
                <CollectionStatus status={c.status} />
                <span className="font-semibold text-foreground">{fmt(c.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionStatus({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-warning/10 text-warning",
    approved: "bg-success/10 text-success",
    rejected: "bg-destructive/10 text-destructive",
  };
  const labels: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  return (
    <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap", styles[status] ?? "bg-muted text-muted-foreground")}>
      {labels[status] ?? status}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}