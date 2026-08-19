"use client";

import { useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { getEntityConfig } from "@/lib/import-export/registry";

const inputCls = "w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

interface ExportWizardProps {
  entityKey: string;
  onClose: () => void;
  onExported?: () => void;
}

export default function ExportWizard({ entityKey, onClose, onExported }: ExportWizardProps) {
  const config = getEntityConfig(entityKey);
  const exportConfig = config?.export;
  
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config || !exportConfig) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/5 p-4">
        <p className="text-destructive">Export not supported for this entity.</p>
      </div>
    );
  }

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("entity_key", entityKey);
      params.set("format", format);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      
      const res = await fetch(`/api/import-export/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("sb-access-token") ?? ""}` },
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportConfig.filenamePrefix}_${new Date().toISOString().split("T")[0]}.${format === "xlsx" ? "xlsx" : "csv"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      onExported?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">Export {config.entityName}</h2>
        <button onClick={onClose} className="rounded border border-border px-4 py-2 text-sm text-foreground/80 hover:bg-muted/30">Close</button>
      </div>

      {error && <p className="px-4 py-2 text-sm text-destructive">{error}</p>}

      <div className="p-4 space-y-4">
        <div>
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            <span className="font-medium">Format</span>
            <div className="flex gap-2">
              <label className="flex items-center gap-2">
                <input type="radio" value="csv" checked={format === "csv"} onChange={() => setFormat("csv")} className="h-4 w-4 accent-primary" />
                <span>CSV</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" value="xlsx" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} className="h-4 w-4 accent-primary" />
                <span>Excel (.xlsx)</span>
              </label>
            </div>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            <span>From Date</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground/80">
            <span>To Date</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
          </label>
        </div>

        <p className="text-xs text-muted-foreground">
          Exports {config.entityName} with the default column set. Use filters to limit the date range.
        </p>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <button onClick={onClose} className="rounded border border-border px-4 py-2 text-sm text-foreground/80 hover:bg-muted/30">Cancel</button>
          <button onClick={handleExport} disabled={loading} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50">
            {loading ? "Exporting..." : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}