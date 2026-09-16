import type { ColumnMapping, ImportFieldDef } from "./types";
import { appendPreservedImportData, getUnmappedTargetField, PRESERVE_IN_NOTES } from "./mapping";

export function prepareImportFile(headers: string[], rows: string[][], mapping: ColumnMapping, fields: ImportFieldDef[]) {
  const allowed = new Set(fields.map(field => field.key));
  const targets = headers.map(header => mapping[header]).filter(target => allowed.has(target));
  if (new Set(targets).size !== targets.length) throw new Error("Two source columns map to the same field. Give each field one source before preparing the file.");
  if (!targets.length) throw new Error("Map at least one column before preparing the file.");
  const notes = getUnmappedTargetField(fields);
  const keys = fields.filter(field => field.required || targets.includes(field.key) || (field.key === notes && headers.some(header => mapping[header] === PRESERVE_IN_NOTES))).map(field => field.key);
  const missing = fields.filter(field => field.required && !targets.includes(field.key)).map(field => field.label);
  const prepared = rows.map(row => {
    const raw = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const values: Record<string, unknown> = {};
    headers.forEach(header => { if (allowed.has(mapping[header])) values[mapping[header]] = raw[header]; });
    appendPreservedImportData(values, raw, mapping, fields);
    return keys.map(key => String(values[key] ?? ""));
  });
  const requiredIndexes = fields.filter(field => field.required).map(field => keys.indexOf(field.key));
  const incompleteRows = prepared.filter(row => requiredIndexes.some(index => !row[index]?.trim())).length;
  return { keys, rows: prepared, missing, incompleteRows };
}
