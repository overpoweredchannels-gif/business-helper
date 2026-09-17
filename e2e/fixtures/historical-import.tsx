import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import ImportWizardV2 from "../../src/components/import-export/ImportWizardV2";
import HistoricalRecords from "../../src/components/import-export/HistoricalRecords";
function Fixture(){const[kind,setKind]=useState("historical_sales");return <main className="mx-auto max-w-5xl space-y-6 p-5"><h1>Historical import test</h1><label>Import type<select value={kind} onChange={e=>setKind(e.target.value)}>{["historical_sales","historical_purchases","historical_customer_payments","historical_supplier_payments"].map(key=><option key={key}>{key}</option>)}</select></label><ImportWizardV2 key={kind} entityKey={kind} organizationId="test-org" actorProfileId="test-actor" supabase={{} as SupabaseClient} createAuditLog={async()=>{}} onImported={()=>{}}/><HistoricalRecords organizationId="test-org"/></main>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
