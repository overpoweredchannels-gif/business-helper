import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HelpCenter } from "../../src/components/help/HelpCenter";
import { BarcodeInput } from "../../src/components/invoices/BarcodeInput";
import { addBarcodeLine, findBarcodeProduct, type BarcodeLine } from "../../src/lib/invoices/barcode";
const products = [{ id: "one", name: "Test Box", barcode: "001234", unit_type: "Box", subunit_type: "Piece", units_per_pack: 12, default_selling_price: 120 }];
function Fixture() {
  const modal = useRef<HTMLDialogElement>(null);
  const [lines, setLines] = useState<BarcodeLine[]>([]); const [error, setError] = useState(""); const [saves, setSaves] = useState(0); const [barcode, setBarcode] = useState("");
  return <main style={{ maxWidth: 700, padding: 40, fontFamily: "Arial" }}><h1>Sales Invoice</h1><form onSubmit={event => { event.preventDefault(); setSaves(value => value + 1); }}>
    <label>Customer<input aria-label="Customer" /></label><label>Main unit<select aria-label="Main unit"><option>Box</option><option>Piece</option></select></label>
    <BarcodeInput onScan={code => { try { setLines(rows => addBarcodeLine(rows, findBarcodeProduct(products, code), "subunit")); setError(""); } catch (err) { setError((err as Error).message); } }} />
    <p role="status">{error}</p><p>Lines: {lines.length}</p>{lines.map(line => <p key={line.product_id}>{line.product_id}: Quantity {line.quantity}, Price {line.selling_price}, Unit {line.unit_mode}</p>)}<button type="submit">Save invoice</button><p>Save count: {saves}</p>
  </form><label><input type="checkbox" aria-label="Keep customer" /> Keep customer</label><h2>Add product</h2><BarcodeInput label="Product barcode" value={barcode} onChange={setBarcode} onScan={setBarcode} /><p>Stored barcode: {barcode}</p><button onClick={() => modal.current?.showModal()}>Open product dialog</button><dialog ref={modal} className="m-auto rounded border bg-background p-6"><label>Reorder level<input aria-label="Reorder level" /></label><button onClick={() => modal.current?.close()}>Close product dialog</button></dialog><HelpCenter userId="tutorial-barcode-fixture-v1" /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
