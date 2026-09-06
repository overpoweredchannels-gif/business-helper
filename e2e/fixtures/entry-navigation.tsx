import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductSearchSelect } from "../../src/components/invoices/ProductSearchSelect";
import { entryNavigationHandlers } from "../../src/components/invoices/entry-navigation";
import { InvoiceLineNavigation } from "../../src/components/invoices/InvoiceLineNavigation";
import { buildInventorySnapshots } from "../../src/lib/inventory/service";

function Fixture() {
  const [customer, setCustomer] = useState("");
  const [lines, setLines] = useState<number[]>([]);
  const [saves, setSaves] = useState(0);
  const stock = buildInventorySnapshots([{ id: 1, name: "Imported stock", currentStock: 131140, reorderLevel: 10 }], [])[0];
  return <main>
    <p>Stock: {stock.currentStock} · Status: {stock.status}</p><p>Save count: {saves}</p>
    <form {...entryNavigationHandlers} onSubmit={event => { event.preventDefault(); setSaves(value => value + 1); }}>
      <ProductSearchSelect label="Customer" searchPlaceholder="Search customer" value={customer} onChange={setCustomer} products={[{ id: "unassigned", label: "Unassigned Customer" }, { id: "assigned", label: "Assigned Customer" }]} />
      <input aria-label="Invoice number" readOnly value="Automatic" />
      <input aria-label="Sale date" type="date" defaultValue="2026-09-06" required />
      <select aria-label="Payment type"><option>Cash</option><option>Credit</option></select>
      <InvoiceLineNavigation onAddLine={() => setLines(rows => [...rows, rows.length])}>{lines.map(row => <div data-invoice-line key={row}>
        <input aria-label={`Product ${row + 1}`} required /><input aria-label={`Quantity ${row + 1}`} type="number" required min="1" />
      </div>)}</InvoiceLineNavigation>
      <button type="button" data-entry-add onClick={() => setLines(rows => [...rows, rows.length])}>Add product</button><button type="submit">Save invoice</button>
    </form>
    <form {...entryNavigationHandlers} onSubmit={event => { event.preventDefault(); setSaves(value => value + 1); }}>
      <input aria-label="Category name" required />
      <select aria-label="Parent category"><option>None</option><option>Food</option></select>
      <select aria-label="Category policy"><option>Inherit</option><option>Block</option></select><button>Save category</button>
    </form>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
