import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { InvoiceLineNavigation } from "../../src/components/invoices/InvoiceLineNavigation";
import { enteredInvoiceLines } from "../../src/lib/invoices/entry-lines";

const empty = () => ({ product_id: null as string | null, quantity: "", price: "", extra: "", unit_mode: "main" });
function Fixture() {
  const purchase = new URLSearchParams(location.search).get("kind") === "purchase";
  const [lines, setLines] = useState([empty()]);
  const [saves, setSaves] = useState(0);
  const [savedLines, setSavedLines] = useState(0);
  const change = (index: number, key: string, value: string) => setLines(current => current.map((line, i) => i === index ? { ...line, [key]: value } : line));
  return <form onSubmit={event => { event.preventDefault(); setSaves(value => value + 1); }}>
    <h1>{purchase ? "Purchase" : "Sales"} keyboard entry</h1>
    <InvoiceLineNavigation onAddLine={() => setLines(current => [...current, empty()])}>
      {lines.map((line, index) => <div data-invoice-line key={index}>
        <label>Product {index + 1}<select required value={line.product_id ?? ""} onChange={event => change(index, "product_id", event.target.value)}>
          <option value="">Select Product</option><option value="product-a">Tea — Brand A</option><option value="product-b">Tea — Brand B</option>
        </select></label>
        <label>Unit {index + 1}<select disabled value="main" onChange={() => {}}><option value="main">Carton</option></select></label>
        <label>Quantity {index + 1}<input type="number" required min="0.000001" step="any" value={line.quantity} onChange={event => change(index, "quantity", event.target.value)} /></label>
        <label>Price {index + 1}<input type="number" required min="0" step="any" value={line.price} onChange={event => change(index, "price", event.target.value)} /></label>
        <label>{purchase ? "Expiry" : "Bonus"} {index + 1}<input type={purchase ? "date" : "number"} value={line.extra} onChange={event => change(index, "extra", event.target.value)} /></label>
      </div>)}
    </InvoiceLineNavigation>
    <button type="button" onClick={() => { setSavedLines(enteredInvoiceLines(lines).length); setSaves(value => value + 1); }}>Save invoice</button>
    <output>Saves: {saves}; saved lines: {savedLines}</output>
  </form>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
