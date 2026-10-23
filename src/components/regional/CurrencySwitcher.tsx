"use client";

import { useRegional } from "@/components/regional/RegionalProvider";
import { getActiveBooksCurrency } from "@/lib/tradeos/formatters";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Header books-currency indicator.
 *
 * This used to be the display-currency switcher: it wrote a browser
 * cookie that formatPKR then used to divide stored amounts by a
 * display rate — or silently relabel them 1:1 — on every surface.
 * Under the books model an organization's amounts live in ONE real
 * currency (organizations.books_currency) and are never display-
 * converted, so there is nothing to switch here anymore. The control
 * shows the books currency; for the owner it is a shortcut into the
 * audited Business Settings switch flow (warning -> rate prompt ->
 * atomic conversion), and for everyone else it is read-only. The
 * cookie this control used to write no longer feeds any amount
 * rendering in the app.
 */
export function CurrencySwitcher({
  className,
  canChange = false,
  onOpenBooksSettings,
}: {
  className?: string;
  /** Owner only: the books switch itself lives in Business Settings. */
  canChange?: boolean;
  onOpenBooksSettings?: () => void;
}) {
  const { t } = useRegional();
  const [booksCurrency, setBooksCurrency] = useState(getActiveBooksCurrency);
  // The active books currency is pushed into the formatter when the
  // organization loads, and a completed switch reloads the page — so
  // re-reading on focus is enough to pick up the resolved value after
  // first paint.
  useEffect(() => {
    const refresh = () => setBooksCurrency(getActiveBooksCurrency());
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const chipClass = "flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background text-sm font-medium text-foreground min-h-[44px]";
  if (canChange && onOpenBooksSettings) {
    return (
      <button
        type="button"
        onClick={onOpenBooksSettings}
        aria-label={t("header.booksCurrencyOwnerAction").replace("{currency}", booksCurrency)}
        className={cn(chipClass, "hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <Coins className="h-4 w-4" />
        <span>{booksCurrency}</span>
      </button>
    );
  }
  return (
    <span
      role="img"
      aria-label={t("header.booksCurrencyCurrent").replace("{currency}", booksCurrency)}
      className={cn(chipClass, className)}
    >
      <Coins className="h-4 w-4" />
      <span aria-hidden="true">{booksCurrency}</span>
    </span>
  );
}
