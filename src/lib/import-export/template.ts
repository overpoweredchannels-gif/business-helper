import type { ImportFieldDef } from "./types";

/**
 * Build one example row for an entity's import template, keyed by field
 * LABEL. Labels are used deliberately: the wizard's column guesser scores
 * an exact normalized label match at 100, so a template built this way
 * maps every column automatically with no saved mapping template needed.
 * The wizard requires a header plus at least one row, so the example row
 * is mandatory, not decorative — its values are obviously examples
 * ("Example …") and the preview step shows them before anything imports.
 */
export function buildEntityTemplateRow(fields: ImportFieldDef[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const field of fields) {
    switch (field.type) {
      case "number":
      case "integer":
      case "decimal":
        row[field.label] = "100";
        break;
      case "boolean":
        row[field.label] = "yes";
        break;
      case "text":
        row[field.label] = `Example ${field.label}`;
        break;
      default:
        // date / select / multiselect / uuid / json: left blank, because
        // their valid values depend on the firm's own data (existing
        // brands, real dates) and a guessed value would fail validation.
        row[field.label] = "";
        break;
    }
  }
  return row;
}
