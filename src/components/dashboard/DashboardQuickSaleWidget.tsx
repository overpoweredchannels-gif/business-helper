"use client";

import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";

interface DashboardQuickSaleWidgetProps {
  canUseInvoice: boolean;
  hidden: boolean;
  customizing: boolean;
  onRemove: (id: DashboardWidgetId) => void;
  onSetQuickSaleMode: (enabled: boolean) => void;
  onSetSalesTab: (tab: "invoice") => void;
  onFocusBarcode: () => void;
  onOpenSales: () => void;
}

export function DashboardQuickSaleWidget({
  canUseInvoice,
  hidden,
  customizing,
  onRemove,
  onSetQuickSaleMode,
  onSetSalesTab,
  onFocusBarcode,
  onOpenSales,
}: DashboardQuickSaleWidgetProps) {
  const { t } = useRegional();
  if (!canUseInvoice) return null;

  return (
    <DashboardWidget
      id="quick-sale"
      hidden={hidden}
      customizing={customizing}
      onRemove={onRemove}
      className="mx-auto mb-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8"
    >
      <section data-help-topic="quick sale" className="aankh-card rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">{t('dashboard.quickSaleTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.quickSaleHint')}</p>
        <div className="mt-3">
          <button
            type="button"
            className="aankh-action min-h-11 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onSetQuickSaleMode(true);
              onSetSalesTab("invoice");
              onFocusBarcode();
              onOpenSales();
            }}
          >
            {t('dashboard.quickSaleAction')}
          </button>
        </div>
      </section>
    </DashboardWidget>
  );
}
