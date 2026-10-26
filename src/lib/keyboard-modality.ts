// Last-input modality tracking (2026-10-26). Dropdown auto-open via
// showPicker must only fire for keyboard focus: calling it during a
// mouse/touch focus would open the popup just for the click's own
// default action to close it again, so a clicked select would appear
// dead. Keyboard focus (Tab, Enter-walk, arrows) sets true;
// pointerdown sets false. Idempotent and SSR-safe.
let initialized = false;
let lastInputWasKeyboard = false;

export function initKeyboardModality(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("keydown", () => { lastInputWasKeyboard = true; }, true);
  window.addEventListener("pointerdown", () => { lastInputWasKeyboard = false; }, true);
}

export function wasLastInputKeyboard(): boolean {
  return lastInputWasKeyboard;
}
