"use client";
import { useEffect, useRef, useState } from "react";

export function BarcodeInput({ value, onChange, onScan, disabled, autoFocus = false, label = "Scan barcode", focusSignal = 0, compact = false }: { value?: string; onChange?: (value: string) => void; onScan: (value: string) => void; disabled?: boolean; autoFocus?: boolean; label?: string; focusSignal?: number; compact?: boolean }) {
  const [localValue, setLocalValue] = useState(""); const input = useRef<HTMLInputElement>(null);
  const text = value ?? localValue;
  useEffect(() => { if (focusSignal > 0 && !disabled) input.current?.focus(); }, [focusSignal, disabled]);
  const change = (value: string) => { setLocalValue(value); onChange?.(value); };
  const scan = () => { if (!text.trim() || disabled) return; onScan(text.trim()); if (value === undefined) setLocalValue(""); input.current?.focus(); };
  return <div className="space-y-2" data-help-topic="barcode">
    <label className="block text-sm font-medium">{label}<input ref={input} value={text} autoFocus={autoFocus} disabled={disabled} type="text" autoComplete="off" spellCheck={false} maxLength={200} placeholder="Scan here or type the barcode" onChange={event => change(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); scan(); } }} className="mt-1 w-full rounded border border-input bg-background px-3 py-2 focus:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
    <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled || !text.trim()} onClick={scan} className="rounded border px-3 py-1">Use barcode</button><button type="button" disabled={disabled} onClick={() => input.current?.focus()} className="underline">Ready to scan</button></div>
    {!compact && <p className="text-xs text-muted-foreground">Use a USB/Bluetooth scanner in keyboard mode with Enter as its ending key. Click Ready to scan after editing another field. Scanning never saves the invoice.</p>}
  </div>;
}
