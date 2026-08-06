"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  ClipboardList, Loader2, AlertCircle, CheckCircle2, XCircle, ChevronDown, FileText, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DraftItem {
  product_id: number;
  quantity_ordered: number;
  unit_price: number;
  discount?: number;
  products?: { name?: string };
}

interface Draft {
  id: string;
  so_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  notes?: string | null;
  customers?: { customer_name?: string; shop_name?: string };
  profiles?: { full_name?: string | null } | null;
  sales_order_items?: DraftItem[];
}

export default function DraftApprovalsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/sales/drafts?status=pending_approval&limit=50");
      const data = await res.json();
      if (data.ok) setDrafts(data.drafts ?? []);
      else setError(data.error || "Failed to load drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    setActing(id);
    setMessage(null);
    try {
      const body: any = { action };
      if (action === "reject") {
        if (!rejectReason.trim()) {
          setMessage({ type: "error", text: "Enter a reason for rejection." });
          setActing(null);
          return;
        }
        body.reason = rejectReason.trim();
      }
      const res = await authorizedFetch(`/api/sales/drafts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Action failed");
      setMessage({ type: "ok", text: action === "approve" ? `Approved → invoice ${data.invoiceNumber ?? ""}` : "Draft rejected." });
      setRejectReason("");
      setRejecting(null);
      setExpanded(null);
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActing(null);
    }
  };

  const toggleExpand = (id: string) => setExpanded(expanded === id ? null : id);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Draft Approvals</h1>
        <p className="text-sm text-body mt-1">Approve drafts to convert them into invoices — stock and receivables update automatically.</p>
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

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading drafts...</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <ClipboardList className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No drafts pending approval.</p>
          <p className="text-xs text-light-text mt-1">New drafts from salesmen will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {drafts.map((d) => (
            <div key={d.id} className="rounded-2xl border border-border bg-card overflow-hidden">
              <button onClick={() => toggleExpand(d.id)} className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
                    <FileText className="size-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{d.so_number}</div>
                    <div className="text-xs text-body truncate">
                      {d.customers?.shop_name || d.customers?.customer_name} · by {d.profiles?.full_name ?? "Salesman"}
                    </div>
                    <div className="text-xs text-light-text mt-0.5">{new Date(d.created_at).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-heading font-bold text-foreground">{fmt(d.total_amount)}</span>
                  <ChevronDown className={cn("size-4 text-light-text transition-transform", expanded === d.id && "rotate-180")} />
                </div>
              </button>

              {expanded === d.id && (
                <div className="border-t border-border px-5 py-4 grid gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">Items</h3>
                    <div className="rounded-lg border border-border divide-y divide-border">
                      {(d.sales_order_items ?? []).map((item, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <span className="text-foreground">{item.products?.name ?? `Product #${item.product_id}`}</span>
                          <span className="text-body">{item.quantity_ordered} × {fmt(item.unit_price)}</span>
                          <span className="font-semibold text-foreground">{fmt(item.quantity_ordered * item.unit_price - (item.discount ?? 0))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {d.notes && <p className="text-sm text-body">{d.notes}</p>}

                  {rejecting === d.id ? (
                    <div className="grid gap-3">
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={2}
                        placeholder="Reason for rejection (required)"
                        className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div className="flex gap-3">
                        <button
                          onClick={() => act(d.id, "reject")}
                          disabled={acting === d.id}
                          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50"
                        >
                          {acting === d.id ? <Loader2 className="size-4 animate-spin" /> : <ThumbsDown className="size-4" />}
                          Reject
                        </button>
                        <button
                          onClick={() => { setRejecting(null); setRejectReason(""); }}
                          className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => act(d.id, "approve")}
                        disabled={acting === d.id}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                      >
                        {acting === d.id ? <Loader2 className="size-4 animate-spin" /> : <ThumbsUp className="size-4" />}
                        Approve & convert
                      </button>
                      <button
                        onClick={() => setRejecting(d.id)}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm font-medium hover:bg-destructive/10"
                      >
                        <XCircle className="size-4" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}