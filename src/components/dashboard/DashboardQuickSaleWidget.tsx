"use client";

import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
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
  if (!canUseInvoice) return null;

  return (
    <DashboardWidget
      id="quick-sale"
      hidden={hidden}
      customizing={customizing}
      onRemove={onRemove}
      className="mx-auto mb-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8"
    >
      <section data-help-topic="quick sale" className="rounded-xl border border-primary/30 bg-primary/5 p-5">
        <h2 className="text-lg font-semibold">Quick sale</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a customer, scan products, check quantity and price, then save. Staff sales go to the owner for approval.</p>
        <div className="mt-3">
          <button
            type="button"
            className="min-h-11 rounded-lg bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground"
            onClick={() => {
              onSetQuickSaleMode(true);
              onSetSalesTab("invoice");
              onFocusBarcode();
              onOpenSales();
            }}
          >
            Retail POS / Create a sale
          </button>
        </div>
      </section>
    </DashboardWidget>
  );
}
