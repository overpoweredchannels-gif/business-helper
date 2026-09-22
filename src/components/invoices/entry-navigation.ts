import type { ChangeEvent, KeyboardEvent } from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function fields(root: HTMLElement): Field[] {
  return Array.from(root.querySelectorAll<Field>("input, select, textarea")).filter(field =>
    !field.disabled && !("readOnly" in field && field.readOnly) &&
    !(field instanceof HTMLInputElement && ["hidden", "checkbox", "radio", "file", "submit", "button"].includes(field.type)) && field.getClientRects().length > 0);
}
function advance(root: HTMLElement, target: Field, backwards = false) {
  const all = fields(root);
  const index = all.indexOf(target);
  if (index < 0) return;
  // Fields marked data-entry-skip stay editable by click or Tab, but are stepped
  // over here so a pre-filled value such as today's sale date never demands an
  // extra Enter before the user reaches the next real entry field.
  for (let offset = 1; offset <= all.length; offset += 1) {
    const next = all[index + (backwards ? -offset : offset)];
    if (!next) break;
    if (next.hasAttribute("data-entry-skip")) continue;
    next.focus();
    if (next instanceof HTMLInputElement && ["text", "search", "tel"].includes(next.type)) next.select();
    return;
  }
  if (!backwards) root.querySelector<HTMLButtonElement>("button[data-entry-add]")?.click();
}
export function focusNextEntryField(target: HTMLInputElement) {
  const root = target.closest<HTMLElement>("[data-entry-navigation], [data-invoice-line]");
  if (root) advance(root, target);
}
export const entryNavigationHandlers = {
  "data-entry-navigation": true,
  onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.key !== "Enter" || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target instanceof HTMLInputElement && ["checkbox", "radio", "file", "submit", "button"].includes(target.type)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || (!event.shiftKey && !target.reportValidity())) return;
    advance(event.currentTarget, target, event.shiftKey);
  },
  onChange(event: ChangeEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.checkValidity()) return;
    const root = event.currentTarget;
    // Let React apply dependent fields first; never steal focus if the user moved on.
    requestAnimationFrame(() => {
      if (target.isConnected && document.activeElement === target) advance(root, target);
    });
  },
};
