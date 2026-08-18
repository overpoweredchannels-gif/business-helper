"use client";

// TradeOS ERP — Print Template Customizer.
//
// Live editor for printable document templates (sales invoice / load form).
// Left pane: controls (fonts, sizes, toggles, columns). Right pane: live
// preview rendered with the current config. Templates persist per organization
// via POST /api/print-templates.

import { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import {
  PRINT_FONTS,
  type PrintDocumentType,
  type PrintTemplate,
} from "@/lib/print/print-template-types";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";

export interface TemplateCustomizerProps {
  docType: PrintDocumentType;
  /** Renders the live preview for the current template config. */
  previewRenderer: (template: PrintTemplate) => React.ReactNode;
  onClose: () => void;
  /** Called after a template is saved; gives the persisted config. */
  onSaved?: (template: PrintTemplate) => void;
}

interface TemplateOption {
  id: string;
  name: string;
  description: string | null;
  config: PrintTemplate;
  is_default: boolean;
  is_builtin: boolean;
}

const SECTIONS: { key: keyof PrintTemplate["header"]; label: string }[] = [
  { key: "showSalesman", label: "Salesman" },
  { key: "showCustomer", label: "Customer" },
  { key: "showCustomerCity", label: "Customer City" },
  { key: "showDate", label: "Date" },
  { key: "showInvoiceNo", label: "Invoice No" },
];

const SIZE_FIELDS: { key: string; label: string }[] = [
  { key: "header.orgNameSizePx", label: "Business Name" },
  { key: "header.contactSizePx", label: "Address / Phone" },
  { key: "header.headingSizePx", label: "Heading" },
  { key: "header.metaSizePx", label: "Meta / Party lines" },
  { key: "columns.headerSizePx", label: "Table Header" },
  { key: "columns.rowSizePx", label: "Table Rows" },
  { key: "groups.groupSizePx", label: "Group Titles" },
  { key: "salesman.sizePx", label: "Salesman Section" },
  { key: "footer.labelSizePx", label: "Totals Label" },
  { key: "footer.valueSizePx", label: "Totals Value" },
  { key: "footer.footnoteSizePx", label: "Footnote" },
];

const inputCls =
  "w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function TemplateCustomizer({
  docType,
  previewRenderer,
  onClose,
  onSaved,
}: TemplateCustomizerProps) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => `default-${docType}`);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authorizedFetch(`/api/print-templates?doc_type=${docType}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.templates)) {
          setTemplates(data.templates as TemplateOption[]);
          const def = (data.templates as TemplateOption[]).find((t) => t.is_default);
          if (def) {
            setSelectedId(def.id);
            setName(`${def.name} (Custom)`);
          }
        }
      })
      .catch(() => setError("Failed to load templates."));
    return () => {
      cancelled = true;
    };
  }, [docType]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const working = useMemo(() => {
    if (selected) return selected.config;
    return cloneDefaultTemplate(docType);
  }, [selected, docType]);

  const update = (patch: Partial<PrintTemplate>) => {
    const next = { ...working, ...patch };
    setTemplates((prev) =>
      prev.map((t) => (t.id === selectedId ? { ...t, config: next } : t)),
    );
  };

  const setSize = (field: string, value: number) => {
    const next = structuredClone(working) as PrintTemplate;
    const [section, prop] = field.split(".") as [keyof PrintTemplate, string];
    const sectionObj = next[section] as Record<string, unknown>;
    sectionObj[prop] = value;
    update(next);
  };

  const setHeaderToggle = (key: keyof PrintTemplate["header"], value: boolean) => {
    update({ header: { ...working.header, [key]: value } });
  };

  const moveColumn = (index: number, dir: -1 | 1) => {
    const labels = [...working.columns.labels];
    const target = index + dir;
    if (target < 0 || target >= labels.length) return;
    [labels[index], labels[target]] = [labels[target]!, labels[index]!];
    update({ columns: { ...working.columns, labels } });
  };

  const renameColumn = (index: number, label: string) => {
    const labels = working.columns.labels.map((c, i) => (i === index ? { ...c, label } : c));
    update({ columns: { ...working.columns, labels } });
  };

  const setColumnWidth = (index: number, widthPct: number) => {
    const labels = working.columns.labels.map((c, i) => (i === index ? { ...c, widthPct } : c));
    update({ columns: { ...working.columns, labels } });
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      if (t.is_builtin) setName(`${t.name} (Custom)`);
      else setName(t.name);
      setDescription(t.description ?? "");
    }
    setMessage(null);
    setError(null);
  };

  const handleSave = async () => {
    const finalName = name.trim() || "Custom Template";
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await authorizedFetch("/api/print-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: docType,
          name: finalName,
          description: description.trim() || null,
          config: working,
        }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed to save template");
      setMessage(`Saved template "${finalName}".`);
      onSaved?.(data.template?.config ?? working);
      await reloadTemplates();
      if (data.template?.id) setSelectedId(data.template.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || selected.is_builtin) return;
    setError(null);
    setMessage(null);
    try {
      const res = await authorizedFetch(`/api/print-templates/${selected.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed to delete template");
      setMessage(`Deleted template "${selected.name}".`);
      await reloadTemplates();
      setSelectedId(`default-${docType}`);
      const def = templates.find((t) => t.id === `default-${docType}`);
      if (def) setName(`${def.name} (Custom)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template");
    }
  };

  const reloadTemplates = async () => {
    const res = await authorizedFetch(`/api/print-templates?doc_type=${docType}`);
    const data = await res.json();
    if (data?.ok && Array.isArray(data.templates)) {
      setTemplates(data.templates as TemplateOption[]);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-background">
      {/* ------------------------------- Toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">
          Customize {docType === "sales_invoice" ? "Sales Invoice" : "Load Form"} Template
        </h2>
        <div className="flex-1" />
        <select value={selectedId} onChange={(e) => handleSelect(e.target.value)} className={inputCls + " w-auto"}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.is_builtin ? " (default)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Template"}
        </button>
        {selected && !selected.is_builtin && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded border border-destructive px-4 py-2 text-sm text-destructive hover:bg-destructive/5"
          >
            Delete
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-4 py-2 text-sm text-foreground/80 hover:bg-muted/40"
        >
          Close
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[380px_1fr]">
        {/* ------------------------------ Controls ----------------------------- */}
        <div className="overflow-y-auto border-r border-border p-4">
          {message && <p className="mb-3 rounded border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">{message}</p>}
          {error && <p className="mb-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="space-y-4">
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">Template Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Custom Template" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">Description</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputCls}
                placeholder="e.g. Store copy — black serif, big rows"
              />
            </label>

            {/* Fonts */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Font</h3>
              <select
                value={PRINT_FONTS.find((f) => f.family === working.fontFamily)?.id ?? ""}
                onChange={(e) => {
                  const font = PRINT_FONTS.find((f) => f.id === e.target.value);
                  if (font) update({ fontFamily: font.family });
                }}
                className={inputCls}
              >
                {PRINT_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Header toggles */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Header Fields</h3>
              <div className="space-y-1.5">
                {SECTIONS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm text-foreground/80">
                    <input
                      type="checkbox"
                      checked={Boolean(working.header[s.key])}
                      onChange={(e) => setHeaderToggle(s.key, e.target.checked)}
                      className="accent-primary"
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Business name position */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Business Name Position</h3>
              <div className="flex gap-2">
                {(["top", "bottom"] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => update({ header: { ...working.header, orgNamePosition: pos } })}
                    className={`rounded px-3 py-1.5 text-sm capitalize ${
                      working.header.orgNamePosition === pos
                        ? "bg-primary text-white"
                        : "border border-border text-foreground/80"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {/* Sizes */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Font Sizes</h3>
              <div className="space-y-3">
                {SIZE_FIELDS.map((f) => {
                  const [section, prop] = f.key.split(".") as [keyof PrintTemplate, string];
                  const sectionObj = working[section] as Record<string, unknown>;
                  const value = Number(sectionObj[prop]) || 10;
                  return (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="w-36 text-xs text-foreground/70">{f.label}</span>
                      <input
                        type="range"
                        min={6}
                        max={30}
                        value={value}
                        onChange={(e) => setSize(f.key, Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <span className="w-8 text-right text-xs tabular-nums text-foreground/70">{value}px</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bold body */}
            <label className="flex items-center gap-2 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={Boolean(working.boldBody)}
                onChange={(e) => update({ boldBody: e.target.checked })}
                className="accent-primary"
              />
              <span>Bold table rows</span>
            </label>

            {/* Columns */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Columns</h3>
              <div className="space-y-2">
                {working.columns.labels.map((col, i) => (
                  <div key={`${col.key}-${i}`} className="flex items-center gap-1.5 rounded border border-border bg-card p-1.5">
                    <button
                      type="button"
                      onClick={() => moveColumn(i, -1)}
                      disabled={i === 0}
                      className="rounded border border-border px-1.5 text-xs disabled:opacity-30"
                      aria-label="Move left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => moveColumn(i, 1)}
                      disabled={i === working.columns.labels.length - 1}
                      className="rounded border border-border px-1.5 text-xs disabled:opacity-30"
                      aria-label="Move right"
                    >
                      →
                    </button>
                    <input
                      value={col.label}
                      onChange={(e) => renameColumn(i, e.target.value)}
                      className="w-24 rounded border border-border bg-background px-1.5 py-1 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">{col.key}</span>
                    <div className="flex flex-1 items-center gap-1">
                      <input
                        type="range"
                        min={5}
                        max={60}
                        value={col.widthPct}
                        onChange={(e) => setColumnWidth(i, Number(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <span className="w-7 text-right text-[10px] tabular-nums text-muted-foreground">{col.widthPct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footnote */}
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">Footer Note / Disclaimer</span>
              <textarea
                value={working.footer.footnoteText}
                onChange={(e) => update({ footer: { ...working.footer, footnoteText: e.target.value } })}
                rows={3}
                className={inputCls}
              />
            </label>
          </div>
        </div>

        {/* ------------------------------ Preview ------------------------------ */}
        <div className="min-h-0 overflow-y-auto bg-muted/30 p-4 print:bg-white print:p-0">
          <div className="mx-auto max-w-[210mm] rounded border border-border bg-white p-6 shadow-sm print:border-0 print:shadow-none print:p-0">
            {previewRenderer(working)}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .fixed, .fixed * { visibility: visible; }
          .fixed { position: absolute; inset: 0; overflow: visible; background: #fff; }
        }
      `}</style>
    </div>
  );
}