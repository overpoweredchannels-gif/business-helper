// TradeOS ERP — Load Form template access.
//
// The Load Form uses the shared print-template system (see
// src/lib/print/print-template-types.ts). This module keeps the old
// `getLoadFormTemplate` surface so existing callers (LoadFormGenerator, the
// renderer) keep working while the canonical default lives in
// src/lib/print/default-templates.ts.

import { cloneDefaultTemplate, DEFAULT_PRINT_TEMPLATES } from "@/lib/print/default-templates";
import type { PrintTemplate } from "@/lib/print/print-template-types";

export type LoadFormTemplate = PrintTemplate;

export function getLoadFormTemplate(id: string | null | undefined): LoadFormTemplate {
  if (id && id !== DEFAULT_PRINT_TEMPLATES.load_form.id) {
    // Callers should pass a fully resolved custom template via the new
    // `template` prop instead; id-based lookup only ever returns the default
    // (custom templates are loaded from the API and passed directly).
    return cloneDefaultTemplate("load_form");
  }
  return cloneDefaultTemplate("load_form");
}

export const loadFormTemplates: Record<string, LoadFormTemplate> = {
  default: cloneDefaultTemplate("load_form"),
};