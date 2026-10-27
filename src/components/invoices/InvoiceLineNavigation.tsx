"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

type Field = HTMLInputElement | HTMLSelectElement;
const fieldsIn = (row: Element): Field[] => Array.from(row.querySelectorAll<Field>("input, select"))
  .filter(field => !field.disabled && !(field instanceof HTMLInputElement && (field.readOnly || field.type === "hidden")) && field.getClientRects().length > 0);
const focusField = (field?: Field) => {
  field?.focus();
  if (field instanceof HTMLInputElement && ["text", "search", "tel"].includes(field.type)) field.select();
};

/** Enter advances within invoice lines; it never triggers invoice submission.
 * Escape on a line with no entered values (no product, no quantity, price,
 * discount or bonus typed) skips that line via onSkipLine instead. */
export function InvoiceLineNavigation({ children, onAddLine, onSkipLine }: { children: ReactNode; onAddLine: () => void; onSkipLine?: (index: number) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const pendingRow = useRef<number | null>(null);
  const previousCount = useRef(0);
  useLayoutEffect(() => {
    const rows = root.current?.querySelectorAll("[data-invoice-line]");
    const count = rows?.length ?? 0;
    const index = pendingRow.current ?? (count > previousCount.current ? count - 1 : null);
    previousCount.current = count;
    if (index === null) return;
    const row = rows?.[index];
    if (row) {
      pendingRow.current = null;
      focusField(fieldsIn(row)[0]);
    }
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const row = target.closest("[data-invoice-line]");
    if (!row) return;
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
    else { pendingRow.current = nextIndex; onAddLine(); }
  };
  return <div ref={root} className="mb-4 space-y-3" onKeyDown={handleKeyDown}>{children}</div>;
}
