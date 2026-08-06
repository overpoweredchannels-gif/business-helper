"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { Banknote, Loader2, AlertCircle, CheckCircle2, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Collection {
  id: string;
  amount: number;
  method: string;
  status: string;
  created_at: string;
  reference_number?: string | null;
  customers?: { customer_name?: string; shop_name?: string };
  employees?: { full_name?: string };
}

export default function CollectionsApprovalPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authorizedFetch("/api/collections?limit=100");
      const data = await res.json();
      if (data.ok) setCollections(data.collections ?? []);
      else setError(data.error || "Failed to load collections");
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
      const res = await authorizedFetch(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Action failed");
      setMessage({ type: "ok", text: action === "approve" ? "Collection approved. Customer balance updated." : "Collection rejected." });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActing(null);
    }
  };

  const filtered = filter === "all" ? collections : collections.filter((c) => c.status === filter);
  const pendingCount = collections.filter((c) => c.status === "pending").length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-foreground">Collections</h1>
        <p className="text-sm text-body mt-1">Approve collections from field staff. Approved amounts reduce the customer's balance.</p>
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

      <div className="flex flex-wrap gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-medium capitalize transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f}{f === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">Loading collections...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Banknote className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">No collections in this view.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border bg-card p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{c.customers?.shop_name || c.customers?.customer_name}</div>
                <div className="text-xs text-body capitalize">
                  {c.method.replace("_", " ")}{c.reference_number ? ` · ${c.reference_number}` : ""} · {c.employees?.full_name ?? "Staff"}
                </div>
                <div className="text-xs text-light-text mt-0.5">{new Date(c.created_at).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="font-heading font-bold text-foreground">{fmt(c.amount)}</div>
                  <CollectionStatus status={c.status} />
                </div>
                {c.status === "pending" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => act(c.id, "approve")}
                      disabled={acting === c.id}
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      <ThumbsUp className="size-4" /> Approve
                    </button>
                    <button
                      onClick={() => act(c.id, "reject")}
                      disabled={acting === c.id}
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <ThumbsDown className="size-4" />
                    </button>
                  </div>
                )}
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
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", styles[status] ?? "bg-muted text-muted-foreground")}>
      {labels[status] ?? status}
    </span>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n || 0);
}