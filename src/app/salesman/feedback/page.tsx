"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { MessageSquareText, Loader2, ChevronDown, AlertCircle, CheckCircle2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRegional } from "@/components/regional/RegionalProvider";

interface Feedback {
  id: string;
  type: string;
  title?: string | null;
  description?: string | null;
  priority?: string;
  status?: string;
  created_at: string;
  customers?: { customer_name?: string; shop_name?: string };
}

interface Customer {
  id: string;
  customer_name: string;
  shop_name?: string;
}

export default function MyFeedbackPage() {
  const { t } = useRegional();
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState<"complaint" | "feedback" | "note" | "request">("feedback");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fRes, cRes] = await Promise.all([
        authorizedFetch("/api/feedback?limit=100"),
        authorizedFetch("/api/customers"),
      ]);
      const fData = await fRes.json();
      const cData = await cRes.json();
      if (fData.ok) setFeedback(fData.feedback ?? []);
      if (Array.isArray(cData.customers)) setCustomers(cData.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracking.networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (!customerId) throw new Error(t('salesman.collections.selectCustomerError'));
      if (!description.trim()) throw new Error(t('salesman.feedback.describeError'));
      const res = await authorizedFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, type, title: title.trim() || undefined, description: description.trim(), priority }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t('salesman.feedback.recordFailed'));
      setMessage({ type: "ok", text: t('salesman.feedback.recorded') });
      setCustomerId(""); setTitle(""); setDescription("");
      setShowNew(false);
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('salesman.feedback.recordFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground">{t('salesman.feedback.title')}</h1>
          <p className="text-sm text-body mt-1">{t('salesman.feedback.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          {showNew ? <X className="size-4" /> : <Plus className="size-4" />}
          {showNew ? t('common.close') : t('salesman.feedback.newFeedback')}
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
          <h2 className="font-semibold text-foreground">{t('salesman.feedback.recordTitle')}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">{t('salesman.feedback.customer')}</label>
              <div className="relative mt-1.5">
                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full h-11 rounded-lg border border-input bg-card px-3.5 pr-10 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
                >
                  <option value="">{t('salesman.feedback.selectCustomer')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.shop_name || c.customer_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('salesman.feedback.type')}</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="feedback">{t('salesman.feedback.type.feedback')}</option>
                <option value="complaint">{t('salesman.feedback.type.complaint')}</option>
                <option value="request">{t('salesman.feedback.type.request')}</option>
                <option value="note">{t('salesman.feedback.type.note')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">{t('salesman.feedback.titleLabel')}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('salesman.feedback.titlePlaceholder')}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">{t('salesman.feedback.priority')}</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full mt-1.5 h-11 rounded-lg border border-input bg-card px-3.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring appearance-none"
              >
                <option value="high">{t('salesman.feedback.priority.high')}</option>
                <option value="medium">{t('salesman.feedback.priority.medium')}</option>
                <option value="low">{t('salesman.feedback.priority.low')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">{t('salesman.feedback.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('salesman.feedback.descriptionPlaceholder')}
              className="w-full mt-1.5 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-primary-foreground font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}
            {saving ? t('salesman.visitDetail.saving') : t('salesman.feedback.recordTitle')}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-body">{t('salesman.feedback.loading')}</p>
        </div>
      ) : feedback.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <MessageSquareText className="size-8 text-light-text mx-auto mb-3" />
          <p className="text-sm text-body">{t('salesman.feedback.noFeedback')}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {feedback.map((f) => (
            <div key={f.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <TypeBadge type={f.type} />
                <StatusBadge status={f.status ?? "open"} />
              </div>
              <div className="font-medium text-foreground">{f.title || f.type}</div>
              <p className="text-sm text-body mt-1">{f.description}</p>
              <div className="text-xs text-light-text mt-2">
                {f.customers?.shop_name || f.customers?.customer_name} · {new Date(f.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    complaint: "bg-destructive/10 text-destructive",
    feedback: "bg-primary/10 text-primary",
    note: "bg-muted text-muted-foreground",
    request: "bg-warning/10 text-warning",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", colors[type] ?? "bg-muted text-muted-foreground")}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-warning/10 text-warning",
    in_progress: "bg-primary/10 text-primary",
    resolved: "bg-success/10 text-success",
    closed: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium capitalize", colors[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace("_", " ")}
    </span>
  );
}