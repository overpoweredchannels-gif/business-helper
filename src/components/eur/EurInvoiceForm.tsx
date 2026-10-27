"use client";

import { useEffect, useMemo, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { calculateInvoiceTotals, validateEurInvoice } from "@/lib/eur/invoice-service";
import type { EurInvoiceLine, FxQuote } from "@/lib/eur/types";
import { Plus, Trash2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Draft payload passed to onSubmit. Server assigns org, number, status. */
export interface EurInvoiceDraft {
  customer_name: string;
  fx_quote_id: string;
  fx_rate: string;
  lines: EurInvoiceLine[];
  subtotal_eur_cents: number;
  tax_eur_cents: number;
  total_eur_cents: number;
  total_pkr_cents: number;
}

interface EurInvoiceFormProps {
  onSubmit?: (draft: EurInvoiceDraft) => void | Promise<void>;
  className?: string;
}

interface LineDraft {
  id: string;
  description: string;
  quantity: string;
  unitPriceEur: string;
  discountPct: string;
  taxPct: string;
}

let lineSeq = 0;
const newLine = (): LineDraft => ({
  id: `line-${Date.now()}-${lineSeq++}`,
  description: "",
  quantity: "1",
  unitPriceEur: "",
  discountPct: "",
  taxPct: "",
});

const fmtEur = (cents: bigint) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
const fmtPkr = (cents: bigint) =>
  new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR" }).format(Number(cents) / 100);

/** Best-effort conversion for validation (NaN -> 0; validation flags bad values). */
function toValidatableLine(d: LineDraft): EurInvoiceLine {
  return {
    description: d.description,
    quantity: parseFloat(d.quantity) || 0,
    unit_price_eur_cents: Math.round((parseFloat(d.unitPriceEur) || 0) * 100),
    discount_pct: parseFloat(d.discountPct) || 0,
    tax_rate_bps: Math.round((parseFloat(d.taxPct) || 0) * 100),
  };
}

/** Strict conversion for live totals; null when the line is not computable. */
function toComputableLine(d: LineDraft): EurInvoiceLine | null {
  const qty = parseFloat(d.quantity);
  const price = parseFloat(d.unitPriceEur);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  const discount = parseFloat(d.discountPct);
  const tax = parseFloat(d.taxPct);
  return {
    description: d.description.trim(),
    quantity: qty,
    unit_price_eur_cents: Math.round(price * 100),
    discount_pct: Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 0,
    tax_rate_bps: Number.isFinite(tax) && tax > 0 ? Math.round(tax * 100) : 0,
  };
}

const inputCls =
  "w-full min-h-11 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-light-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "block text-sm font-medium text-foreground mb-1";

export default function EurInvoiceForm({ onSubmit, className }: EurInvoiceFormProps) {
  const { t } = useRegional();
  const [customerName, setCustomerName] = useState("");
  const [quotes, setQuotes] = useState<FxQuote[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  const fetchQuotes = async (): Promise<FxQuote[]> => {
    const res = await authorizedFetch("/api/eur/quotes?active_only=true");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "load failed");
    }
    return data.quotes ?? [];
  };

  const loadQuotes = async () => {
    setQuotesLoading(true);
    setQuotesError(null);
    try {
      const qs = await fetchQuotes();
      setQuotes(qs);
      if (qs.length === 1) setQuoteId(qs[0].id);
    } catch (e) {
      setQuotesError(e instanceof Error ? e.message : "load failed");
    } finally {
      setQuotesLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchQuotes()
      .then((qs) => {
        if (cancelled) return;
        setQuotes(qs);
        if (qs.length === 1) setQuoteId(qs[0].id);
      })
      .catch((e) => {
        if (!cancelled) setQuotesError(e instanceof Error ? e.message : "load failed");
      })
      .finally(() => {
        if (!cancelled) setQuotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedQuote = quotes.find((q) => q.id === quoteId) ?? null;

  const totals = useMemo(() => {
    if (!selectedQuote) return null;
    const computable = lines.map(toComputableLine).filter((l): l is EurInvoiceLine => l !== null);
    if (computable.length === 0) return null;
    try {
      return calculateInvoiceTotals(computable, selectedQuote.rate);
    } catch {
      return null;
    }
  }, [lines, selectedQuote]);

  const updateLine = (id: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () => {
    setCreated(false);
    setLines((prev) => [...prev, newLine()]);
  };

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const handleSubmit = async () => {
    setErrors([]);
    setCreated(false);
    const draftLines = lines.map(toValidatableLine);
    const validation = validateEurInvoice(draftLines, quoteId, customerName);
    if (validation.length > 0) {
      setErrors(validation);
      return;
    }
    if (!selectedQuote || !totals) return;
    setSubmitting(true);
    try {
      const draft: EurInvoiceDraft = {
        customer_name: customerName.trim(),
        fx_quote_id: selectedQuote.id,
        fx_rate: selectedQuote.rate,
        lines: draftLines,
        subtotal_eur_cents: Number(totals.subtotalEurCents),
        tax_eur_cents: Number(totals.taxEurCents),
        total_eur_cents: Number(totals.totalEurCents),
        total_pkr_cents: Number(totals.totalPkrCents),
      };
      await onSubmit?.(draft);
      setCreated(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn("responsive-content space-y-5", className)}>
      <h2 className="font-heading font-bold text-2xl text-foreground">{t("eur.form.title")}</h2>

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4" role="alert">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {t("eur.form.errors")}
          </p>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-destructive">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {created && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-4 text-sm font-medium text-success" role="status">
          <CheckCircle2 className="size-4 shrink-0" />
          {t("eur.form.created")}
        </div>
      )}

      {/* Customer + FX quote */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div>
          <label htmlFor="eur-customer" className={labelCls}>
            {t("eur.form.customerName")}
          </label>
          <input
            id="eur-customer"
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={t("eur.form.customerNamePlaceholder")}
            className={inputCls}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="eur-quote" className={labelCls}>
            {t("eur.form.fxQuote")}
          </label>
          {quotesLoading ? (
            <div className="flex min-h-11 items-center gap-2 text-sm text-body">
              <Loader2 className="size-4 animate-spin" />
              {t("eur.form.loadingQuotes")}
            </div>
          ) : quotesError || quotes.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-body">{t("eur.form.noQuotes")}</p>
              <button
                type="button"
                onClick={loadQuotes}
                className="min-h-11 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground hover:bg-muted"
              >
                {t("eur.form.loadQuotes")}
              </button>
            </div>
          ) : (
            <select
              id="eur-quote"
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
              className={cn(inputCls, "pe-8")}
            >
              <option value="">{t("eur.form.selectQuote")}</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  €1 = Rs {q.rate} · {q.rate_date}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">{t("eur.form.lines")}</h3>
          <button
            type="button"
            onClick={addLine}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="size-4" />
            {t("eur.form.addLine")}
          </button>
        </div>

        {lines.map((line, idx) => (
          <div key={line.id} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-light-text">
                #{idx + 1}
              </span>
              <button
                type="button"
                onClick={() => removeLine(line.id)}
                disabled={lines.length === 1}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-40"
                aria-label={t("eur.form.removeLine")}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div>
              <label htmlFor={`eur-desc-${line.id}`} className={labelCls}>
                {t("eur.form.description")}
              </label>
              <input
                id={`eur-desc-${line.id}`}
                type="text"
                value={line.description}
                onChange={(e) => updateLine(line.id, { description: e.target.value })}
                placeholder={t("eur.form.descriptionPlaceholder")}
                className={inputCls}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label htmlFor={`eur-qty-${line.id}`} className={labelCls}>
                  {t("eur.form.quantity")}
                </label>
                <input
                  id={`eur-qty-${line.id}`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                  className={cn(inputCls, "tabular-nums")}
                />
              </div>
              <div>
                <label htmlFor={`eur-price-${line.id}`} className={labelCls}>
                  {t("eur.form.unitPrice")}
                </label>
                <input
                  id={`eur-price-${line.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={line.unitPriceEur}
                  onChange={(e) => updateLine(line.id, { unitPriceEur: e.target.value })}
                  className={cn(inputCls, "tabular-nums")}
                />
              </div>
              <div>
                <label htmlFor={`eur-disc-${line.id}`} className={labelCls}>
                  {t("eur.form.discount")}
                </label>
                <input
                  id={`eur-disc-${line.id}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={line.discountPct}
                  onChange={(e) => updateLine(line.id, { discountPct: e.target.value })}
                  className={cn(inputCls, "tabular-nums")}
                />
              </div>
              <div>
                <label htmlFor={`eur-tax-${line.id}`} className={labelCls}>
                  {t("eur.form.tax")}
                </label>
                <input
                  id={`eur-tax-${line.id}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  value={line.taxPct}
                  onChange={(e) => updateLine(line.id, { taxPct: e.target.value })}
                  className={cn(inputCls, "tabular-nums")}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="rounded-lg border border-border bg-card p-5">
        {totals ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-body">{t("eur.form.subtotal")}</dt>
              <dd className="font-medium tabular-nums text-foreground">{fmtEur(totals.subtotalEurCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-body">{t("eur.form.taxTotal")}</dt>
              <dd className="font-medium tabular-nums text-foreground">{fmtEur(totals.taxEurCents)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base">
              <dt className="font-semibold text-foreground">{t("eur.form.totalEur")}</dt>
              <dd className="font-bold tabular-nums text-foreground">{fmtEur(totals.totalEurCents)}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-body">{t("eur.form.totalPkr")}</dt>
              <dd className="font-medium tabular-nums text-foreground">{fmtPkr(totals.totalPkrCents)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-light-text">
            {selectedQuote ? t("eur.form.lines") : t("eur.form.selectQuote")}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !selectedQuote}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? t("eur.form.submitting") : t("eur.form.submit")}
      </button>
    </div>
  );
}
