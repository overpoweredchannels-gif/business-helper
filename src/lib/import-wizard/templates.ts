// TradeOS — Import Wizard: saved column-mapping templates (browser localStorage).

import type { ColumnMapping, SavedImportTemplate } from "./types";
import { guessColumnMapping } from "./validation";

const STORAGE_KEY = "tradeos.import_templates.v1";
const DEFAULT_TEMPLATE_KEY = "tradeos.import_default_template.v1";
const MAX_TEMPLATES = 10;

export function getSavedTemplates(): SavedImportTemplate[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedImportTemplate =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        item.mapping && typeof item.mapping === "object"
    );
  } catch {
    return [];
  }
}

export function saveTemplate(name: string, mapping: ColumnMapping): SavedImportTemplate[] {
  const trimmedName = name.trim();
  if (!trimmedName) return getSavedTemplates();
  const templates = getSavedTemplates();
  const template: SavedImportTemplate = {
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `tpl-${Date.now()}`,
    name: trimmedName,
    mapping: { ...mapping },
  };
  const next = [template, ...templates].slice(0, MAX_TEMPLATES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota) — import still works, templates just won't persist.
  }
  return next;
}

export function deleteTemplate(templateId: string): SavedImportTemplate[] {
  const next = getSavedTemplates().filter((template) => template.id !== templateId);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (getDefaultTemplateId() === templateId) {
      window.localStorage.removeItem(DEFAULT_TEMPLATE_KEY);
    }
  } catch {
    // Same as above — best-effort persistence.
  }
  return next;
}

export function renameTemplate(templateId: string, newName: string): SavedImportTemplate[] {
  const trimmedName = newName.trim();
  const next = getSavedTemplates().map((template) =>
    template.id === templateId && trimmedName ? { ...template, name: trimmedName } : template
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Same as above — best-effort persistence.
  }
  return next;
}

export function replaceTemplate(templateId: string, mapping: ColumnMapping): SavedImportTemplate[] {
  const next = getSavedTemplates().map((template) =>
    template.id === templateId ? { ...template, mapping: { ...mapping } } : template
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Same as above — best-effort persistence.
  }
  return next;
}

export function getDefaultTemplateId(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_TEMPLATE_KEY);
  } catch {
    return null;
  }
}

export function setDefaultTemplateId(templateId: string | null): void {
  try {
    if (templateId) {
      window.localStorage.setItem(DEFAULT_TEMPLATE_KEY, templateId);
    } else {
      window.localStorage.removeItem(DEFAULT_TEMPLATE_KEY);
    }
  } catch {
    // Same as above — best-effort persistence.
  }
}

export function buildDefaultTemplate(fileColumns: string[]): SavedImportTemplate {
  return {
    id: "default",
    name: "Default (guessed)",
    mapping: guessColumnMapping(fileColumns),
  };
}
