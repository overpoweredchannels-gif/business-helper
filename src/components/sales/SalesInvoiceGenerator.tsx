"use client";

// TradeOS ERP — Sales Invoice Generator.
//
// Filter confirmed sales by customer / salesman / date range / area / route /
// city, then print one invoice, a salesman's set, or all matching invoices at
// once. Each print uses the selected (or customized) sales invoice template.

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import type { SalesInvoiceDoc } from "@/lib/sales/sales-invoice-service";
import { SalesInvoiceDocument } from "@/lib/sales/sales-invoice-render";
import type { PrintTemplate } from "@/lib/print/print-template-types";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";
import TemplateCustomizer from "@/components/print/TemplateCustomizer";

interface Option {
  id: string;
  label: string;
}

type RangeKey = "today" | "last7" | "last30" | "custom";

const inputCls =
  "rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function SalesInvoiceGenerator() {
  const [customers, setCustomers] = useState<Option[]>([]);
  const [salesmen, setSalesmen] = useState<Option[]>([]);
  const [routes, setRoutes] = useState<Option[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedSalesmen, setSelectedSalesmen] = useState<string[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<SalesInvoiceDoc[]>([]);
  const [generated, setGenerated] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [printDocs, setPrintDocs] = useState<SalesInvoiceDoc[]>([]);
  const [printTitle, setPrintTitle] = useState("");
  const [template, setTemplate] = useState<PrintTemplate>(() => cloneDefaultTemplate("sales_invoice"));
  const [showCustomizer, setShowCustomizer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authorizedFetch("/api/sales/invoices/options")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          if (Array.isArray(data.customers)) setCustomers(data.customers);
          if (Array.isArray(data.salesmen)) setSalesmen(data.salesmen);
          if (Array.isArray(data.routes)) setRoutes(data.routes);
          if (Array.isArray(data.areas)) setAreas(data.areas);
          if (Array.isArray(data.cities)) setCities(data.cities);
        }
      })
      .catch(() => {
        // options are non-blocking
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (list: string[], id: string, setList: (v: string[]) => void) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const toggleText = (list: string[], value: string, setList: (v: string[]) => void) =>
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

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
    setDocs([]);
    try {
      const params = new URLSearchParams();
      if (selectedCustomers.length > 0) params.set("customer_ids", selectedCustomers.join(","));
      if (selectedSalesmen.length > 0) params.set("salesman_ids", selectedSalesmen.join(","));
      if (selectedRoutes.length > 0) params.set("route_ids", selectedRoutes.join(","));
      if (selectedAreas.length > 0) params.set("areas", selectedAreas.join(","));
      if (selectedCities.length > 0) params.set("cities", selectedCities.join(","));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await authorizedFetch(`/api/sales/invoices/query?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load invoices");
      setDocs(data.docs ?? []);
      setGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  const groupedBySalesman = useMemo(() => {
    const map = new Map<string, SalesInvoiceDoc[]>();
    for (const doc of docs) {
      const key = doc.salesman_id ?? "unassigned";
      const list = map.get(key);
      if (list) list.push(doc);
      else map.set(key, [doc]);
    }
    return [...map.entries()].map(([id, list]) => ({
      salesman_id: id,
      salesman_name: list[0]?.salesman_name ?? "Salesman",
      docs: list,
      total: list.reduce((s, d) => s + d.grand_total, 0),
    }));
  }, [docs]);

  const rangeLabel = () => {
    if (rangeKey === "today") return "Today";
    if (rangeKey === "last7") return "Last 7 days";
    if (rangeKey === "last30") return "Last 30 days";
    return dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : "Custom range";
  };

  const openPrint = (list: SalesInvoiceDoc[], title: string) => {
    setPrintDocs(list);
    setPrintTitle(title);
    setShowPrint(true);
  };

  const count = docs.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Customers</h3>
          {customers.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading customers...</p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto">
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
            <div className="max-h-44 space-y-1 overflow-y-auto">
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
          <h3 className="mb-2 text-sm font-medium text-foreground">Routes</h3>
          {routes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading routes...</p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {routes.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedRoutes.includes(r.id)}
                    onChange={() => toggle(selectedRoutes, r.id, setSelectedRoutes)}
                    className="accent-primary"
                  />
                  <span className="truncate">{r.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Areas</h3>
          {areas.length === 0 ? (
            <p className="text-xs text-muted-foreground">No areas found.</p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {areas.map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedAreas.includes(a)}
                    onChange={() => toggleText(selectedAreas, a, setSelectedAreas)}
                    className="accent-primary"
                  />
                  <span className="truncate">{a}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Cities</h3>
          {cities.length === 0 ? (
            <p className="text-xs text-muted-foreground">No cities found.</p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {cities.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-foreground/80">
                  <input
                    type="checkbox"
                    checked={selectedCities.includes(c)}
                    onChange={() => toggleText(selectedCities, c, setSelectedCities)}
                    className="accent-primary"
                  />
                  <span className="truncate">{c}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-muted/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">Period</h3>
          <div className="flex flex-wrap gap-2">
            {(["today", "last7", "last30"] as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyRangeKey(key)}
                className={`rounded px-2.5 py-1 text-xs ${
                  rangeKey === key ? "bg-primary text-white" : "border border-border text-foreground/80"
                }`}
              >
                {key === "today" ? "Today" : key === "last7" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setCustomDate(setDateFrom, e.target.value)} className={inputCls} aria-label="Date from" />
            <input type="date" value={dateTo} onChange={(e) => setCustomDate(setDateTo, e.target.value)} className={inputCls} aria-label="Date to" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Generate Invoices"}
        </button>
        <button
          type="button"
          onClick={() => setShowCustomizer(true)}
          className="rounded border border-primary px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
        >
          Customize Template
        </button>
        {generated && count > 0 && (
          <button
            type="button"
            onClick={() => openPrint(docs, `All Invoices (${count})`)}
            className="rounded border border-primary px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Print All ({count})
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {generated && count === 0 && (
        <p className="text-sm text-muted-foreground">No invoices found for the selected filters.</p>
      )}

      {generated && count > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold">{count}</span> invoice{count > 1 ? "s" : ""} found for period{" "}
            <span className="font-semibold">{rangeLabel()}</span>. Use the buttons below to print a single invoice, a
            salesman&apos;s set, or everything at once.
          </p>
          {groupedBySalesman.map((sm) => (
            <div key={sm.salesman_id} className="overflow-hidden rounded border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-primary/5 px-4 py-2">
                <span className="text-sm font-semibold text-foreground">{sm.salesman_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{sm.docs.length} invoice{sm.docs.length > 1 ? "s" : ""}</span>
                  <button
                    type="button"
                    onClick={() => openPrint(sm.docs, `${sm.salesman_name} — ${sm.docs.length} Invoice${sm.docs.length > 1 ? "s" : ""}`)}
                    className="rounded border border-primary px-3 py-1 text-xs text-primary hover:bg-primary/5"
                  >
                    Print {sm.salesman_name}&apos;s Invoices
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-border">
                {sm.docs.map((doc) => (
                  <li key={doc.transaction_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-foreground/80">
                    <div>
                      <span className="font-medium text-foreground">Invoice {doc.invoice_number}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {doc.sale_date ?? "—"} · {doc.customer_name}
                        {doc.customer_city ? ` · ${doc.customer_city}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{fmt(doc.grand_total)}</span>
                      <button
                        type="button"
                        onClick={() => openPrint([doc], `Invoice ${doc.invoice_number}`)}
                        className="rounded border border-primary px-3 py-1 text-xs text-primary hover:bg-primary/5"
                      >
                        Print
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {showPrint && (
        <div className="fixed inset-0 z-[110] overflow-y-auto bg-foreground/20 p-4">
          <div className="mx-auto max-w-[210mm] rounded border border-border bg-white shadow-xl">
            <div className="mb-3 flex justify-between border-b border-border px-4 py-3 print:hidden">
              <h2 className="text-lg font-semibold text-foreground">{printTitle}</h2>
              <div className="flex gap-2">
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
            </div>
            <div className="p-6 print:p-0">
              {printDocs.map((doc, i) => (
                <div key={doc.transaction_id} style={{ pageBreakAfter: i < printDocs.length - 1 ? "always" : undefined }}>
                  <SalesInvoiceDocument doc={doc} template={template} rangeLabel={rangeLabel()} />
                </div>
              ))}
            </div>
          </div>
          <style>{`
            @page { size: A4; margin: 8mm; }
            @media print {
              html, body { background: #fff !important; }
              body * { visibility: hidden; }
              .fixed,
              .fixed * { visibility: visible; }
              .fixed {
                position: absolute;
                inset: 0;
                overflow: visible;
                background: #fff;
                padding: 0;
              }
              .fixed > div {
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
          docType="sales_invoice"
          previewRenderer={(t) => (
            <SalesInvoiceDocument
              doc={previewDoc}
              template={t}
              rangeLabel={rangeLabel()}
            />
          )}
          onClose={() => setShowCustomizer(false)}
          onSaved={(t) => setTemplate(t)}
        />
      )}
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

// Sample invoice used as the live preview inside the customizer.
const previewDoc: SalesInvoiceDoc = {
  transaction_id: "preview",
  invoice_number: "S-100123",
  sale_date: "2026-08-19",
  payment_type: "cash",
  total_amount: 24500,
  discount_amount: 500,
  tax_rate: 0,
  tax_amount: 0,
  credit_due_date: null,
  customer_id: "preview-customer",
  customer_name: "Sample Shop",
  shop_name: "Al-Noor General Store",
  customer_city: "Faisalabad",
  customer_area: "Peoples Colony",
  customer_phone: null,
  salesman_id: "preview-salesman",
  salesman_name: "Mohammad Aslam",
  org_name: "TradeOS Distributors",
  org_address: "Main Bazaar, Faisalabad",
  org_phone: "0300-1234567",
  lines: [
    {
      product_id: 1,
      product_name: "Cotton 220g",
      unit_type: "Cotton",
      subunit_type: "Box",
      main_unit_label: "Cotton",
      subunit_unit_label: "Box",
      unit_mode: "main",
      quantity: 5,
      quantity_text: "5 Cotton",
      selling_price: 4200,
      discount: 0,
      line_total: 21000,
    },
    {
      product_id: 2,
      product_name: "Rice 1kg",
      unit_type: "Bag",
      subunit_type: "Pouch",
      main_unit_label: "Bag",
      subunit_unit_label: "Pouch",
      unit_mode: "subunit",
      quantity: 12,
      quantity_text: "12 Pouch",
      selling_price: 350,
      discount: 500,
      line_total: 3700,
    },
  ],
  grand_total: 24500,
  discount_total: 500,
  tax_total: 0,
};