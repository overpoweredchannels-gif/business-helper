"use client";
import { useEffect, useRef, useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";

export function BarcodeInput({ value, onChange, onScan, canAutoSubmit, disabled, autoFocus = false, label, focusSignal = 0, compact = false }: { value?: string; onChange?: (value: string) => void; onScan: (value: string) => unknown; /** Optional exact-match gate for the scanner auto-detect timer: when
   * provided, a paused burst is submitted only if it returns true for the
   * current text. A mid-burst pause can leave a partial code in the field;
   * submitting that prefix used to add (or error on) the wrong thing, so
   * auto-detect now validates before submitting and otherwise waits for
   * Enter / more input. Manual Enter and the button are never gated. */
  canAutoSubmit?: (value: string) => boolean; disabled?: boolean; autoFocus?: boolean; label?: string; focusSignal?: number; compact?: boolean }) {
  const { t } = useRegional();
  const displayLabel = label ?? t('barcode.scanBarcode');
  const [localValue, setLocalValue] = useState(""); const input = useRef<HTMLInputElement>(null);
  const text = value ?? localValue;
  // Track input timing for scanner auto-detection (scanners type fast, humans type slow)
  const lastInputTime = useRef<number>(0);
  const inputTimer = useRef<NodeJS.Timeout | null>(null);
  // The last code actually submitted. The field now KEEPS the scanned code
  // visible, so without this guard a slow pause (auto-detect fires) followed
  // by the scanner's Enter would submit the same code twice. Any edit to
  // the field clears the marker, so deliberately re-entering the same code
  // (a second unit of the same product) still submits.
  const lastSubmitted = useRef<string | null>(null);
  
  useEffect(() => { if (focusSignal > 0 && !disabled) input.current?.focus(); }, [focusSignal, disabled]);
  // Cleanup timer on unmount
  useEffect(() => { return () => { if (inputTimer.current) clearTimeout(inputTimer.current); }; }, []);
  
  const change = (value: string) => {
    if (value !== lastSubmitted.current) lastSubmitted.current = null;
    setLocalValue(value);
    onChange?.(value);
    
    // Auto-detect scanner: if input is rapid (>3 chars in <100ms) and then pauses,
    // likely a scanner without Enter suffix. Trigger scan after 150ms pause.
    const now = Date.now();
    const timeSinceLastInput = now - lastInputTime.current;
    lastInputTime.current = now;
    
    if (inputTimer.current) clearTimeout(inputTimer.current);
    
    // Only auto-trigger if: rapid input (scanner-like) AND sufficient length
    if (timeSinceLastInput < 100 && value.trim().length >= 4) {
      inputTimer.current = setTimeout(() => {
        // Double-check the value hasn't changed (user didn't keep typing)
        const currentText = input.current?.value ?? "";
        if (currentText.trim() === value.trim() && currentText.trim().length >= 4) {
          // A burst that paused mid-code leaves a partial prefix here. When
          // the caller provides an exact-match gate, only a complete code
          // may auto-submit; a partial one waits for the rest of the burst
          // or for Enter instead of being submitted as-is.
          if (canAutoSubmit && !canAutoSubmit(currentText.trim())) return;
          scan();
        }
      }, 150);
    }
  };
  const scan = () => {
    if (inputTimer.current) clearTimeout(inputTimer.current);
    // Read the live input value rather than the render-captured state: the
    // rapid-detect timer fires from an earlier render whose state lags one
    // keystroke behind the DOM it validated against, which used to submit
    // the scanned code with its last character missing.
    const scanned = (input.current?.value ?? text).trim();
    if (!scanned || disabled) return;
    if (scanned === lastSubmitted.current) {
      // Same code already submitted and untouched since — a duplicate
      // trigger (auto-detect + Enter), not a new scan.
      input.current?.focus();
      if (value === undefined) input.current?.select();
      return;
    }
    const outcome = onScan(scanned);
    if (outcome === false || outcome === null) {
      // The parent rejected the code (no product was added). The marker is
      // set only on a confirmed add: arming it here used to poison the
      // field, swallowing an immediate rescan of the same code — e.g. the
      // cashier fixing the problem and scanning the item again — as if it
      // were a duplicate trigger.
      input.current?.focus();
      return;
    }
    lastSubmitted.current = scanned;
    input.current?.focus();
    // Uncontrolled mode: keep the scanned code visible as cashier
    // confirmation, selected so the next scan or keystroke replaces it
    // instead of appending to it. Controlled parents own the value and
    // keep their existing behavior untouched.
    if (value === undefined) input.current?.select();
  };
  return <div className="space-y-2" data-help-topic="barcode">
    <label className="block text-sm font-medium">{displayLabel}<input ref={input} value={text} autoFocus={autoFocus} disabled={disabled} type="text" autoComplete="off" spellCheck={false} maxLength={200} placeholder={t('barcode.placeholder')} onChange={event => change(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); scan(); } }} className="mt-1 w-full rounded border border-input bg-background px-3 py-2 focus:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
    <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled || !text.trim()} onClick={scan} className="rounded border px-3 py-1">{t('barcode.useBarcode')}</button><button type="button" disabled={disabled} onClick={() => input.current?.focus()} className="underline">{t('barcode.readyToScan')}</button></div>
    {!compact && <p className="text-xs text-muted-foreground">{t('barcode.helpText')}</p>}
  </div>;
}
