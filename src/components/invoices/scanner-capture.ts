"use client";

import { useEffect, useRef } from "react";

// Shared scanner-wedge capture for the two sales surfaces (Retail POS and
// the detailed invoice form). A wedge scanner "types" the code with
// inhumanly even, tiny gaps and finishes with Enter. When focus sits on a
// sale line field (quantity, price, discount value, discount type), on
// bare page, a button, or a checkbox, a rapid burst ending in Enter is a
// scan: it is routed through the scan handler instead of letting the
// digits land in the focused field or the Enter activate the focused
// button. Once a burst is under way its characters are consumed here
// (never typed into the field); its first character may still land, so
// the field's value is snapshotted and restored when the scan completes.
// The listener runs in the capture phase so a detected scan Enter is
// consumed before any section entry-navigation handler can treat it as
// "advance / run the primary action". Human-speed typing never builds a
// burst (any gap >= 50ms resets it) and is left completely untouched, as
// are text inputs, textareas and selects that are not sale line fields.
export type ScannerFieldKind = "quantity" | "price" | "discount" | "discountType";

export interface ScannerFieldRef {
  kind: ScannerFieldKind;
  index: number;
}

export interface ScannerCaptureOptions {
  /** While true, no burst is built and any in-progress burst is dropped. */
  disabled: boolean;
  /** Maps a focused element to the sale line field it is, or null. */
  identifyField: (target: HTMLElement) => ScannerFieldRef | null;
  /** Restores a snapshotted field value (the burst's first character may have landed in it). */
  restoreField: (field: ScannerFieldRef, value: string) => void;
  /** Handles a detected scan code. Return value is ignored. */
  handleScan: (code: string) => unknown;
}

export function useScannerCapture(options: ScannerCaptureOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    const GAP_MS = 50;
    const MIN_CODE_LENGTH = 4;
    let burst = "";
    let lastKeyAt = 0;
    let snapshot: { field: ScannerFieldRef; value: string } | null = null;
    const resetBurst = () => {
      burst = "";
      snapshot = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const config = latest.current;
      const dialogOpen = Array.from(document.querySelectorAll('[role="dialog"]')).some((el) => el.getClientRects().length > 0);
      if (config.disabled || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || dialogOpen) {
        resetBurst();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target === null) {
        resetBurst();
        return;
      }
      const field = config.identifyField(target);
      const capturable =
        target === document.body ||
        target instanceof HTMLButtonElement ||
        (target instanceof HTMLInputElement && target.type === "checkbox") ||
        field !== null;
      if (!capturable) {
        resetBurst();
        return;
      }
      const now = Date.now();
      if (event.key === "Enter") {
        const code = burst;
        const snap = snapshot;
        resetBurst();
        // Any Enter terminating a >= 4-char burst belongs to the scan path,
        // however long the scanner paused before sending it: some wedges
        // delay the terminating Enter past the inter-key gap, and letting
        // it through used to hand it to entry navigation, which can run
        // the primary action (Pay & Save) mid-scan. A surviving burst is
        // rapid by construction — a slow keystroke resets it below — so
        // the final gap no longer decides.
        if (code.length >= MIN_CODE_LENGTH) {
          event.preventDefault();
          event.stopPropagation();
          // Restore the field value the burst typed over, then add the
          // scanned line through the normal scan path.
          if (snap) config.restoreField(snap.field, snap.value);
          config.handleScan(code);
        }
        return;
      }
      if (event.key === "Shift") return;
      if (event.key.length !== 1) {
        resetBurst();
        return;
      }
      if (burst && now - lastKeyAt >= GAP_MS) resetBurst();
      if (!burst && field !== null && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        snapshot = { field, value: target.value };
      }
      if (burst) {
        // A burst is already in progress (this character arrived within
        // the gap of the previous one): it is a captured scan character,
        // so consume it here instead of letting it type into the focused
        // field and corrupt it keystroke by keystroke. Only the burst's
        // first character can still land — at that point it is
        // indistinguishable from human typing — and the snapshot above
        // restores the field when the scan completes.
        event.preventDefault();
        event.stopPropagation();
      }
      burst += event.key;
      lastKeyAt = now;
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
