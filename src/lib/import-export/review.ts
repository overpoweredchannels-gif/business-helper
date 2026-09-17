import type { EntityImportConfig, ParsedRow } from "./types";

/** Keep every source row in review. Never silently discard an in-file match. */
export function reviewImportDuplicates(rows: ParsedRow[], config: EntityImportConfig, mode: "skip" | "update" | "error") {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    for (const fields of config.uniqueKeys) {
      const parts = fields.map(field => String(row.values[field] ?? "").trim().toLocaleLowerCase());
      if (parts.some((part, index) => !part && !(config.entityKey === "products" && fields[index] === "brand"))) continue;
      const key = JSON.stringify([fields, parts]);
      const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
    }
    if (row.existingId !== null && row.existingId !== undefined) {
      row.warnings.push(`Matches an existing ${config.entityName} record (${row.existingId}). ${mode === "skip" ? "Excluded because you selected Skip existing." : mode === "update" ? "Only supplied fields will be updated." : "Choose how to handle this match before saving."}`);
      if (mode === "error") row.errors.push("Existing record needs review. Choose Update for the same record, or correct its identifying fields if it is a different record.");
      if (mode === "update" && (!config.applyUpdate || ["customer_payments", "supplier_payments"].includes(config.entityKey))) row.errors.push("This financial record cannot be updated through import. Review it in its ledger before importing again.");
      if (mode === "update" && config.entityKey === "products" && row.values.initial_stock != null) row.errors.push("This product already exists. Opening stock cannot be added again. Remove the Initial Stock mapping to update product details; reconcile existing stock in Inventory.");
    }
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const message = `Possible duplicate source rows: ${group.map(row => row.rowIndex).join(", ")}. All rows are retained for review; correct identifiers or combine rows deliberately before saving.`;
    for (const row of group) if (!row.errors.includes(message)) row.errors.push(message);
  }
}
