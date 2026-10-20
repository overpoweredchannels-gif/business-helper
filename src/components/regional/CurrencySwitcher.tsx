"use client";

import { useRegional } from "@/components/regional/RegionalProvider";
import type { Currency } from "@/lib/regional/settings";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const CURRENCIES: Array<{ code: Currency; label: string; symbol: string }> = [
  { code: "PKR", label: "Pakistani Rupee", symbol: "Rs" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "Pound Sterling", symbol: "£" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "AED", label: "UAE Dirham", symbol: "د.إ" },
];

export function CurrencySwitcher({ className }: { className?: string }) {
  const { currency, setCurrency } = useRegional();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
        aria-label="Select currency"
        aria-expanded={open}
      >
        <Coins className="h-4 w-4" />
        <span>{current.code}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 rounded-lg border border-border bg-background shadow-lg z-50 overflow-hidden">
          {CURRENCIES.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => {
                setCurrency(item.code);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-muted transition-colors min-h-[44px]",
                currency === item.code && "bg-primary/10 text-primary font-medium"
              )}
            >
              <span>
                {item.code} <span className="text-light-text">· {item.symbol}</span>
              </span>
              <span className="text-xs text-light-text">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
