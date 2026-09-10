import { cloneDefaultTemplate } from "./default-templates";
import { PRINT_FONTS, type PrintDocumentType, type PrintTemplate } from "./print-template-types";

// Accept only fields already supported by the renderer, never arbitrary HTML/CSS.
export function reviewReferenceTemplate(docType: PrintDocumentType, proposed: any) {
  const template = cloneDefaultTemplate(docType);
  const warnings: string[] = [];
  if (!proposed || typeof proposed !== "object") throw new Error("No layout could be recognized");
  const merge = (target: Record<string, any>, source: Record<string, any>) => {
    for (const [key, value] of Object.entries(target)) {
      const candidate = source?.[key];
      if (candidate === undefined || Array.isArray(value)) continue;
      if (value && typeof value === "object") merge(value, candidate);
      else if (typeof value === "boolean" && typeof candidate === "boolean") target[key] = candidate;
      else if (typeof value === "number" && Number.isFinite(candidate)) target[key] = Math.max(0, Math.min(80, candidate));
      else if (typeof value === "string" && typeof candidate === "string") target[key] = candidate.slice(0, 400);
    }
  };
  merge(template as unknown as Record<string, any>, proposed);
  template.docType = docType;
  template.id = "reference-draft";
  template.name = "Reference template";
  const headerSections = ["orgName", "contact", "heading", "meta"];
  if (Array.isArray(proposed.header?.headerOrder)) {
    const recognized = proposed.header.headerOrder.filter((key: unknown) => typeof key === "string" && headerSections.includes(key));
    template.header.headerOrder = [...new Set<string>([...recognized, ...headerSections])];
  }
  const font = PRINT_FONTS.find(f => f.family === proposed.fontFamily || f.name.toLowerCase() === String(proposed.fontFamily).toLowerCase());
  template.fontFamily = font?.family ?? PRINT_FONTS[0].family;
  if (!font) warnings.push("Exact font could not be matched; review the selected font.");
  for (const key of ["background", "ink", "rule"] as const) if (!/^#[\da-f]{6}$/i.test(template.page[key])) template.page[key] = key === "background" ? "#ffffff" : "#000000";
  if (!["top", "bottom"].includes(template.header.orgNamePosition)) template.header.orgNamePosition = "top";
  const supported = cloneDefaultTemplate(docType).columns.labels;
  const labels = Array.isArray(proposed.columns?.labels) ? proposed.columns.labels : [];
  const seen = new Set<string>();
  const columns = labels.filter((column: any) => {
    if (!supported.some(c => c.key === column?.key) || seen.has(column.key)) { warnings.push(`Unmapped or repeated column: ${String(column?.label ?? column?.key ?? "unknown").slice(0, 80)}`); return false; }
    seen.add(column.key); return true;
  }).map((column: any) => ({ key: column.key, label: String(column.label ?? column.key).slice(0, 80), widthPct: Math.max(1, Math.min(100, Number(column.widthPct) || 10)) }));
  if (columns.length) { const total = columns.reduce((sum: number, c: any) => sum + c.widthPct, 0); template.columns.labels = columns.map((c: any) => ({ ...c, widthPct: c.widthPct / total * 100 })); }
  else warnings.push("No supported columns were recognized; the standard columns are shown for manual review.");
  warnings.push("Review fonts, column meanings, spacing and the print preview. Scans and unavailable fonts cannot guarantee an exact reproduction. Sample medicines/products are not imported.");
  return { template: template as PrintTemplate, warnings };
}
