"use client";

import { useRegional } from "@/components/regional/RegionalProvider";
import {
  isValidTypedRate,
  parseStoredPkrPerUnit,
  pkrPerUnitFor,
  switchRateFromPkrPerUnit,
} from "@/lib/fx/stored-rate";
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

type StoredRateFetch =
  | { kind: "ready"; rate: number | null }
  | { kind: "notSetup" }
  | { kind: "error" };

/** Latest active owner-entered rate (PKR per 1 unit) for a currency, or
 * null when none is saved. A 503 means the fx_quotes table is absent. */
async function fetchStoredRate(
  currency: Currency,
  token: string,
): Promise<StoredRateFetch> {
  try {
    const response = await fetch(`/api/fx/rates?currency=${currency}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 503) return { kind: "notSetup" };
    if (!response.ok) return { kind: "error" };
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      rate?: string | null;
    } | null;
    if (!payload?.ok) return { kind: "error" };
    return { kind: "ready", rate: parseStoredPkrPerUnit(payload.rate) };
  } catch {
    return { kind: "error" };
  }
}

type StoredRateSave = "ok" | "notSetup" | "error";

/** Save an owner-entered rate (PKR per 1 unit) for a currency. */
async function saveStoredRate(
  currency: Currency,
  rateText: string,
  token: string,
): Promise<StoredRateSave> {
  try {
    const response = await fetch("/api/fx/rates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currency, rate: rateText.trim() }),
    });
    if (response.status === 503) return "notSetup";
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/**
 * Header currency switcher — the currency twin of LanguageSwitcher, and
 * the ONLY currency control in the app.
 *
 * Picking a currency really switches the whole business to it at the
 * owner's saved rate: the popup shows the saved PKR-per-unit rate, then
 * one confirmation runs POST /api/books/convert and the page reloads so
 * no old-currency amount is ever shown labelled with the new one. When
 * no saved rate exists for the new currency (or for the current books
 * currency, when it is not PKR), the popup asks the owner to type it —
 * PKR per 1 unit — and saves it first. The switch never uses a live
 * rate, never falls back to 1.0, and never converts on a guessed rate.
 * There is no separate display currency any more: the switch sets the
 * stored display cookie to the new books currency too, so every surface
 * follows the switch.
 *
 * Owner-only: the convert route rejects non-owners, so the control does
 * not render for anyone else. Staff see amounts in the books currency
 * natively and need no control.
 */
export function CurrencySwitcher({ canSwitch, className }: { canSwitch?: boolean; className?: string }) {
  // `currency` is the provider's reactive value (cookie-backed, correct
  // from the first render). The local booksCurrency state is only
  // refreshed when the popup opens, so after a switch + reload it
  // still showed the old currency until the popup was opened — the
  // 2026-10-30 QA run showed a stale PKR label while EUR was already
  // selected. The visible label therefore follows the provider value.
  const { setCurrency, ui, currency } = useRegional();
  const [open, setOpen] = useState(false);
  const [booksCurrency, setBooksCurrency] = useState<Currency>(() => getActiveBooksCurrency());
  const [target, setTarget] = useState<Currency | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [loadingRate, setLoadingRate] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rate-entry step: the books currency the switch starts from, the
  // stored PKR-per-unit rates resolved for both legs (null = none saved),
  // and the owner's typed rates for whichever leg is missing.
  const [switchFrom, setSwitchFrom] = useState<Currency | null>(null);
  const [storedToRate, setStoredToRate] = useState<number | null>(null);
  const [storedFromRate, setStoredFromRate] = useState<number | null>(null);
  const [enteringRate, setEnteringRate] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [fromRateInput, setFromRateInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);
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
    setSwitchFrom(null);
    setStoredToRate(null);
    setStoredFromRate(null);
    setEnteringRate(false);
    setRateInput("");
    setFromRateInput("");
    setSavingRate(false);
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
    setSwitchFrom(current);
    setStoredToRate(null);
    setStoredFromRate(null);
    setEnteringRate(false);
    setRateInput("");
    setFromRateInput("");
    setSavingRate(false);
    setLoadingRate(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError(ui("header.currencySwitchRateError"));
        return;
      }
      // Saved rates for both legs of the switch. PKR needs no row: it
      // is the identity (1 PKR per 1 PKR).
      const [toResult, fromResult] = await Promise.all([
        fetchStoredRate(code, token),
        current === "PKR"
          ? Promise.resolve<StoredRateFetch>({ kind: "ready", rate: 1 })
          : fetchStoredRate(current, token),
      ]);
      if (toResult.kind === "notSetup" || fromResult.kind === "notSetup") {
        setError(ui("header.currencySwitchRatesNotSetup"));
        return;
      }
      if (toResult.kind === "error" || fromResult.kind === "error") {
        setError(ui("header.currencySwitchRateError"));
        return;
      }
      const toRate = toResult.rate;
      const fromRate = current === "PKR" ? 1 : fromResult.rate;
      setStoredToRate(toRate);
      setStoredFromRate(fromRate);
      // A missing leg blocks the switch: the owner types the missing
      // rate(s) next. Nothing converts on a guessed rate.
      if (toRate === null || fromRate === null) {
        setEnteringRate(true);
        return;
      }
      const switchRate = switchRateFromPkrPerUnit(
        pkrPerUnitFor(current, fromRate),
        pkrPerUnitFor(code, toRate),
      );
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

  /** Save the typed rate(s) for the missing leg(s), then show the confirm step. */
  async function saveEnteredRates() {
    if (!target || !switchFrom) return;
    const needsTo = storedToRate === null;
    const needsFrom = switchFrom !== "PKR" && storedFromRate === null;
    if (needsTo && !isValidTypedRate(rateInput)) {
      setError(ui("header.currencySwitchRateInvalid"));
      return;
    }
    if (needsFrom && !isValidTypedRate(fromRateInput)) {
      setError(ui("header.currencySwitchRateInvalid"));
      return;
    }
    setSavingRate(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError(ui("header.currencySwitchRateError"));
        return;
      }
      let toRate = storedToRate;
      let fromRate = storedFromRate;
      if (needsTo) {
        const saved = await saveStoredRate(target, rateInput, token);
        if (saved !== "ok") {
          setError(
            saved === "notSetup"
              ? ui("header.currencySwitchRatesNotSetup")
              : ui("header.currencySwitchRateError"),
          );
          return;
        }
        toRate = parseStoredPkrPerUnit(rateInput);
      }
      if (needsFrom) {
        const saved = await saveStoredRate(switchFrom, fromRateInput, token);
        if (saved !== "ok") {
          setError(
            saved === "notSetup"
              ? ui("header.currencySwitchRatesNotSetup")
              : ui("header.currencySwitchRateError"),
          );
          return;
        }
        fromRate = parseStoredPkrPerUnit(fromRateInput);
      }
      const switchRate = switchRateFromPkrPerUnit(
        pkrPerUnitFor(switchFrom, fromRate),
        pkrPerUnitFor(target, toRate),
      );
      if (switchRate === null) {
        setError(ui("header.currencySwitchRateError"));
        return;
      }
      setStoredToRate(toRate);
      setStoredFromRate(fromRate);
      setRate(switchRate);
      setEnteringRate(false);
    } finally {
      setSavingRate(false);
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
        setError(ui("header.currencySwitchNotSent"));
        return;
      }
      const response = await fetch("/api/books/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // Send exactly six decimals: the convert route's parser
        // rejects more, and the switch rate is a raw division
        // (fromPkrPerUnit / toPkrPerUnit), so a return leg like EUR→PKR
        // sends a long float (308.8326139…) while PKR→EUR sends the
        // clean stored quote (0.003238). That asymmetry is why the
        // 2026-10-30 QA run switched to EUR fine but every switch back
        // failed with the rate error line. toFixed(6) is always
        // parser-legal and far inside reconciliation tolerance.
        body: JSON.stringify({ toCurrency: target, rate: rate.toFixed(6) }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        code?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        // Name the cause instead of one generic line: the 2026-10-30
        // QA runs proved a generic message hides a diagnosable failure.
        // Match the BASE code: the SQL guard names the offending column
        // in the code ('books.unmappedColumn:customers.latitude'), and
        // an exact match missed it — that suffix is exactly why the
        // diagnosed failure showed generic for so long.
        // sameCurrency cannot occur from this UI (picking the current
        // currency closes the popup), so it keeps the generic line.
        const fullCode = payload?.code ?? "";
        const code = fullCode.split(":")[0];
        const column = fullCode.split(":")[1];
        if (code === "books.migrationMissing") setError(ui("header.currencySwitchMigration"));
        else if (code === "books.forbidden") setError(ui("header.currencySwitchForbidden"));
        else if (code === "books.invalidRate") setError(ui("header.currencySwitchRateError"));
        else if (
          code === "books.reconciliationFailed" ||
          code === "books.reconciliationMismatch"
        )
          setError(ui("header.currencySwitchReconciliation"));
        else if (code === "books.unmappedColumn")
          // Name the column too: the 2026-10-30 QA runs showed the
          // guard reveals one unknown column at a time, and the owner
          // needs its name to report it. No new translation key: the
          // column name is appended verbatim to the named line.
          setError(
            column
              ? `${ui("header.currencySwitchUnmapped")} (${column})`
              : ui("header.currencySwitchUnmapped"),
          );
        else if (
          code === "books.conversionFailed" ||
          code === "books.organizationNotFound" ||
          code === "books.currencyInvalid"
        )
          setError(ui("header.currencySwitchFailed"));
        else setError(ui("header.currencySwitchError"));
        return;
      }
      // Display follows books from here on, so the reload lands on the
      // new currency everywhere instead of a stale display cookie.
      setCurrency(target);
      window.location.reload();
    } catch {
      // The request never left (network failure, aborted send): say so
      // instead of the generic line, so a generic line afterwards means
      // only a codeless platform response or a stale build.
      setError(ui("header.currencySwitchNotSent"));
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
        <span>{currency}</span>
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
              ) : enteringRate ? (
                <>
                  <p className="text-sm text-light-text">
                    {ui("header.currencySwitchEnterRate").replace(
                      "{currency}",
                      storedToRate === null ? target : (switchFrom ?? target),
                    )}
                  </p>
                  {storedToRate !== null ? (
                    <p className="text-sm">
                      {ui("header.currencySwitchRate")
                        .replace("{from}", target)
                        .replace("{rate}", formatSwitchRate(storedToRate))
                        .replace("{to}", "PKR")}
                    </p>
                  ) : (
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-foreground">
                        {ui("header.currencySwitchRateLabel").replace("{currency}", target)}
                      </span>
                      <input
                        className="min-h-11 w-full rounded border border-input bg-background px-3 py-2 text-base tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        inputMode="decimal"
                        autoFocus
                        value={rateInput}
                        onChange={(event) => setRateInput(event.target.value)}
                      />
                    </label>
                  )}
                  {switchFrom !== null && switchFrom !== "PKR" && (
                    storedFromRate !== null ? (
                      <p className="text-sm">
                        {ui("header.currencySwitchRate")
                          .replace("{from}", switchFrom)
                          .replace("{rate}", formatSwitchRate(storedFromRate))
                          .replace("{to}", "PKR")}
                      </p>
                    ) : (
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">
                          {ui("header.currencySwitchRateLabel").replace("{currency}", switchFrom)}
                        </span>
                        <input
                          className="min-h-11 w-full rounded border border-input bg-background px-3 py-2 text-base tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          inputMode="decimal"
                          value={fromRateInput}
                          onChange={(event) => setFromRateInput(event.target.value)}
                        />
                      </label>
                    )
                  )}
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveEnteredRates()}
                      disabled={savingRate}
                      className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-[44px] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {savingRate
                        ? ui("header.currencySwitching")
                        : ui("header.currencySwitchRateSave")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(null);
                        setRate(null);
                        setError(null);
                        setEnteringRate(false);
                      }}
                      disabled={savingRate}
                      className="flex-1 px-4 py-2 rounded-lg border border-input text-sm font-medium min-h-[44px] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {ui("header.currencySwitchCancel")}
                    </button>
                  </div>
                </>
              ) : rate !== null ? (
                <>
                  <p className="text-sm">
                    {ui("header.currencySwitchRate")
                      .replace("{from}", booksCurrency)
                      .replace("{rate}", formatSwitchRate(rate))
                      .replace("{to}", target)}
                  </p>
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
                </>
              ) : null}
              {!loadingRate && !enteringRate && rate === null && error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
