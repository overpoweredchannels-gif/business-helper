"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

type Field = HTMLInputElement | HTMLSelectElement;
const fieldsIn = (row: Element): Field[] => Array.from(row.querySelectorAll<Field>("input, select"))
  .filter(field => !field.disabled && !(field instanceof HTMLInputElement && (field.readOnly || field.type === "hidden")) && field.getClientRects().length > 0);
// Same as fieldsIn but keeps disabled fields, so a column index stays
// stable across rows when one row's field (e.g. unit mode) is disabled
// and the next row's is not.
const allFieldsIn = (row: Element): Field[] => Array.from(row.querySelectorAll<Field>("input, select"))
  .filter(field => !(field instanceof HTMLInputElement && (field.readOnly || field.type === "hidden")) && field.getClientRects().length > 0);
const focusField = (field?: Field) => {
  field?.focus();
  if (field instanceof HTMLInputElement && ["text", "search", "tel"].includes(field.type)) field.select();
};

/** Enter advances within invoice lines; it never triggers invoice submission.
 * Escape on a line with no entered values (no product, no quantity, price,
 * discount or bonus typed) skips that line via onSkipLine instead.
 * Enter on the last field of the last line does NOT auto-add a line
 * (2026-11-15): it focuses the "+ Add Product Line" button, so one more
 * Enter adds the line and Tab moves on toward Save.
 * A newly appeared row only takes focus when it is blank (its first field,
 * the product, is empty). Prefilled rows — e.g. picking a sales-return
 * invoice fills every line at once — are never blank, so they never steal
 * focus; focus stays on the invoice select and the header Enter walk
 * (invoice -> return date) works. A barcode-scanned line has a product, so
 * it also never steals focus; the scan input keeps focus for the next scan.
 * Arrow keys (opt-in via enableArrowKeys): Up/Down move to the same column
 * in the previous/next line, Left/Right move to the previous/next field in
 * the same line. Native behaviour is kept where it matters: Up/Down on a
 * <select> still change the option, Left/Right in a text input still move
 * the caret until the caret edge, and Left/Right in a date input still
 * move between date segments. */
export function InvoiceLineNavigation({ children, onAddLine, onSkipLine, addButtonSelector = "[data-sale-add-line]", enableArrowKeys = false }: { children: ReactNode; onAddLine: () => void; onSkipLine?: (index: number) => void; addButtonSelector?: string; enableArrowKeys?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const pendingRow = useRef<number | null>(null);
  const previousCount = useRef(0);
  const didMount = useRef(false);
  useLayoutEffect(() => {
    const rows = root.current?.querySelectorAll("[data-invoice-line]");
    const count = rows?.length ?? 0;
    // First mount must not steal focus: lines can be prefilled by picking
    // an invoice (sales return), and focus belongs on the return date, not
    // on the last prefilled line. Only rows added after mount take focus.
    if (!didMount.current) {
      didMount.current = true;
      previousCount.current = count;
      return;
    }
    const index = pendingRow.current ?? (count > previousCount.current ? count - 1 : null);
    previousCount.current = count;
    if (index === null) return;
    const row = rows?.[index];
    pendingRow.current = null;
    if (!row) return;
    // Only a blank row (first field empty) takes focus. A prefill fills
    // every row with a product, so it never steals focus from the header.
    const first = fieldsIn(row)[0];
    if (first && first.value.trim() === "") focusField(first);
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const row = target.closest("[data-invoice-line]");
    if (!row) return;
    if (enableArrowKeys && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // Up/Down on a <select> change the option natively; Left/Right in a
      // date input move between date segments natively. Leave those alone.
      const isSelect = target instanceof HTMLSelectElement;
      const isDate = target instanceof HTMLInputElement && target.type === "date";
      if (isSelect && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
      if (isDate && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
      // Left/Right in a text/number input still move the caret until the
      // caret edge; only at the edge do they move to the next field.
      if (target instanceof HTMLInputElement && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const atEdge = event.key === "ArrowLeft"
          ? target.selectionStart === 0 && target.selectionEnd === 0
          : target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
        if (!atEdge) return;
      }
      const rows = Array.from(root.current?.querySelectorAll("[data-invoice-line]") ?? []);
      const rowIndex = rows.indexOf(row);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const nextRow = event.key === "ArrowDown" ? rows[rowIndex + 1] : rows[rowIndex - 1];
        if (!nextRow) return;
        // Match the same column by position among all fields (including
        // disabled ones, so the column is stable when unit mode is
        // disabled in one row and enabled in the next). If that column is
        // disabled in the target row, take the nearest enabled field.
        const column = allFieldsIn(row).indexOf(target);
        const targetFields = allFieldsIn(nextRow);
        let next: Field | undefined = targetFields[column];
        if (next && next.disabled) {
          next = undefined;
          for (let d = 1; d < targetFields.length; d += 1) {
            const after = targetFields[column + d];
            const before = targetFields[column - d];
            if (after && !after.disabled) { next = after; break; }
            if (before && !before.disabled) { next = before; break; }
          }
        }
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        focusField(next);
        return;
      }
      const fields = fieldsIn(row);
      const fieldIndex = fields.indexOf(target);
      const next = event.key === "ArrowRight" ? fields[fieldIndex + 1] : fields[fieldIndex - 1];
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      focusField(next);
      return;
    }
    if (event.key === "Escape") {
      if (!onSkipLine) return;
      // Only a line with nothing typed into it may be skipped; the two
      // selects keep their defaults (unit "main", discount "flat"), so
      // only text inputs decide emptiness.
      const fields = fieldsIn(row);
      if (fields.some(field => field instanceof HTMLInputElement && field.value.trim() !== "")) return;
      event.preventDefault();
      event.stopPropagation();
      const rows = Array.from(root.current?.querySelectorAll("[data-invoice-line]") ?? []);
      onSkipLine(rows.indexOf(row));
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || pendingRow.current !== null) return;
    const fields = fieldsIn(row);
    const index = fields.indexOf(target);
    if (event.shiftKey) {
      focusField(fields[Math.max(0, index - 1)]);
      return;
    }
    if (!target.reportValidity()) return;
    if (index < fields.length - 1) {
      focusField(fields[index + 1]);
      return;
    }
    const invalid = fields.find(field => !field.checkValidity());
    if (invalid) { focusField(invalid); invalid.reportValidity(); return; }
    const rows = Array.from(root.current?.querySelectorAll("[data-invoice-line]") ?? []);
    const nextIndex = rows.indexOf(row) + 1;
    if (rows[nextIndex]) focusField(fieldsIn(rows[nextIndex])[0]);
    else {
      // Last field of the last line (2026-11-15): do not auto-add a line.
      // Focus the "+ Add Product Line" button instead — one more Enter
      // adds the line, Tab moves on toward the Save button.
      const add = document.querySelector(addButtonSelector);
      if (add instanceof HTMLButtonElement) { add.focus(); return; }
      pendingRow.current = nextIndex; onAddLine();
    }
  };
  return <div ref={root} className="mb-4 space-y-3" onKeyDown={handleKeyDown}>{children}</div>;
}
