import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SetupReview } from "../../src/components/import-export/SetupReview";
import { ReferenceTemplateReview } from "../../src/components/print/ReferenceTemplateReview";
import { missingSetup } from "../../src/lib/tradeos/data-quality";
import { cloneDefaultTemplate } from "../../src/lib/print/default-templates";

const rows = Array.from({ length: 1500 }, (_, i) => ({ id: String(i), label: `Product ${i + 1}`, reorder_level: null as number | null, track_batch: false, track_expiry: false }));
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/api/data-quality")) {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      for (const row of rows) if (body.ids.includes(row.id)) Object.assign(row, { [body.field]: Number(body.value) });
      return Response.json({ ok: true, updated: body.ids.length, requested: body.ids.length });
    }
    return Response.json({ ok: true, options: {}, rows: rows.map(row => ({ ...row, missing: missingSetup("products", row) })) });
  }
  if (url.includes("/api/print-templates/reference")) return Response.json({ ok: true, template: cloneDefaultTemplate("sales_invoice"), warnings: ["Synthetic recognition response for UI testing only."] });
  return Response.json({ ok: false }, { status: 404 });
};
function Fixture() {
  const [saved, setSaved] = useState(0); const [accepted, setAccepted] = useState(false);
  return <main><h1>Meeting follow-up fixture</h1><SetupReview entity="products" onSaved={() => setSaved(x => x + 1)} /><p>Refreshes: {saved}</p><ReferenceTemplateReview docType="sales_invoice" onAccept={() => setAccepted(true)} previewRenderer={template => <p>Preview: {template.header.headingText}</p>} /><p>Reference accepted: {String(accepted)}</p></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
