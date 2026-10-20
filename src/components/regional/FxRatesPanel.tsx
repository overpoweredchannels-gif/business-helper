"use client";

import { useCallback, useEffect, useState } from "react";
import { useRegional } from "./RegionalProvider";
import { currencies, type Currency } from "@/lib/regional/settings";
import { supabase } from "@/lib/supabase/client";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; rate: string | null; rateDate: string | null }
  | { kind: "notSetup" }
  | { kind: "error" };

const control =
  "min-h-11 w-full rounded border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Owner-facing FX rate manager. Rates are stored server-side (fx_quotes) as
 * PKR per 1 unit of the selected currency. When a rate exists, every amount
 * formatted through formatPKR converts at display time; without a rate the
 * app keeps plain denomination display — a rate is never invented. */
export function FxRatesPanel() {
  const { t, currency: displayCurrency, refreshFxRate } = useRegional();
  const [target, setTarget] = useState<Currency>(displayCurrency !== "PKR" ? displayCurrency : "EUR");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [rateInput, setRateInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async (currency: Currency) => {
    setState({ kind: "loading" });
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setState({ kind: "error" });
        return;
      }
      const response = await fetch(`/api/fx/rates?currency=${currency}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 503) {
        setState({ kind: "notSetup" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      const payload = (await response.json()) as { rate?: string | null; rateDate?: string | null };
      setState({ kind: "ready", rate: payload.rate ?? null, rateDate: payload.rateDate ?? null });
      setRateInput(payload.rate ?? "");
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load(target);
  }, [target, load]);

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    setSavedTick(false);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setSaveError(t("fx.error"));
        return;
      }
      const response = await fetch("/api/fx/rates", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ currency: target, rate: rateInput.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { rate?: string; rateDate?: string };
      if (!response.ok) {
        setSaveError(response.status === 503 ? t("fx.notSetup") : t("fx.error"));
        return;
      }
      setState({ kind: "ready", rate: payload.rate ?? rateInput.trim(), rateDate: payload.rateDate ?? null });
      setSavedTick(true);
      refreshFxRate();
    } catch {
      setSaveError(t("fx.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="fx-rates-title" className="mt-5 space-y-4 rounded border border-border bg-background p-5">
      <div>
        <h3 id="fx-rates-title" className="text-lg font-semibold text-foreground">{t("fx.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("fx.hint")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">{t("fx.currency")}</span>
          <select
            className={control}
            value={target}
            onChange={(event) => setTarget(event.target.value as Currency)}
          >
            {(Object.keys(currencies) as Currency[]).filter((c) => c !== "PKR").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">{t("fx.rateLabel")}</span>
          <input
            className={control}
            inputMode="decimal"
            placeholder="312.45"
            value={rateInput}
            onChange={(event) => setRateInput(event.target.value)}
          />
        </label>
      </div>

      {state.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">{t("fx.loading")}</p>}
      {state.kind === "notSetup" && <p role="alert" className="text-sm text-destructive">{t("fx.notSetup")}</p>}
      {state.kind === "error" && <p role="alert" className="text-sm text-destructive">{t("fx.error")}</p>}
      {state.kind === "ready" && (
        <p className="text-sm text-muted-foreground">
          {state.rate
            ? `${t("fx.currentRate")}: 1 ${target} = ${state.rate} PKR${state.rateDate ? ` (${state.rateDate})` : ""}`
            : t("fx.noRate")}
        </p>
      )}
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {savedTick && <p role="status" className="text-sm text-foreground">{t("fx.saved")}</p>}

      <button
        type="button"
        disabled={busy || state.kind === "notSetup" || !rateInput.trim()}
        onClick={() => void save()}
        className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {busy ? t("common.saving") : t("fx.save")}
      </button>
    </section>
  );
}
