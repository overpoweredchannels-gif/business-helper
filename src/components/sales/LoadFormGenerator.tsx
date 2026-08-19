"use client";

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { LoadFormDocument } from "@/lib/sales/load-form-render";
import type { LoadFormSummary } from "@/lib/sales/load-form-service";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";

interface LoadFormLine {
  product_id: number | string;
  product_name: string;
  unit_type: string | null;
  subunit_type: string | null;
  main_qty: number;
  subunit_qty: number;
  bonus_main_qty: number;
  bonus_subunit_qty: number;
  total_value: number;
  bonus_value: number;
}

interface LoadFormCustomer {
  customer_id: string | null;
  customer_name: string;
  lines: LoadFormLine[];
  total_value: number;
  bonus_value: number;
}

interface LoadFormBrand {
  brand_id: string | null;
  brand_name: string;
  lines: LoadFormLine[];
  total_value: number;
  bonus_value: number;
}

interface Option {
  id: string;
  label: string;
}

type RangeKey = "today" | "last7" | "last30" | "custom";

interface TemplateOption {
  id: string;
  name: string;
  description: string | null;
  config: PrintTemplate;
  is_default: boolean;
  is_builtin: boolean;
}

const inputCls =
  "rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function LoadFormGenerator() {
  const [customers, setCustomers] = useState<Option[]>([]);
  const [salesmen, setSalesmen] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedSalesmen, setSelectedSalesmen] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [groupBy, setGroupBy] = useState<"brand" | "customer">("brand");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LoadFormSummary | null>(null);
  const [generated, setGenerated] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [template, setTemplate] = useState<PrintTemplate>(() => cloneDefaultTemplate("load_form"));
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [orgBranding, setOrgBranding] = useState<{ name?: string; address?: string; city?: string; phone?: string } | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("default-load-form");

  // Fetch options + org branding + templates on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      authorizedFetch("/api/sales/load-form/options"),
      authorizedFetch("/api/print-templates?doc_type=load_form"),
      authorizedFetch("/api/org/branding"),
    ])
      .then(async ([optionsRes, templatesRes, orgRes]) => {
        if (cancelled) return;
        const [optionsData, templatesData, orgData] = await Promise.all([
          optionsRes.json(),
          templatesRes.json(),
          orgRes.json(),
        ]);
        if (cancelled) return;
        if (optionsData?.ok) {
          if (Array.isArray(optionsData.customers)) setCustomers(optionsData.customers);
          if (Array.isArray(optionsData.salesmen)) setSalesmen(optionsData.salesmen);
          if (Array.isArray(optionsData.brands)) setBrands(optionsData.brands);
        }
        if (templatesData?.ok && Array.isArray(templatesData.templates)) {
          setTemplates(templatesData.templates as TemplateOption[]);
          const def = templatesData.templates.find((t: TemplateOption) => t.is_default);
          if (def) setSelectedTemplateId(def.id);
        }
        if (orgData?.ok) {
          setOrgBranding(orgData.branding ?? null);
        }
      })
      .catch(() => {
        // non-blocking
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load selected template config when template changes
  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (tpl) {
      setTemplate(tpl.config);
    } else {
      setTemplate(cloneDefaultTemplate("load_form"));
    }
  }, [selectedTemplateId, templates]);

  const toggle = (list: string[], id: string, setList: (v: string[]) => void) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const applyRangeKey = (key: RangeKey) => {
    setRangeKey(key);
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (key === "today") {
      setDateFrom(fmt(today));
      setDateTo(fmt(today));
    } else if (key === "last7") {
      const from = new Date(today);
      from.setDate(today.getDate() - 6);
      setDateFrom(fmt(from));
      setDateTo(fmt(today));
    } else if (key === "last30") {
      const from = new Date(today);
      from.setDate(today.getDate() - 29);
      setDateFrom(fmt(from));
      setDateTo(fmt(today));
    } else {
      setDateFrom("");
      setDateTo("");
    }
  };

  const setCustomDate = (setter: (v: string) => void, value: string) => {
    setter(value);
    setRangeKey("custom");
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    setGenerated(false);
    setSummary(null);
    try {
      const params = new URLSearchParams();
      if (selectedCustomers.length > 0) params.set("customer_ids", selectedCustomers.join(","));
      if (selectedSalesmen.length > 0) params.set("salesman_ids", selectedSalesmen.join(","));
      if (selectedBrands.length > 0) params.set("brand_ids", selectedBrands.join(","));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      params.set("group_by", groupBy);
      const res = await authorizedFetch(`/api/sales/load-form?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to build load form");
      setSummary(data.summary ?? null);
      setGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build load form");
    } finally {
      setLoading(false);
    }
  };

  const customerLabels = selectedCustomers
    .map((id) => customers.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(", ");
  const salesmanLabels = selectedSalesmen
    .map((id) => salesmen.find((s) => s.id === id)?.label)
    .filter(Boolean)
    .join(", ");
  const brandLabels = selectedBrands
    .map((id) => brands.find((b) => b.id === id)?.label)
    .filter(Boolean)
    .join(", ");

  const totalLines = () =>
    summary?.salesmen.reduce((s, sm) => s + (sm.brands.length > 0 ? sm.brands : sm.customers).reduce((c, g) => c + g.lines.length, 0), 0) ?? 0;

  const rangeLabel = () => {
    if (rangeKey === "today") return "Today";
    if (rangeKey === "last7") return "Last 7 days";
    if (rangeKey === "last30") return "Last 30 days";
    return dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : "Custom range";
  };

  return (
    <div className="space-y-4">
      {/* Template Selector Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-muted/30 p-3">
        <label className="flex items-center gap-2 text-sm text-foreground/80">
          <span className="font-medium">Template:</span>
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_builtin ? " (default)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowCustomizer(true)}
            className="rounded border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
          >
            Customize
          </button>
        </label>
        <div className="flex-1" />
        {orgBranding && (
          <span className="text-xs text-muted-foreground">
            Business: {orgBranding.name}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Customers</h3>
          {customers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading customers...</p>
          ) : (
            <div className="max-h-52 overflow-y-auto space-y-1">
              {customers.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedCustomers.includes(c.id)}
                    onChange={() => toggle(selectedCustomers, c.id, setSelectedCustomers)}
                    className="accent-primary"
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Salesmen</h3>
          {salesmen.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading salesmen...</p>
          ) : (
            <div className="max-h-52 overflow-y-auto space-y-1">
              {salesmen.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedSalesmen.includes(s.id)}
                    onChange={() => toggle(selectedSalesmen, s.id, setSelectedSalesmen)}
                    className="accent-primary"
                  />
                  <span className="truncate">{s.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Brands</h3>
          {brands.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading brands...</p>
          ) : (
            <div className="max-h-52 overflow-y-auto space-y-1">
              {brands.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedBrands.includes(b.id)}
                    onChange={() => toggle(selectedBrands, b.id, setSelectedBrands)}
                    className="accent-primary"
                  />
                  <span className="truncate">{b.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">Period</span>
          {(["today", "last7", "last30"] as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => applyRangeKey(key)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                rangeKey === key
                  ? "bg-primary text-white"
                  : "border border-border text-foreground/80 hover:bg-muted/40"
              }`}
            >
              {key === "today" ? "Today" : key === "last7" ? "Last 7 days" : "Last 30 days"}
            </button>
          ))}
          <label className="flex items-center gap-1 text-sm text-foreground/80">
            <span>From:</span>
            <input type="date" value={dateFrom} onChange={(e) => setCustomDate(setDateFrom, e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1 text-sm text-foreground/80">
            <span>To:</span>
            <input type="date" value={dateTo} onChange={(e) => setCustomDate(setDateTo, e.target.value)} className={inputCls} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">Group by</span>
          {(["brand", "customer"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setGroupBy(key)}
              className={`rounded px-3 py-1.5 text-sm capitalize transition-colors ${
                groupBy === key
                  ? "bg-primary text-white"
                  : "border border-border text-foreground/80 hover:bg-muted/40"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Generating..." : "Generate Load Form Summary"}
        </button>
        <button
          type="button"
          onClick={() => setShowCustomizer(true)}
          className="rounded border border-primary px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
        >
          Customize Template
        </button>
        {generated && summary && summary.salesmen.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPrint(true)}
            className="rounded border border-primary px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Print / Load Form
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {generated && summary && summary.salesmen.length === 0 && (
        <p className="text-sm text-muted-foreground">No sales found for the selected filters.</p>
      )}

      {generated && summary && summary.salesmen.length > 0 && (
        <div className="space-y-4">
          <div className="rounded border border-border bg-muted/30 p-3 text-sm text-foreground">
            <span className="font-semibold">Period:</span> {rangeLabel()}
            {salesmanLabels && (
              <>
                {" "}
                · <span className="font-semibold">Salesmen:</span> {salesmanLabels}
              </>
            )}
            {brandLabels && (
              <>
                {" "}
                · <span className="font-semibold">Brands:</span> {brandLabels}
              </>
            )}
            {" "}
            · <span className="font-semibold">{totalLines()}</span> line items across{" "}
            {summary.salesmen.length} salesman{summary.salesmen.length > 1 ? "s" : ""}, grouped by{" "}
            {summary.groupBy}.
          </div>
          {summary.salesmen.map((sm) => (
            <div key={sm.salesman_id} className="overflow-hidden rounded border border-border">
              {summary.groupBySalesman && (
                <div className="bg-primary/5 px-4 py-2 text-sm font-semibold text-foreground">
                  {sm.salesman_name}
                </div>
              )}
              {(summary.groupBy === "brand" ? sm.brands : sm.customers).map((grp) => (
                <div key={groupTitle(grp)} className="border-t border-border">
                  <div className="bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                    {groupTitle(grp)}
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-1.5">Product</th>
                        <th className="px-2 py-1.5 text-right">Quantity</th>
                        <th className="px-2 py-1.5 text-right">Bns</th>
                        <th className="px-4 py-1.5 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {grp.lines.map((line, i) => (
                        <tr key={i}>
                          <td className="px-4 py-1.5 text-foreground">{line.product_name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{quantityLabel(line)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{bonusLabel(line)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">{fmt(line.total_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/30 font-semibold">
                        <td className="px-4 py-1.5" colSpan={2}>
                          {groupTitle(grp)} Total
                        </td>
                        <td className="px-2 py-1.5 text-right">{fmt(grp.bonus_value)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{fmt(grp.total_value)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              {summary.groupBySalesman && (
                <div className="flex justify-between border-t border-border bg-primary/5 px-4 py-2 text-sm font-semibold text-foreground">
                  <span>{sm.salesman_name} Total</span>
                  <span className="tabular-nums">{fmt(sm.total_value)}</span>
                </div>
              )}
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Total Value:</span>{" "}
              <span className="font-semibold">{fmt(summary.grand_total)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Bonus Value:</span>{" "}
              <span className="font-semibold">{fmt(summary.grand_bonus)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Net Value:</span>{" "}
              <span className="font-semibold">{fmt(summary.grand_net)}</span>
            </div>
          </div>
        </div>
      )}

      {showPrint && summary && (
        <div className="load-form-print-root fixed inset-0 z-[100] overflow-y-auto bg-foreground/20 p-4">
          <div className="mx-auto max-w-[210mm] rounded border border-border bg-white shadow-xl">
            <div className="mb-3 flex justify-between border-b border-border px-4 py-3 print:hidden">
              <button
                onClick={() => setShowPrint(false)}
                className="rounded border border-border bg-white px-4 py-2 text-sm text-foreground"
              >
                Close
              </button>
              <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm text-white">
                Print / Save PDF
              </button>
            </div>
            <LoadFormDocument
              summary={summary}
              template={template}
              customerLabels={customerLabels}
              salesmanLabels={salesmanLabels}
              rangeLabel={rangeLabel()}
            />
          </div>
          <style>{`
            @page { size: A4; margin: 8mm; }
            @media print {
              html, body { background: #fff !important; }
              body * { visibility: hidden; }
              .load-form-print-root,
              .load-form-print-root * { visibility: visible; }
              .load-form-print-root {
                position: absolute;
                inset: 0;
                overflow: visible;
                background: #fff;
                padding: 0;
              }
              .load-form-print-root > div {
                max-width: 100% !important;
                box-shadow: none !important;
                border: none !important;
              }
            }
          `}</style>
        </div>
      )}

      {showCustomizer && (
        <TemplateCustomizer
          docType="load_form"
          previewRenderer={(t) => (
            <LoadFormDocument
              summary={previewSummary}
              template={t}
              customerLabels="Sample Shop"
              salesmanLabels="Mohammad Aslam"
              rangeLabel="Last 7 days"
            />
          )}
          onClose={() => setShowCustomizer(false)}
          onSaved={(t) => setTemplate(t)}
          orgBranding={orgBranding}
        />
      )}
    </div>
  );
}

function groupTitle(g: LoadFormCustomer | LoadFormBrand): string {
  return "brand_name" in g ? g.brand_name : g.customer_name;
}

function quantityLabel(line: LoadFormLine): string {
  const unitType = line.unit_type ?? "Units";
  const subunitType = line.subunit_type ?? "Pcs";
  const parts: string[] = [];
  if (line.main_qty > 0) parts.push(`${trim(line.main_qty)} ${unitType}`);
  if (line.subunit_qty > 0) parts.push(`${trim(line.subunit_qty)} ${subunitType}`);
  return parts.length > 0 ? parts.join(" + ") : "0";
}

function bonusLabel(line: LoadFormLine): string {
  const unitType = line.unit_type ?? "Units";
  const subunitType = line.subunit_type ?? "Pcs";
  const parts: string[] = [];
  if (line.bonus_main_qty > 0) parts.push(`${trim(line.bonus_main_qty)} ${unitType}`);
  if (line.bonus_subunit_qty > 0) parts.push(`${trim(line.bonus_subunit_qty)} ${subunitType}`);
  return parts.length > 0 ? parts.join(" + ") : "";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

// Sample summary used as the live preview inside the customizer.
const previewSummary: LoadFormSummary = {
  org_name: "TradeOS Distributors",
  org_address: "Main Bazaar, Faisalabad",
  org_phone: "0300-1234567",
  groupBy: "brand",
  groupBySalesman: true,
  salesmen: [
    {
      salesman_id: "preview-salesman",
      salesman_name: "Mohammad Aslam",
      customers: [],
      brands: [
        {
          brand_id: "preview-brand",
          brand_name: "Shan Foods",
          lines: [
            {
              product_id: 1,
              product_name: "Cotton 220g",
              units_per_pack: 20,
              unit_type: "Cotton",
              subunit_type: "Box",
              main_qty: 5,
              subunit_qty: 10,
              bonus_main_qty: 0,
              bonus_subunit_qty: 2,
              total_value: 24500,
              bonus_value: 700,
            },
            {
              product_id: 2,
              product_name: "Rice 1kg",
              units_per_pack: 12,
              unit_type: "Bag",
              subunit_type: "Pouch",
              main_qty: 3,
              subunit_qty: 0,
              bonus_main_qty: 1,
              bonus_subunit_qty: 0,
              total_value: 12600,
              bonus_value: 4200,
            },
          ],
          total_value: 37100,
          bonus_value: 4900,
        },
      ],
      total_value: 37100,
      bonus_value: 4900,
    },
  ],
  grand_total: 37100,
  grand_bonus: 4900,
  grand_net: 32200,
};