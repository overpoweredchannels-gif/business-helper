import { useState } from "react";
import { createPortal } from "react-dom";
import { useRegional } from "@/components/regional/RegionalProvider";
import { validateSaleDraft } from "@/lib/sales/sale-draft";
import { MINI_TABS_LIMIT, type MiniTab } from "@/lib/sales/mini-tabs";
import { formatBooksMoney } from "@/lib/tradeos/formatters";
import type { Customer } from "@/lib/tradeos/types";

/**
 * Phase D (user-visit UX): the mini-tab strip for concurrent invoices.
 *
 * Each tab shows its customer, line count and total; switching never
 * touches the stored sale — the parent snapshots the live sale into the
 * outgoing tab and restores the incoming one. Closing a tab that holds
 * lines asks for confirmation in-app first (never window.confirm);
 * an empty tab closes at once. The strip is dumb on purpose: all state
 * lives in the parent, so the tabs and the live sale can never drift.
 */
export function MiniTabBar({
  tabs,
  activeId,
  customers,
  disabled = false,
  onSwitch,
  onNew,
  onDuplicate,
  onClose,
}: {
  tabs: MiniTab[];
  activeId: string | null;
  customers: Customer[];
  disabled?: boolean;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onClose: (id: string) => void;
}) {
  const { t } = useRegional();
  const [closeTarget, setCloseTarget] = useState<MiniTab | null>(null);

  const tabTotal = (tab: MiniTab): number | null =>
    validateSaleDraft({
      lines: tab.sale.lines,
      invoiceDiscount: tab.sale.discount,
      invoiceDiscountType: tab.sale.discountType,
      taxRate: tab.sale.tax,
      paymentType: tab.sale.paymentType,
      allowInvoiceAdjustments: true,
    }).amounts?.total ?? null;

  const tabCustomerName = (tab: MiniTab): string =>
    customers.find((customer) => customer.id === tab.sale.customerId)?.customer_name ??
    t("pos.newSale");

  const tabSummary = (tab: MiniTab): string => {
    const total = tabTotal(tab);
    return `${t("pos.basketLines").replace("{count}", String(tab.sale.lines.length))} · ${
      total === null ? t("pos.totalUnavailable") : formatBooksMoney(total)
    }`;
  };

  const requestClose = (tab: MiniTab) => {
    if (tab.sale.lines.length === 0) onClose(tab.id);
    else setCloseTarget(tab);
  };

  const atLimit = tabs.length >= MINI_TABS_LIMIT;

  return (
    <div>
      <div role="tablist" aria-label={t("pos.miniTabs")} className="flex flex-wrap items-stretch gap-2">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`flex overflow-hidden rounded-lg border ${
                active ? "border-primary" : "border-border"
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => onSwitch(tab.id)}
                className={`min-h-11 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                  active
                    ? "bg-primary font-medium text-primary-foreground"
                    : "bg-card text-foreground/80 hover:bg-muted/40"
                }`}
              >
                <span className="block max-w-44 truncate">{tabCustomerName(tab)}</span>
                <span className={`block text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  {tabSummary(tab)}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("pos.closeTab")}
                disabled={disabled}
                onClick={() => requestClose(tab)}
                className={`min-h-11 min-w-11 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                  active
                    ? "border-l border-primary-foreground/30 bg-primary text-primary-foreground"
                    : "border-l border-border bg-card text-foreground/80 hover:bg-muted/40"
                }`}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={disabled || atLimit}
          onClick={onNew}
          title={atLimit ? t("pos.tabLimit") : undefined}
          className="min-h-11 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          + {t("pos.newTab")}
        </button>
        <button
          type="button"
          disabled={disabled || atLimit || !activeId}
          onClick={onDuplicate}
          title={atLimit ? t("pos.tabLimit") : undefined}
          className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {t("pos.duplicateTab")}
        </button>
      </div>
      {atLimit && (
        <p className="mt-2 text-xs text-muted-foreground">{t("pos.tabLimit")}</p>
      )}
      {closeTarget &&
        createPortal(
          <div data-context-help-skip role="dialog" aria-modal="true" aria-label={t("pos.closeTabTitle")} className="fixed inset-0 z-[100] overflow-auto bg-black/30 p-4">
            <div className="mx-auto max-w-md space-y-4 rounded-xl bg-card p-4 shadow-xl">
              <h3 className="font-semibold">{t("pos.closeTabTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("pos.closeTabBody")
                  .replace("{customer}", tabCustomerName(closeTarget))
                  .replace(
                    "{total}",
                    (() => {
                      const total = tabTotal(closeTarget);
                      return total === null ? t("pos.totalUnavailable") : formatBooksMoney(total);
                    })(),
                  )}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setCloseTarget(null)} className="min-h-11 min-w-11 rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("common.cancel")}</button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const id = closeTarget.id;
                    setCloseTarget(null);
                    onClose(id);
                  }}
                  className="min-h-11 min-w-11 rounded border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {t("pos.discard")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
