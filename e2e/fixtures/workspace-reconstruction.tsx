import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardLayout } from "../../src/components/dashboard/DashboardLayout";
import { DashboardView } from "../../src/components/dashboard/DashboardView";
import { RecordHistoryPanel } from "../../src/components/sales/RecordHistoryPanel";
import { AppFooter } from "../../src/components/branding/AppFooter";
import { navigationItems } from "../../src/lib/tradeos/constants";
import { useDashboardOrder } from "../../src/lib/preferences/use-dashboard-order";
import type { SectionId } from "../../src/lib/tradeos/types";

const fixtureMoney = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

function Fixture() {
  const [section, setSection] = useState<SectionId>("dashboard");
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const order = useDashboardOrder("design-test");
  const records = Array.from({ length: 23 }, (_, i) => `S-${String(i + 1).padStart(3, "0")}`).filter(id => id.includes(search));
  return <><DashboardLayout navigationItems={navigationItems} activeSection={section} onSectionChange={setSection} organizationName="OP TRADERS" userName="Aankh Owner">
    {section === "dashboard" ? <DashboardView userName="Aankh Owner" customizingWidgets={editing} onToggleCustomize={() => setEditing(!editing)} widgetOrder={order.order} onMoveWidget={order.move}
      todaySales={{ value: fixtureMoney.format(1250) }} todayProfit={{ value: fixtureMoney.format(375) }} inventoryValue={{ value: fixtureMoney.format(4000) }} outstandingReceivables={{ value: fixtureMoney.format(800) }} outstandingPayables={{ value: fixtureMoney.format(200) }} lowStockAlerts={{ value: "2", count: 2 }}
      setupContent={<div className="aankh-card bg-card p-4">Setup and data import</div>}
      quickSaleContent={<div className="aankh-card rounded-xl border border-border bg-card p-5"><h2>Quick sale</h2><button className="workspace-button-secondary">Open Retail POS</button></div>}
      exportContent={<div className="aankh-card rounded-xl border border-border bg-card p-5">Export business records</div>}
      revenueData={[{ label: "Mon", value: 120 }, { label: "Tue", value: 200 }, { label: "Wed", value: 150 }]}
      profitData={[{ label: "Mon", value: -24 }, { label: "Tue", value: 35 }, { label: "Wed", value: 12 }]}
      formatChartValue={value => fixtureMoney.format(value)}
      lowStockItems={2}
      recentActivities={[
        { id: "fixture-sale", type: "sale", description: "Counter invoice S-001", amount: "€120.00", time: "26 Nov, 09:30" },
        { id: "fixture-payment", type: "payment", description: "Payment recorded", amount: "€85.00", time: "26 Nov, 09:00" },
      ]}
      aiInsight={{ insight: "Review stock for two products.", action: "Review inventory", onLearnMore: () => setSection("inventory") }}
      smartModules={[{ id: "products", title: "Products", summary: "78 products", onOpen: () => setSection("products") }, { id: "customers", title: "Customers", summary: "17 customers" }]}
    /> : <div className="workspace-flow"><RecordHistoryPanel title="Sales history" count={records.length} filterKey={search} filters={<input aria-label="History filter" value={search} onChange={e => setSearch(e.target.value)} className="min-h-11 w-full rounded border border-input p-3" />}>
      {(start, end) => <ul data-testid="records">{records.slice(start, end).map(id => <li key={id} className="border-b border-border p-4">{id}</li>)}</ul>}
    </RecordHistoryPanel></div>}
  </DashboardLayout><AppFooter /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
