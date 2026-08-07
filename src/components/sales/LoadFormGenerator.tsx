"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

interface LoadFormLine {
  product_id: number | string;
  product_name: string;
  packing: string;
  cartons: number;
  pcs: number;
  bonus: number;
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

interface LoadFormSalesman {
  salesman_id: string;
  salesman_name: string;
  customers: LoadFormCustomer[];
  total_value: number;
  bonus_value: number;
}

interface LoadFormSummary {
  org_name: string;
  org_address: string;
  org_phone: string;
  salesmen: LoadFormSalesman[];
  grand_total: number;
  grand_bonus: number;
  grand_net: number;
}

interface Option {
  id: string;
  label: string;
}

const inputCls =
  "rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function LoadFormGenerator() {
  const [customers, setCustomers] = useState<Option[]>([]);
  const [salesmen, setSalesmen] = useState<Option[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedSalesmen, setSelectedSalesmen] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LoadFormSummary | null>(null);
  const [generated, setGenerated] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const [cRes, sRes] = await Promise.all([
        authorizedFetch("/api/customers?limit=500"),
        authorizedFetch("/api/identity/employees?limit=500"),
      ]);
      const cData = await cRes.json();
      const sData = await sRes.json();
      if (Array.isArray(cData.customers)) {
        setCustomers(
          cData.customers.map((c: any) => ({
            id: c.id,
            label: c.shop_name
              ? `${c.shop_name} (${c.customer_name})`
              : c.customer_name,
          })),
        );
      }
      if (Array.isArray(sData.employees)) {
        setSalesmen(
          sData.employees
            .filter((e: any) =>
              ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"].includes(
                e.designation,
              ),
            )
            .map((e: any) => ({ id: e.id, label: e.full_name })),
        );
      }
    } catch {
      // options are non-blocking
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const toggle = (list: string[], id: string, setList: (v: string[]) => void) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setGenerated(false);
    setSummary(null);
    try {
      const params = new URLSearchParams();
      if (selectedCustomers.length > 0) params.set("customer_ids", selectedCustomers.join(","));
      if (selectedSalesmen.length > 0) params.set("salesman_ids", selectedSalesmen.join(","));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
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

  const totalLines = () =>
    summary?.salesmen.reduce((s, sm) => s + sm.customers.reduce((c, cust) => c + cust.lines.length, 0), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-foreground/80">
          <span>Date From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground/80">
          <span>Date To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Generating..." : "Generate Load Form"}
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
          <div className="bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
            {summary.salesmen.reduce(
              (s, sm) => s + sm.customers.reduce((c, cust) => c + cust.lines.length, 0),
              0,
            )}
            {" "}line items across {summary.salesmen.length} salesman
            {summary.salesmen.length > 1 ? "s" : ""} and{" "}
            {summary.salesmen.reduce((s, sm) => s + sm.customers.length, 0)} customers.
          </div>
          {summary.salesmen.map((sm) => (
            <div key={sm.salesman_id} className="overflow-hidden rounded border border-border">
              <div className="bg-primary/5 px-4 py-2 text-sm font-semibold text-foreground">
                {sm.salesman_name}
              </div>
              {sm.customers.map((cust) => (
                <div key={cust.customer_id || "walk-in"} className="border-t border-border">
                  <div className="bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                    {cust.customer_name}
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-1.5">Product</th>
                        <th className="px-2 py-1.5 text-right">Packing</th>
                        <th className="px-2 py-1.5 text-right">Cartons</th>
                        <th className="px-2 py-1.5 text-right">Pcs</th>
                        <th className="px-2 py-1.5 text-right">Bns</th>
                        <th className="px-4 py-1.5 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cust.lines.map((line, i) => (
                        <tr key={i}>
                          <td className="px-4 py-1.5 text-foreground">{line.product_name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{line.packing}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{trim(line.cartons)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{trim(line.pcs)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{trim(line.bonus)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">{fmt(line.total_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/30 font-semibold">
                        <td className="px-4 py-1.5" colSpan={2}>
                          {cust.customer_name} Total
                        </td>
                        <td className="px-2 py-1.5 text-right" colSpan={2}>
                          {fmt(cust.total_value)}
                        </td>
                        <td className="px-2 py-1.5 text-right">Bns</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{fmt(cust.bonus_value)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              <div className="flex justify-between border-t border-border bg-primary/5 px-4 py-2 text-sm font-semibold text-foreground">
                <span>{sm.salesman_name} Total</span>
                <span className="tabular-nums">{fmt(sm.total_value)}</span>
              </div>
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
          <div className="mx-auto max-w-3xl rounded border border-border bg-white shadow-xl">
            <div className="mb-3 flex justify-between border-b border-border px-4 py-3 print:hidden">
              <button
                onClick={() => setShowPrint(false)}
                className="rounded border border-border bg-white px-4 py-2 text-sm text-foreground"
              >
                Close
              </button>
              <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm text-white">
                Print
              </button>
            </div>
            <LoadFormDocument
              summary={summary}
              customerLabels={customerLabels}
              salesmanLabels={salesmanLabels}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          </div>
          <style>{`
            @media print {
              body { background: #fff !important; }
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
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

function LoadFormDocument({
  summary,
  customerLabels,
  salesmanLabels,
  dateFrom,
  dateTo,
}: {
  summary: LoadFormSummary;
  customerLabels: string;
  salesmanLabels: string;
  dateFrom: string;
  dateTo: string;
}) {
  const today = new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "2-digit" });
  const range = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateFrom || dateTo || "";
  const rowCls = "flex py-[1.5px] text-[10px] leading-tight";
  const headerRow = "flex text-[10px] font-bold uppercase";

  return (
    <div className="load-form-doc">
      <div className="text-center" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#000" }}>
        <div className="text-2xl font-bold leading-tight">{summary.org_name || "—"}</div>
        {summary.org_address && <div className="text-[11px]">{summary.org_address}</div>}
        {summary.org_phone && <div className="text-[11px]">{summary.org_phone}</div>}
        <div className="mt-1 text-center text-sm font-bold">Load Form</div>
        <div className="mt-2 flex justify-between text-xs">
          <div>
            <span className="font-semibold">Salesman:</span> {salesmanLabels || "(All salesmen)"}
          </div>
          <div>
            <span className="font-semibold">Customer:</span>{" "}
            {customerLabels || "(All customers)"}
          </div>
          <div>
            <span className="font-semibold">Date:</span> {today}
          </div>
        </div>
        {range && <div className="text-[11px]">Period: {range}</div>}
        <div className="my-2 border-b border-black" />
      </div>

      {summary.salesmen.map((salesman) => (
        <div key={salesman.salesman_id} className="mb-4">
          <div className="text-xs font-bold">
            Salesman: {salesman.salesman_name}
          </div>
          {salesman.customers.map((cust) => (
            <div key={cust.customer_id || "walk-in"} className="mt-3">
              <div className="text-sm font-bold">
                Customer: {cust.customer_name}
              </div>
              <div className="my-1 border-b border-black" />
              <div className={`${headerRow} font-bold`}>
                <span className="w-[46%]">Product Name</span>
                <span className="w-[16%] text-right">Packing</span>
                <span className="w-[10%] text-right">Cartons</span>
                <span className="w-[8%] text-right">Pcs</span>
                <span className="w-[8%] text-right">Bns</span>
                <span className="w-[12%] text-right">Value</span>
              </div>
              {cust.lines.map((line, i) => (
                <div key={i} className={rowCls}>
                  <span className="w-[46%]">{line.product_name}</span>
                  <span className="w-[16%] text-right tabular-nums">{line.packing}</span>
                  <span className="w-[10%] text-right tabular-nums">{trim(line.cartons)}</span>
                  <span className="w-[8%] text-right tabular-nums">{trim(line.pcs)}</span>
                  <span className="w-[8%] text-right tabular-nums">{trim(line.bonus)}</span>
                  <span className="w-[12%] text-right tabular-nums">{fmt(line.total_value)}</span>
                </div>
              ))}
              <div className="my-1 border-b border-black" />
              <div className={rowCls}>
                <span className="w-[46%] font-bold">Customer Total</span>
                <span className="w-[54%] text-right font-bold tabular-nums">{fmt(cust.total_value)}</span>
              </div>
            </div>
          ))}
          <div className={`${rowCls} mt-2`}>
            <span className="w-[46%] font-bold">Salesman Total</span>
            <span className="w-[54%] text-right font-bold tabular-nums">{fmt(salesman.total_value)}</span>
          </div>
        </div>
      ))}

      <div className="mt-4 border border-black p-3" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#000" }}>
        <div className="flex justify-between text-[13px] font-bold">
          <span>Total Value</span>
          <span>{fmt(summary.grand_total)}</span>
        </div>
        <div className="flex justify-between text-[13px] font-bold">
          <span>Bonus Value</span>
          <span>{fmt(summary.grand_bonus)}</span>
        </div>
        <div className="my-1 border-t border-black" />
        <div className="flex justify-between text-[14px] font-bold">
          <span>Net Value</span>
          <span>{fmt(summary.grand_net)}</span>
        </div>
      </div>
      <div className="mt-3 text-center text-[10px]" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#000" }}>
        Generated by TradeOS
      </div>
    </div>
  );
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmt(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}