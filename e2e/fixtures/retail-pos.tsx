import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RetailPOS, type CounterSale } from "../../src/components/sales/RetailPOS";
import { POSReceipt } from "../../src/components/sales/POSReceipt";
import { HelpCenter } from "../../src/components/help/HelpCenter";
import { addBarcodeLine, findBarcodeProduct } from "../../src/lib/invoices/barcode";
import type { Customer, Product } from "../../src/lib/tradeos/types";
const products: Product[] = [{ id: "one", name: "Test Box", barcode: "001234", unit_type: "Box", subunit_type: "Piece", units_per_pack: 12, default_selling_price: 120, brand_id: null, category_id: null }];
const customers = [{ id: "walk-in", customer_name: "Walk-in customer" }] as Customer[];
const empty: CounterSale = { lines: [], customerId: "walk-in", date: "2026-09-17", paymentType: "cash", discount: "", discountType: "flat", tax: "" };
function Fixture() {
  const [sale, setSale] = useState(empty); const [unit, setUnit] = useState<"main" | "subunit">("subunit"); const [saves, setSaves] = useState(0); const [employee, setEmployee] = useState(false); const [focus, setFocus] = useState(0);
  const add = (id: string) => setSale(current => ({ ...current, lines: addBarcodeLine(current.lines, products.find(p => p.id === id)!, unit) }));
  return <main className="mx-auto max-w-6xl p-5"><h1 className="text-2xl font-bold">Retail POS test</h1><label><input type="checkbox" checked={employee} onChange={event => setEmployee(event.target.checked)} /> Employee mode</label><p>Saved sales: {saves}</p>
    <RetailPOS scope="synthetic-pos-test" sale={sale} products={products} customers={customers} total={sale.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.selling_price) - Number(line.discount), 0)} busy={false} owner={!employee} scanUnit={unit} focusSignal={focus} onScan={code => add(String(findBarcodeProduct(products, code).id))} onAdd={add} onUnit={setUnit} onCustomer={id => setSale(current => ({ ...current, customerId: id }))} onLine={(index, field, value) => setSale(current => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, [field]: value } : line) }))} onRemove={index => setSale(current => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }))} onSave={() => { setSaves(value => value + 1); setSale(empty); setFocus(value => value + 1); }} onAdvanced={() => {}} onRestore={setSale} onClear={() => setSale(empty)} />
    {saves > 0 && <POSReceipt receipt={{ scope: "fixture", business: "Test Shop", number: "S-TEST", date: "2026-09-17", customer: "Walk-in customer", total: 10, payment: "cash", lines: [{ name: "Test Box", quantity: "1", unit: "Piece", price: "10", discount: "" }] }} />}
    <section className="mt-10 space-y-5 border p-5"><h2>Help positioning test</h2>{Array.from({ length: 15 }, (_, index) => <label key={index} className="block">Test field {index + 1}<input aria-label={`Test field ${index + 1}`} className="block h-11 w-full rounded border" /></label>)}</section><HelpCenter userId="retail-pos-fixture" />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
