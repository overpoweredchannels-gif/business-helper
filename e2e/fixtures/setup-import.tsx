import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../../src/components/dashboard/Sidebar";
import { HelpCenter } from "../../src/components/help/HelpCenter";
import SetupImportHub from "../../src/components/import-export/SetupImportHub";
import { SetupReview } from "../../src/components/import-export/SetupReview";
import type { SectionId } from "../../src/lib/tradeos/types";
import type { SupabaseClient } from "@supabase/supabase-js";
const db = { from: () => { const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: [], error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 25, error: null }).then(resolve) }; return query; } } as unknown as SupabaseClient;
function Fixture() {
  const [active, setActive] = useState<SectionId>("setup-import"); const [customize, setCustomize] = useState(false);
  const [items, setItems] = useState<{ id: SectionId; label: string }[]>([{ id: "dashboard", label: "Dashboard" }, { id: "setup-import", label: "Setup & Data Import" }, { id: "products", label: "Products" }]);
  return <div className="flex"><Sidebar items={items} activeSection={active} onSectionChange={setActive} canCustomize customizeMode={customize} onToggleCustomize={() => setCustomize(v => !v)} onMoveItem={(id, direction) => setItems(current => { const next = [...current]; const index = next.findIndex(item => item.id === id); const target = index + (direction === "up" ? -1 : 1); if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; })} /><main className="min-w-0 flex-1 p-5"><p>Current section: {active}</p><SetupImportHub supabase={db} organizationId="fixture-org" userId="fixture-user" actorProfileId="fixture-profile" createAuditLog={async () => {}} onNavigate={setActive} onImported={() => {}} /><SetupReview entity="products" onSaved={() => {}} /></main><HelpCenter userId="setup-import-fixture" /></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
