"use client";

import { useRegional } from "@/components/regional/RegionalProvider";
import { currencies, type Currency } from "@/lib/regional/settings";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const DISPLAY_CURRENCIES = Object.keys(currencies) as Currency[];

/**
 * Header display-currency dropdown — the currency twin of LanguageSwitcher.
 *
 * Picking a currency switches what amounts LOOK like (dashboard and other
 * display surfaces convert with the live internet rate) and nothing else:
 * no page opens, no rate is typed, and stored records stay in the books
 * currency. Sale, invoice, receipt, and ledger amounts keep showing the
 * books currency because those are financial records, not previews.
 */
export function DisplayCurrencySwitcher({ className }: { className?: string }) {
  const { currency, setCurrency, ui } = useRegional();
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

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={ui("header.displayCurrency")}
        aria-expanded={open}
        data-display-currency={currency}
      >
        <Coins className="h-4 w-4" />
        <span>{currency}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-background shadow-lg z-50 overflow-hidden">
          {DISPLAY_CURRENCIES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setCurrency(code);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-muted transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                currency === code && "bg-primary/10 text-primary font-medium",
              )}
            >
              <span>{code}</span>
              <span className="text-xs text-light-text">{currencies[code].name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
