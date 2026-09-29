import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/components/dashboard/Sidebar";
import { navigationItems } from "../../src/lib/tradeos/constants";
import type { SectionId } from "../../src/lib/tradeos/types";

function Fixture() {
  const restricted = new URLSearchParams(location.search).has("restricted");
  const items = restricted ? navigationItems.filter(item => ["dashboard", "sales", "customers"].includes(item.id)) : navigationItems;
  const [active, setActive] = useState<SectionId>("dashboard");
  const [customizing, setCustomizing] = useState(false);
  return <Sidebar items={items} activeSection={active} onSectionChange={setActive} forceVisible hiddenIds={["brands"]} canCustomize customizeMode={customizing} onToggleCustomize={() => setCustomizing(value => !value)} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
