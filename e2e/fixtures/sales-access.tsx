import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductSearchSelect } from "../../src/components/invoices/ProductSearchSelect";
import { InvoiceLineNavigation } from "../../src/components/invoices/InvoiceLineNavigation";
import { MySalesPerformance } from "../../src/components/salesman/MySalesPerformance";
import { hasSalesTool, salesTools } from "../../src/lib/sales/access";

// Isolated browser fixture. These synthetic responses never contact production.
window.fetch = async input => new Response(JSON.stringify(String(input).includes("/performance") ? { ok: true, sales: [
  { id: "one", invoice_number: "S-TEST-1", customer_id: "customer-1", sale_date: "2026-09-06", created_at: "2026-09-06", status: "confirmed", total_amount: 150, customers: { customer_name: "Ali Store" }, sales_items: [
    { quantity: 2, selling_price: 30, discount: 5, products: { name: "Soap", brand_id: "brand-1", brands: { name: "Brand One" } } },
    { quantity: 1, selling_price: 100, discount: 0, products: { name: "Tea", brand_id: "brand-2", brands: { name: "Brand Two" } } },
  ] },
] } : { ok: true, drafts: [] }), { headers: { "Content-Type": "application/json" } });

function Fixture() {
  const [role, setRole] = useState("salesman");
  const [lines, setLines] = useState([""]);
  return <main style={{ maxWidth: 900, margin: "20px auto", padding: 16 }}>
    <label>Test role<select value={role} onChange={e => setRole(e.target.value)}><option>salesman</option><option>owner</option></select></label>
    <nav>{salesTools.filter(tool => hasSalesTool({ role, granted_sections: ["sales"] }, tool.id)).map(tool => <button key={tool.id}>{tool.label}</button>)}</nav>
    <InvoiceLineNavigation onAddLine={() => setLines(current => [...current, ""])}>{lines.map((value, index) => <div key={index} data-invoice-line>
      <ProductSearchSelect label={`Product ${index + 1}`} value={value} onChange={id => setLines(current => current.map((item, i) => i === index ? id : item))} products={[{ id: "soap", label: "Soap — Brand One (S01)" }, { id: "tea", label: "Tea — Brand Two (T02)" }]} />
      <input aria-label={`Quantity ${index + 1}`} type="number" required min="1" />
    </div>)}</InvoiceLineNavigation>
    <MySalesPerformance />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
