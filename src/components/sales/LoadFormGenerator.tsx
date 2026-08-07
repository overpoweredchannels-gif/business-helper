"use client";

import { useCallback, useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

interface LoadFormLine {
  product_id: number | string;
  product_name: string;
  brand_id: string | null;
  brand_name: string;
  packing: string;
  cartons: number;
  pcs: number;
  bonus: number;
  total_value: number;
  bonus_value: number;
}

interface CustomerOption {
  id: string;
  label: string;
}

interface SalesmanOption {
  id: string;
  label: string;
}

const inputCls =
  "rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function LoadFormGenerator() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [salesmen, setSalesmen] = useState<SalesmanOption[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedSalesmen, setSelectedSalesmen] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LoadFormLine[]>([]);
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
            label: c.shop_name ? `${c.shop_name} (${c.customer_name})` : c.customer_name,
          })),
        );
      }
      if (Array.isArray(sData.employees)) {
        setSalesmen(
          sData.employees
            .filter((e: any) =>
              ["salesman", "field_officer", "collection_officer", "delivery_rider", "supervisor"].includes(e.designation),
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

  const toggleCustomer = (id: string) =>
    setSelectedCustomers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleSalesman = (id: string) =>
    setSelectedSalesmen((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const generate = async () => {
    setLoading(true);
    setError(null);
    setGenerated(false);
    try {
      const params = new URLSearchParams();
      if (selectedCustomers.length > 0) params.set("customer_ids", selectedCustomers.join(","));
      if (selectedSalesmen.length > 0) params.set("salesman_ids", selectedSalesmen.join(","));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await authorizedFetch(`/api/sales/load-form?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to build load form");
      setLines(data.summary?.lines ?? []);
      setGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build load form");
    } finally {
      setLoading(false);
    }
  };

  // Group lines by brand, preserving sort order.
  const groups: { name: string; lines: LoadFormLine[]; total: number; bonus: number }[] = [];
  const groupIndex = new Map<string, number>();
  for (const line of lines) {
    const key = line.brand_name || "OTHER";
    let idx = groupIndex.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(key, idx);
      groups.push({ name: key, lines: [], total: 0, bonus: 0 });
    }
    groups[idx].lines.push(line);
    groups[idx].total += line.total_value;
    groups[idx].bonus += line.bonus_value;
  }

  const grandTotal = lines.reduce((s, l) => s + l.total_value, 0);
  const grandBonus = lines.reduce((s, l) => s + l.bonus_value, 0);
  const netTotal = grandTotal - grandBonus;

  const customerLabels = selectedCustomers
    .map((id) => customers.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(", ");
  const salesmanLabels = selectedSalesmen
    .map((id) => salesmen.find((s) => s.id === id)?.label)
    .filter(Boolean)
    .join(", ");

  const print = () => {
    setShowPrint(true);
    window.setTimeout(() => window.print(), 50);
  };

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
                    onChange={() => toggleCustomer(c.id)}
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
                    onChange={() => toggleSalesman(s.id)}
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
        {generated && lines.length > 0 && (
          <button
            type="button"
            onClick={print}
            className="rounded border border-primary px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Print / Load Form
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {generated && lines.length === 0 && (
        <p className="text-sm text-muted-foreground">No sales found for the selected filters.</p>
      )}

      {generated && lines.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Packing</th>
                <th className="px-3 py-2 text-right">Cartons</th>
                <th className="px-3 py-2 text-right">Pcs</th>
                <th className="px-3 py-2 text-right">Bns</th>
                <th className="px-3 py-2 text-right">Total Value</th>
                <th className="px-3 py-2 text-right">Bonus Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((g) => (
                <FragmentGroup key={g.name} group={g} />
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <span className="text-muted-foreground">Total Value:</span>{" "}
              <span className="font-semibold">{fmt(grandTotal)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Bonus Value:</span>{" "}
              <span className="font-semibold">{fmt(grandBonus)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Net Value:</span>{" "}
              <span className="font-semibold">{fmt(netTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {showPrint && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-foreground/20 p-4 print:static print:bg-white print:p-0">
          <div className="mx-auto max-w-3xl bg-white print:max-w-none print:shadow-none">
            <div className="mb-3 flex justify-between print:hidden">
              <button onClick={() => setShowPrint(false)} className="rounded border border-border bg-white px-4 py-2 text-sm text-foreground">
                Close
              </button>
              <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm text-white">
                Print
              </button>
            </div>
            <LoadFormDocument
              customerLabels={customerLabels}
              salesmanLabels={salesmanLabels}
              dateFrom={dateFrom}
              dateTo={dateTo}
              groups={groups}
              grandTotal={grandTotal}
              grandBonus={grandBonus}
              netTotal={netTotal}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentGroup({ group }: { group: { name: string; lines: LoadFormLine[] } }) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={8} className="px-3 py-2 font-bold uppercase text-foreground">
          {group.name}
        </td>
      </tr>
      {group.lines.map((line) => (
        <tr key={line.product_id}>
          <td className="px-3 py-1.5 text-muted-foreground/70">{line.brand_name}</td>
          <td className="px-3 py-1.5 text-foreground">{line.product_name}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{line.packing}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{trim(line.cartons)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{trim(line.pcs)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{trim(line.bonus)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{fmt(line.total_value)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{fmt(line.bonus_value)}</td>
        </tr>
      ))}
    </>
  );
}

function LoadFormDocument({
  customerLabels,
  salesmanLabels,
  dateFrom,
  dateTo,
  groups,
  grandTotal,
  grandBonus,
  netTotal,
}: {
  customerLabels: string;
  salesmanLabels: string;
  dateFrom: string;
  dateTo: string;
  groups: { name: string; lines: LoadFormLine[] }[];
  grandTotal: number;
  grandBonus: number;
  netTotal: number;
}) {
  const today = new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "2-digit" });
  const range = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateFrom || dateTo || "";
  return (
    <div className="load-form-doc">
      <style>{`@media print { body { font-family: 'Times New Roman', Times, serif; } .load-form-doc { color: #000; } }`}</style>
      <div className="text-center" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#000" }}>
        <div className="text-[24px] font-bold leading-tight">DAR SWEETS</div>
        <div className="text-[11px]">Fawara Chowk, Kharian Link Road, Dinga</div>
        <div className="text-[11px]">0301-6292574</div>
        <div className="mt-1 text-[13px] font-bold">Load Form</div>
        <div className="mt-2 flex justify-between text-[12px]">
          <div>
            <span className="font-semibold">Salesman:</span> {salesmanLabels || "All"}
          </div>
          <div>
            <span className="font-semibold">Customer:</span> {customerLabels || "All"}
          </div>
          <div>
            <span className="font-semibold">Date:</span> {today}
          </div>
        </div>
        {range && <div className="text-[11px]">Period: {range}</div>}
        <div className="my-2 border-b border-black" />
      </div>

      {groups.map((g) => (
        <div key={g.name} className="mt-3" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#000" }}>
          <div className="text-[12px] font-bold uppercase">{g.name}</div>
          <div className="my-1 border-b border-black" />
          <div className="flex text-[10px] font-bold uppercase">
            <span className="w-[46%]">Product Name</span>
            <span className="w-[16%] text-right">Packing</span>
            <span className="w-[10%] text-right">Cartons</span>
            <span className="w-[8%] text-right">Pcs</span>
            <span className="w-[8%] text-right">Bns</span>
            <span className="w-[12%] text-right">Value</span>
          </div>
          {g.lines.map((line, i) => (
            <div key={i} className="flex py-[1px] text-[10px] leading-tight">
              <span className="w-[46%]">{line.product_name}</span>
              <span className="w-[16%] text-right tabular-nums">{line.packing}</span>
              <span className="w-[10%] text-right tabular-nums">{trim(line.cartons)}</span>
              <span className="w-[8%] text-right tabular-nums">{trim(line.pcs)}</span>
              <span className="w-[8%] text-right tabular-nums">{trim(line.bonus)}</span>
              <span className="w-[12%] text-right tabular-nums">{fmt(line.total_value)}</span>
            </div>
          ))}
          <div className="my-1 border-b border-black" />
        </div>
      ))}

      <div className="mt-4 border border-black p-3" style={{ fontFamily: "'Times New Roman', Times, serif", color: "#000" }}>
        <div className="flex justify-between text-[13px] font-bold">
          <span>Total Value</span>
          <span>{fmt(grandTotal)}</span>
        </div>
        <div className="flex justify-between text-[13px] font-bold">
          <span>Bonus Value</span>
          <span>{fmt(grandBonus)}</span>
        </div>
        <div className="my-1 border-t border-black" />
        <div className="flex justify-between text-[14px] font-bold">
          <span>Net Value</span>
          <span>{fmt(netTotal)}</span>
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