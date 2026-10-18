"use client";
import { useEffect, useRef, useState } from "react";

export function BarcodeInput({ value, onChange, onScan, disabled, autoFocus = false, label = "Scan barcode", focusSignal = 0, compact = false }: { value?: string; onChange?: (value: string) => void; onScan: (value: string) => void; disabled?: boolean; autoFocus?: boolean; label?: string; focusSignal?: number; compact?: boolean }) {
  const [localValue, setLocalValue] = useState(""); const input = useRef<HTMLInputElement>(null);
  const text = value ?? localValue;
  // Track input timing for scanner auto-detection (scanners type fast, humans type slow)
  const lastInputTime = useRef<number>(0);
  const inputTimer = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => { if (focusSignal > 0 && !disabled) input.current?.focus(); }, [focusSignal, disabled]);
  // Cleanup timer on unmount
  useEffect(() => { return () => { if (inputTimer.current) clearTimeout(inputTimer.current); }; }, []);
  
  const change = (value: string) => { 
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
          scan();
        }
      }, 150);
    }
  };
  const scan = () => { 
    if (inputTimer.current) clearTimeout(inputTimer.current);
    if (!text.trim() || disabled) return; 
    onScan(text.trim()); 
    if (value === undefined) setLocalValue(""); 
    input.current?.focus(); 
  };
  return <div className="space-y-2" data-help-topic="barcode">
    <label className="block text-sm font-medium">{label}<input ref={input} value={text} autoFocus={autoFocus} disabled={disabled} type="text" autoComplete="off" spellCheck={false} maxLength={200} placeholder="Scan here or type the barcode" onChange={event => change(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); scan(); } }} className="mt-1 w-full rounded border border-input bg-background px-3 py-2 focus:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
    <div className="flex flex-wrap gap-3"><button type="button" disabled={disabled || !text.trim()} onClick={scan} className="rounded border px-3 py-1">Use barcode</button><button type="button" disabled={disabled} onClick={() => input.current?.focus()} className="underline">Ready to scan</button></div>
    {!compact && <p className="text-xs text-muted-foreground">Use a USB/Bluetooth scanner in keyboard mode. Press Enter after scanning, or scan quickly and pause — the system will auto-detect. Click Ready to scan after editing another field. Scanning never saves the invoice.</p>}
  </div>;
}
