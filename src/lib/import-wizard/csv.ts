// TradeOS — Import Wizard: RFC-4180-ish CSV parser (hand-rolled, no deps).
//
// Handles: BOM strip, CRLF/LF line endings, double-quote quoting, escaped
// quotes ("") inside quoted fields, commas and newlines inside quoted fields.
// Values that are not quoted are trimmed of surrounding whitespace.

export function parseCsv(text: string): string[][] {
  let input = text.replace(/^\uFEFF/, "");
  input = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field.trim());
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field.trim());
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows;
}

/** True when every row has the same number of cells as the header row. */
export function csvIsRectangular(rows: string[][]): boolean {
  if (rows.length < 2) return true;
  const width = rows[0].length;
  return rows.slice(1).every((row) => row.length === width);
}
