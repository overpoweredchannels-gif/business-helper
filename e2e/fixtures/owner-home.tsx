import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardCustomizePanel } from "../../src/components/dashboard/DashboardCustomizePanel";
import { DashboardView } from "../../src/components/dashboard/DashboardView";
import { DashboardWidget } from "../../src/components/dashboard/DashboardWidget";
import { useDashboardWidgets } from "../../src/lib/preferences/use-dashboard-widgets";
import type { DashboardWidgetId } from "../../src/lib/preferences/dashboard-widgets";
import type { SectionId } from "../../src/lib/tradeos/types";

const sectionByAction: Record<string, SectionId> = {
  "New Sale": "sales",
  "New Purchase": "purchases",
  "Add Product": "products",
  "Record Payment": "customer-payments",
  "Add Customer": "customers",
  "View Inventory": "inventory",
};

function SetupCard({ hidden, customizing, onRemove }: { hidden: boolean; customizing: boolean; onRemove: (id: DashboardWidgetId) => void }) {
  return <DashboardWidget id="setup-import" hidden={hidden} customizing={customizing} onRemove={onRemove} className="mx-auto mb-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
    <section className="rounded-xl border border-primary/30 bg-card p-5">
      <h2 className="text-lg font-semibold">Setup &amp; Data Import</h2>
      <p className="mt-1 text-sm text-muted-foreground">Setup complete. You can still open setup from the sidebar.</p>
      <button type="button" className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open Setup &amp; Data Import</button>
    </section>
  </DashboardWidget>;
}

function QuickSaleCard({ hidden, customizing, onRemove, onAction }: { hidden: boolean; customizing: boolean; onRemove: (id: DashboardWidgetId) => void; onAction: (label: string) => void }) {
  return <DashboardWidget id="quick-sale" hidden={hidden} customizing={customizing} onRemove={onRemove} className="mx-auto mb-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <h2 className="text-lg font-semibold">Quick sale</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose a customer, scan products, check quantity and price, then save.</p>
      <button type="button" className="mt-3 min-h-11 rounded-lg bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground" onClick={() => onAction("New Sale")}>Retail POS / Create a sale</button>
    </section>
  </DashboardWidget>;
}

function ExportCard({ hidden, customizing, onRemove }: { hidden: boolean; customizing: boolean; onRemove: (id: DashboardWidgetId) => void }) {
  return <DashboardWidget id="business-records-export" hidden={hidden} customizing={customizing} onRemove={onRemove} className="mx-auto mb-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
    <section className="rounded-xl border border-primary/30 bg-card p-5">
      <h2 className="text-lg font-semibold">Export business records</h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose any date range to review transactions, payments and stock movement.</p>
    </section>
  </DashboardWidget>;
}

function Fixture() {
  const query = new URLSearchParams(location.search);
  const before = query.has("before");
  const empty = query.has("empty");
  const home = useDashboardWidgets("owner-home-synthetic");
  const [destination, setDestination] = useState("Dashboard");
  const handleAction = (label: string) => setDestination(sectionByAction[label] ?? "sales");
  const handleAlert = (label: string) => {
    const section: Record<string, string> = {
      "Today's Sales": "sales",
      "Today's Profit": "profit-loss",
      "Inventory Value": "inventory",
      "Outstanding Receivables": "customers",
      "Outstanding Payables": "supplier-payments",
      "Low Stock Alerts": "inventory",
      "Pending Approvals": "sales:orders/pending-approval",
      "Collection Tasks": "task-manager:all",
      "Unpaid Purchases": "supplier-payments",
      "Urgent Reorders": "inventory",
      "Customer Follow-ups": "task-manager:all",
      "Expiring Stock Checks": "task-manager:all",
    };
    setDestination(section[label] ?? label);
  };
  const setup = <SetupCard hidden={home.isHidden("setup-import")} customizing={home.customizing} onRemove={home.removeWidget} />;
  const quickSale = <QuickSaleCard hidden={home.isHidden("quick-sale")} customizing={home.customizing} onRemove={home.removeWidget} onAction={handleAction} />;
  const exportCard = <ExportCard hidden={home.isHidden("business-records-export")} customizing={home.customizing} onRemove={home.removeWidget} />;

  return <main>
    {before && <>{setup}{quickSale}{exportCard}</>}
    {home.customizing && <div className="mx-auto w-full max-w-7xl space-y-3 px-4 pt-4 sm:px-6 lg:px-8"><DashboardCustomizePanel removed={home.removed} onShow={home.show} onReset={home.reset} /><p>Saved section cards stay available: {home.added.join(", ") || "none"}</p></div>}
    <DashboardView
      userName="Synthetic Owner"
      todaySales={empty ? undefined : { value: "PKR 42,500" }}
      todayProfit={empty ? undefined : { value: "PKR 8,420" }}
      inventoryValue={empty ? undefined : { value: "PKR 1,204,600" }}
      outstandingReceivables={empty ? undefined : { value: "PKR 88,200" }}
      outstandingPayables={empty ? undefined : { value: "PKR 23,400" }}
      lowStockAlerts={empty ? undefined : { value: "2", count: 2 }}
      pendingApprovals={empty ? 0 : 1}
      invoicesDue={empty ? 0 : 2}
      paymentsDue={empty ? 0 : 1}
      lowStockItems={empty ? 0 : 2}
      customersToFollowUp={empty ? 0 : 1}
      expiringProducts={empty ? 0 : 1}
      onQuickAction={handleAction}
      onKPIClick={handleAlert}
      hiddenWidgets={home.hidden}
      customizingWidgets={home.customizing}
      onRemoveWidget={home.removeWidget}
      onToggleCustomize={() => home.setCustomizing(value => !value)}
      droppedCards={home.added.map(section => ({ id: `section:${section}` as DashboardWidgetId, label: section, node: <p>{section} section summary</p> }))}
    />
    {!before && <>{setup}{quickSale}{exportCard}</>}
    <p role="status" data-testid="destination">Destination: {destination}</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
