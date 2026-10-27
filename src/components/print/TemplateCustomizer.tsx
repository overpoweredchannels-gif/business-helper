"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";
import {
  PRINT_FONTS,
  type PrintDocumentType,
  type PrintTemplate,
} from "@/lib/print/print-template-types";
import { ReferenceTemplateReview } from "./ReferenceTemplateReview";
import { cloneDefaultTemplate } from "@/lib/print/default-templates";

export interface TemplateCustomizerProps {
  docType: PrintDocumentType;
  /** Renders the live preview for the current template config. */
  previewRenderer: (template: PrintTemplate) => React.ReactNode;
  onClose: () => void;
  /** Called after a template is saved; gives the persisted config. */
  onSaved?: (template: PrintTemplate) => void;
  /** Organization branding for presets (from settings). */
  orgBranding?: { name?: string; address?: string; city?: string; phone?: string } | null;
}

interface TemplateOption {
  id: string;
  name: string;
  description: string | null;
  config: PrintTemplate;
  is_default: boolean;
  is_builtin: boolean;
}

const inputCls =
  "w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

/** Drag-and-drop reorder helper for arrays of objects with unique id/key. */
function useDragReorder<T extends { key: string }>(items: T[], onReorder: (newItems: T[]) => void) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragRefs = useRef<Array<HTMLDivElement | null>>([]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null);
      return;
    }
    const newItems = [...items];
    const [removed] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, removed);
    onReorder(newItems);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => setDraggedIndex(null);

  const setRef = (index: number) => (el: HTMLDivElement | null) => {
    dragRefs.current[index] = el;
  };

  return { draggedIndex, handleDragStart, handleDragOver, handleDrop, handleDragEnd, setRef };
}

/** Drag-and-drop reorder helper for string arrays (e.g. headerOrder). */
function useDragReorderStrings(items: string[], onReorder: (newItems: string[]) => void) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragRefs = useRef<Array<HTMLDivElement | null>>([]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null);
      return;
    }
    const newItems = [...items];
    const [removed] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, removed);
    onReorder(newItems);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => setDraggedIndex(null);

  const setRef = (index: number) => (el: HTMLDivElement | null) => {
    dragRefs.current[index] = el;
  };

  return { draggedIndex, handleDragStart, handleDragOver, handleDrop, handleDragEnd, setRef };
}

export default function TemplateCustomizer({
  docType,
  previewRenderer,
  onClose,
  onSaved,
  orgBranding,
}: TemplateCustomizerProps) {
  const { t } = useRegional();
  const SECTIONS: { key: keyof PrintTemplate["header"]; label: string }[] = [
    { key: "showSalesman", label: t('print.template.sectionSalesman') },
    { key: "showCustomer", label: t('print.template.sectionCustomer') },
    { key: "showCustomerCity", label: t('print.template.sectionCustomerCity') },
    { key: "showDate", label: t('print.template.sectionDate') },
    { key: "showInvoiceNo", label: t('print.template.sectionInvoiceNo') },
  ];
  const SIZE_FIELDS: { key: string; label: string }[] = [
    { key: "header.orgNameSizePx", label: t('print.template.sizeBusinessName') },
    { key: "header.contactSizePx", label: t('print.template.sizeAddressPhone') },
    { key: "header.headingSizePx", label: t('print.template.sizeHeading') },
    { key: "header.metaSizePx", label: t('print.template.sizeMetaParty') },
    { key: "columns.headerSizePx", label: t('print.template.sizeTableHeader') },
    { key: "columns.rowSizePx", label: t('print.template.sizeTableRows') },
    { key: "groups.groupSizePx", label: t('print.template.sizeGroupTitles') },
    { key: "salesman.sizePx", label: t('print.template.sizeSalesmanSection') },
    { key: "footer.labelSizePx", label: t('print.template.sizeTotalsLabel') },
    { key: "footer.valueSizePx", label: t('print.template.sizeTotalsValue') },
    { key: "footer.footnoteSizePx", label: t('print.template.sizeFootnote') },
  ];
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => `default-${docType}`);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Header section order for drag-and-drop
  const [headerOrder, setHeaderOrder] = useState<string[]>(() => [
    "orgName",
    "contact",
    "heading",
    "meta",
  ]);

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
            setName(def.is_builtin ? `${def.name} (Custom)` : def.name);
            setHeaderOrder(def.config.header.headerOrder ?? ["orgName", "contact", "heading", "meta"]);
          }
        }
      })
      .catch(() => setError(t('print.template.loadFailed')));
    return () => {
      cancelled = true;
    };
  }, [docType, t]);

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

  const reorderHeaderSections = (newOrder: string[]) => {
    setHeaderOrder(newOrder);
    // The renderer reads headerOrder from template - we'll add it to the template
    update({ header: { ...working.header, headerOrder: newOrder } });
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      if (t.is_builtin) setName(`${t.name} (Custom)`);
      else setName(t.name);
      setDescription(t.description ?? "");
      // Initialize headerOrder from template if present
      if (t.config.header.headerOrder) setHeaderOrder(t.config.header.headerOrder);
      else setHeaderOrder(["orgName", "contact", "heading", "meta"]);
    }
    setMessage(null);
    setError(null);
  };

  const handleSave = async () => {
    const finalName = name.trim() || t('print.template.customTemplate');
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const configToSave = { ...working, header: { ...working.header, headerOrder } };
      const res = await authorizedFetch("/api/print-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: docType,
          name: finalName,
          description: description.trim() || null,
          config: configToSave,
        }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || t('print.template.saveFailed'));
      setMessage(t('print.template.saved').replace('{name}', finalName));
      onSaved?.(data.template?.config ?? configToSave);
      await reloadTemplates();
      if (data.template?.id) setSelectedId(data.template.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('print.template.saveFailed'));
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
      if (!data?.ok) throw new Error(data?.error || t('print.template.deleteFailed'));
      setMessage(t('print.template.deleted').replace('{name}', selected.name));
      await reloadTemplates();
      setSelectedId(`default-${docType}`);
      const def = templates.find((t) => t.id === `default-${docType}`);
      if (def) setName(`${def.name} (Custom)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('print.template.deleteFailed'));
    }
  };

  const reloadTemplates = async () => {
    const res = await authorizedFetch(`/api/print-templates?doc_type=${docType}`);
    const data = await res.json();
    if (data?.ok && Array.isArray(data.templates)) {
      setTemplates(data.templates as TemplateOption[]);
    }
  };

  // Drag-and-drop for header sections (string array)
  const {
    draggedIndex: headerDraggedIndex,
    handleDragStart: headerDragStart,
    handleDragOver: headerDragOver,
    handleDrop: headerDrop,
    handleDragEnd: headerDragEnd,
    setRef: setHeaderRef,
  } = useDragReorderStrings(headerOrder, reorderHeaderSections);

  // Drag-and-drop for columns
  const {
    draggedIndex: columnDraggedIndex,
    handleDragStart: columnDragStart,
    handleDragOver: columnDragOver,
    handleDrop: columnDrop,
    handleDragEnd: columnDragEnd,
    setRef: setColumnRef,
  } = useDragReorder(working.columns.labels, (newLabels) => {
    update({ columns: { ...working.columns, labels: newLabels } });
  });

  const headerSectionItems = [
    { id: "orgName", label: t('print.template.sizeBusinessName'), enabled: working.header.showOrgName },
    { id: "contact", label: t('print.template.sizeAddressPhone'), enabled: working.header.showOrgAddress || working.header.showOrgPhone },
    { id: "heading", label: t('print.template.previewDocumentHeading'), enabled: true },
    { id: "meta", label: t('print.template.previewMetaFields'), enabled: true },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-background">
      <ReferenceTemplateReview docType={docType} previewRenderer={previewRenderer} onAccept={template => {
        const option = { id: template.id, name: template.name, description: t('print.template.fromReferenceDesc'), config: template, is_default: false, is_builtin: true };
        setTemplates(previous => [...previous.filter(t => t.id !== template.id), option]);
        setSelectedId(template.id); setName(template.name); setDescription(option.description);
        setHeaderOrder(template.header.headerOrder ?? ["orgName", "contact", "heading", "meta"]);
        setMessage(t('print.template.referenceConfirmed').replace('{save}', t('print.template.saveTemplate')));
      }} />
      {/* ------------------------------- Toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">
          {t('print.template.customize').replace('{doc}', docType === "sales_invoice" ? t('print.template.docSalesInvoice') : docType === "retail_receipt" ? t('print.template.docRetailReceipt') : t('print.template.docLoadForm'))}
        </h2>
        <div className="flex-1" />
        <select value={selectedId} onChange={(e) => handleSelect(e.target.value)} className={inputCls + " w-auto"}>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
              {tpl.is_builtin ? t('print.template.builtinSuffix') : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('print.template.saving') : t('print.template.saveTemplate')}
        </button>
        {selected && !selected.is_builtin && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded border border-destructive px-4 py-2 text-sm text-destructive hover:bg-destructive/5"
          >
            {t('common.delete')}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-4 py-2 text-sm text-foreground/80 hover:bg-muted/40"
        >
          {t('common.close')}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[380px_1fr]">
        {/* ------------------------------ Controls ----------------------------- */}
        <div className="overflow-y-auto border-r border-border p-4">
          {message && <p className="mb-3 rounded border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">{message}</p>}
          {error && <p className="mb-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="space-y-4">
            {docType === "retail_receipt" && <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">{t('print.template.receiptWidth')}</span>
              <select
                value={working.receiptWidthMm === 58 ? "58" : "80"}
                onChange={(event) => update({ receiptWidthMm: event.target.value === "58" ? 58 : 80 })}
                className={inputCls + " min-h-11"}
              >
                <option value="58">58 mm</option>
                <option value="80">80 mm</option>
              </select>
            </label>}
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">{t('print.template.templateName')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={t('print.template.customTemplate')} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-foreground/80">
              <span className="font-medium">{t('print.template.description')}</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputCls}
                placeholder="e.g. Store copy — black serif, big rows"
              />
            </label>

            {/* Fonts */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.font')}</h3>
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

            {/* Business Settings Presets */}
            {orgBranding && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.businessSettings')}</h3>
                <div className="space-y-1.5 text-sm text-foreground/70">
                  <p><strong>{t('print.template.orgBusinessName')}</strong> {orgBranding.name || "—"}</p>
                  <p><strong>{t('print.template.orgAddress')}</strong> {orgBranding.address || "—"}</p>
                  <p><strong>{t('print.template.orgCity')}</strong> {orgBranding.city || "—"}</p>
                  <p><strong>{t('print.template.orgPhone')}</strong> {orgBranding.phone || "—"}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  These values come from Settings → Organization. The template uses them automatically when printing.
                </p>
              </div>
            )}

            {/* Header Section Order (Drag & Drop) */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.headerOrder')}</h3>
              <div className="space-y-1.5">
                {headerSectionItems.map((section, i) => (
                  <div
                    key={section.id}
                    ref={setHeaderRef(i)}
                    draggable
                    onDragStart={(e) => headerDragStart(e, i)}
                    onDragOver={(e) => headerDragOver(e, i)}
                    onDrop={(e) => headerDrop(e, i)}
                    onDragEnd={headerDragEnd}
                    className={`flex items-center gap-2 rounded border p-2 text-sm ${
                      headerDraggedIndex === i ? "opacity-50 ring-2 ring-primary" :
                      section.enabled ? "border-border bg-card" : "border-border/50 bg-muted/50 opacity-60"
                    }`}
                  >
                    <span className="cursor-grab text-muted-foreground">⋮⋮</span>
                    <input
                      type="checkbox"
                      checked={section.enabled}
                      onChange={() => {
                        const key = section.id === "orgName" ? "showOrgName" :
                          section.id === "contact" ? "showOrgAddress" :
                          section.id === "meta" ? "showSalesman" : "showOrgName"; // fallback
                        // Toggle both address and phone together for contact
                        if (section.id === "contact") {
                          update({ header: { ...working.header, showOrgAddress: !working.header.showOrgAddress, showOrgPhone: !working.header.showOrgPhone } });
                        } else if (section.id === "orgName") {
                          update({ header: { ...working.header, showOrgName: !working.header.showOrgName } });
                        }
                      }}
                      className="accent-primary"
                    />
                    <span className="flex-1">{section.label}</span>
                    {section.enabled ? (
                      <span className="text-[10px] text-green-600">{t('print.template.enabled')}</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{t('print.template.disabled')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Header toggles (legacy checkboxes, kept for granular control) */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.headerFields')}</h3>
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
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.businessPosition')}</h3>
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
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.fontSizes')}</h3>
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
              <span>{t('print.template.boldRows')}</span>
            </label>

            {/* Columns (Drag & Drop Reorder) */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{t('print.template.columns')}</h3>
              <div className="space-y-2">
                {working.columns.labels.map((col, i) => (
                  <div
                    key={`${col.key}-${i}`}
                    ref={setColumnRef(i)}
                    draggable
                    onDragStart={(e) => columnDragStart(e, i)}
                    onDragOver={(e) => columnDragOver(e, i)}
                    onDrop={(e) => columnDrop(e, i)}
                    onDragEnd={columnDragEnd}
                    className={`flex items-center gap-1.5 rounded border p-1.5 ${
                      columnDraggedIndex === i ? "opacity-50 ring-2 ring-primary" : "border-border bg-card"
                    }`}
                  >
                    <span className="cursor-grab text-muted-foreground">⋮⋮</span>
                    <button
                      type="button"
                      onClick={() => moveColumn(i, -1)}
                      disabled={i === 0}
                      className="rounded border border-border px-1.5 text-xs disabled:opacity-30"
                      aria-label={t('print.template.moveLeft')}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => moveColumn(i, 1)}
                      disabled={i === working.columns.labels.length - 1}
                      className="rounded border border-border px-1.5 text-xs disabled:opacity-30"
                      aria-label={t('print.template.moveRight')}
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
              <span className="font-medium">{t('print.template.footerNote')}</span>
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
