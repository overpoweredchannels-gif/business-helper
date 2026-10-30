"use client";

import { useRegional } from "@/components/regional/RegionalProvider";
import { conversionRatePerUnit } from "@/lib/fx/live-rate";
import { currencies, type Currency } from "@/lib/regional/settings";
import { supabase } from "@/lib/supabase/client";
import { getActiveBooksCurrency } from "@/lib/tradeos/formatters";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const SWITCH_CURRENCIES = Object.keys(currencies) as Currency[];

/** Readable rate text: four decimals at and above 1, six below it. */
function formatSwitchRate(rate: number): string {
  if (rate >= 1) return rate.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return rate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Header currency switcher — the currency twin of LanguageSwitcher, and
 * the ONLY currency control in the app.
 *
 * Picking a currency really switches the whole business to it at today's
 * live internet rate: one confirmation inside the popup (rate shown, no
 * page, no typing), then POST /api/books/convert runs the single atomic
 * conversion and the page reloads so no old-currency amount is ever shown
 * labelled with the new one. There is no separate display currency any
 * more: the switch sets the stored display cookie to the new books
 * currency too, so every surface follows the switch.
 *
 * Owner-only: the convert route rejects non-owners, so the control does
 * not render for anyone else. Staff see amounts in the books currency
 * natively and need no control.
 */
export function CurrencySwitcher({ canSwitch, className }: { canSwitch?: boolean; className?: string }) {
  const { setCurrency, ui } = useRegional();
  const [open, setOpen] = useState(false);
  const [booksCurrency, setBooksCurrency] = useState<Currency>(() => getActiveBooksCurrency());
  const [target, setTarget] = useState<Currency | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [loadingRate, setLoadingRate] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    setOpen(false);
    setTarget(null);
    setRate(null);
    setError(null);
    setConverting(false);
  }

  function openPopup() {
    // The books currency is set when the organization loads; refresh it
    // on open so a switch made in another tab is never offered twice.
    setBooksCurrency(getActiveBooksCurrency());
    setTarget(null);
    setRate(null);
    setError(null);
    setOpen(true);
  }

  async function pickCurrency(code: Currency) {
    // Read books fresh: the state can predate a switch made in another
    // tab, and the rate must match the books the server will convert.
    const current = getActiveBooksCurrency();
    if (current !== booksCurrency) setBooksCurrency(current);
    if (code === current) {
      close();
      return;
    }
    setTarget(code);
    setRate(null);
    setError(null);
    setLoadingRate(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError(ui("header.currencySwitchRateError"));
        return;
      }
      const response = await fetch(`/api/fx/live?currency=${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        perPkr?: Partial<Record<Currency, number>>;
      } | null;
      const switchRate =
        response.ok && payload?.ok
          ? conversionRatePerUnit(payload.perPkr, current, code)
          : null;
      if (switchRate === null) {
        setError(ui("header.currencySwitchRateError"));
        return;
      }
      setRate(switchRate);
    } catch {
      setError(ui("header.currencySwitchRateError"));
    } finally {
      setLoadingRate(false);
    }
  }

  async function confirmSwitch() {
    if (!target || rate === null) return;
    setConverting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError(ui("header.currencySwitchError"));
        return;
      }
      const response = await fetch("/api/books/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ toCurrency: target, rate: String(rate) }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        code?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        // Name the cause instead of one generic line: the 2026-10-30
        // QA runs proved a generic message hides a diagnosable failure.
        // Every code the convert route can return is mapped here, so a
        // generic line now means only "no code reached the popup"
        // (transport failure or a stale build), never a hidden cause.
        // sameCurrency cannot occur from this UI (picking the current
        // currency closes the popup), so it keeps the generic line.
        const code = payload?.code ?? "";
        setError(
          code === "books.migrationMissing"
            ? ui("header.currencySwitchMigration")
            : code === "books.forbidden"
              ? ui("header.currencySwitchForbidden")
              : code === "books.invalidRate"
                ? ui("header.currencySwitchRateError")
                : code === "books.reconciliationFailed" ||
                    code === "books.reconciliationMismatch"
                  ? ui("header.currencySwitchReconciliation")
                  : code === "books.unmappedColumn"
                    ? ui("header.currencySwitchUnmapped")
                    : code === "books.conversionFailed" ||
                        code === "books.organizationNotFound" ||
                        code === "books.currencyInvalid"
                      ? ui("header.currencySwitchFailed")
                      : ui("header.currencySwitchError"),
        );
        return;
      }
      // Display follows books from here on, so the reload lands on the
      // new currency everywhere instead of a stale display cookie.
      setCurrency(target);
      window.location.reload();
    } catch {
      setError(ui("header.currencySwitchError"));
    } finally {
      setConverting(false);
    }
  }

  if (!canSwitch) return null;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => (open ? close() : openPopup())}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={ui("header.currencySwitch")}
        aria-expanded={open}
        data-currency-switch={booksCurrency}
      >
        <Coins className="h-4 w-4" />
        <span>{booksCurrency}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-background shadow-lg z-50 overflow-hidden">
          {target === null ? (
            SWITCH_CURRENCIES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => void pickCurrency(code)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-muted transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  booksCurrency === code && "bg-primary/10 text-primary font-medium",
                )}
              >
                <span>{code}</span>
                <span className="text-xs text-light-text">{currencies[code].name}</span>
              </button>
            ))
          ) : (
            <div className="px-4 py-4 space-y-3">
              <p className="text-sm font-medium">
                {ui("header.currencySwitchConfirm").replace("{currency}", target)}
              </p>
              {loadingRate ? (
                <p className="text-sm text-light-text">{ui("header.currencySwitching")}</p>
              ) : rate !== null ? (
                <p className="text-sm">
                  {ui("header.currencySwitchRate")
                    .replace("{from}", booksCurrency)
                    .replace("{rate}", formatSwitchRate(rate))
                    .replace("{to}", target)}
                </p>
              ) : null}
              <p className="text-sm text-light-text">{ui("header.currencySwitchRecords")}</p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmSwitch()}
                  disabled={rate === null || loadingRate || converting}
                  className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-confirm-currency-switch={target}
                >
                  {converting
                    ? ui("header.currencySwitching")
                    : ui("header.currencySwitchButton")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTarget(null);
                    setRate(null);
                    setError(null);
                  }}
                  disabled={converting}
                  className="flex-1 px-4 py-2 rounded-lg border border-input text-sm font-medium min-h-[44px] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ui("header.currencySwitchCancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
