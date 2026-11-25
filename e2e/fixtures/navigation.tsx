import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/components/dashboard/Sidebar";
import { DashboardLayout } from "../../src/components/dashboard/DashboardLayout";
import { AppFooter } from "../../src/components/branding/AppFooter";
import { navigationItems } from "../../src/lib/tradeos/constants";
import type { SectionId } from "../../src/lib/tradeos/types";

function Fixture() {
  const restricted = new URLSearchParams(location.search).has("restricted");
  const items = restricted ? navigationItems.filter(item => ["dashboard", "sales", "customers"].includes(item.id)) : navigationItems;
  const [active, setActive] = useState<SectionId>("dashboard");
  const [customizing, setCustomizing] = useState(false);
  if (new URLSearchParams(location.search).has("layout")) {
    return <><DashboardLayout
      navigationItems={items}
      activeSection={active}
      onSectionChange={setActive}
      organizationName="Fixture Workspace"
      userName="Fixture Operator"
      notificationCount={1}
      notifications={[{ id: "notice", title: "Inventory notice", section: "inventory" }]}
      onNotificationClick={() => setActive("inventory")}
      onSearchChange={query => query.toLowerCase() === "fixture product"
        ? [{ id: "fixture-product", label: "Fixture product", type: "product", section: "products" }]
        : []}
      onSearchSubmit={() => setActive("products")}
      canCustomize
      onToggleCustomize={() => setCustomizing(value => !value)}
    >
      <h1>Navigation fixture</h1>
    </DashboardLayout><AppFooter /></>;
  }
  return <Sidebar items={items} activeSection={active} onSectionChange={setActive} forceVisible hiddenIds={["brands"]} canCustomize customizeMode={customizing} onToggleCustomize={() => setCustomizing(value => !value)} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
