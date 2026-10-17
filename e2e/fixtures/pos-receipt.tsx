import { useState } from "react";
import { createRoot } from "react-dom/client";
import { POSReceipt, type Receipt } from "../../src/components/sales/POSReceipt";
import { buildAtomicSaleReceipt } from "../../src/lib/print/retail-receipt";
import { calculateSaleAmounts } from "../../src/lib/sales/sale-amounts";

const longName = "Synthetic receipt item with a deliberately long product name for narrow-paper wrapping ".repeat(2);
const largeLine = { product_name: `${longName}Large amount`, quantity: "10000", selling_price: "9999999.99", discount: "0.00", unit_mode: "main", unit_type: "Case" };
const fractionalLine = { product_name: `${longName}Fractional amount`, quantity: "0.125", selling_price: "80.60", discount: "0.00", unit_mode: "subunit", subunit_type: "Piece" };
const firstItems = [largeLine, fractionalLine];
const secondItems = [largeLine, ...Array.from({ length: 39 }, (_, index) => ({ ...fractionalLine, product_name: `${String(index + 1).padStart(2, "0")} ${longName}Receipt row` }))];

function confirmedReceipt(number: string, items: typeof firstItems, scope: string): Receipt {
  const amounts = calculateSaleAmounts(items.map(item => ({ quantity: item.quantity, sellingPrice: item.selling_price, discount: item.discount })));
  const total = amounts.total.toFixed(2);
  const received = "100000001000.00";
  const change = (Number(received) - amounts.total).toFixed(2);
  return buildAtomicSaleReceipt({
    customer_name: `Synthetic walk-in customer ${"with an intentionally long name ".repeat(4)}`,
    transaction: {
      invoice_number: number,
      sale_date: "2026-09-28",
      payment_type: "cash",
      discount_amount: "0.00",
      tax_rate: "0.00",
      tax_amount: "0.00",
      total_amount: total,
      cash_received: received,
      change_due: change,
    },
    items,
  }, {
    scope,
    business: `Synthetic Corner Shop ${"Long Business Name ".repeat(4)}`,
    fallbackDate: "2026-09-28",
    fallbackPayment: "cash",
  });
}

const scope = "synthetic-confirmed-pos-receipts";
const receipts = [
  confirmedReceipt("S-SYNTH-001", firstItems, scope),
  confirmedReceipt("S-SYNTH-002", secondItems, scope),
];

function Fixture() {
  const [receipt, setReceipt] = useState(receipts[0]);
  const width = new URLSearchParams(window.location.search).get("width") === "58" ? "58mm" : "80mm";
  return <main data-testid="receipt-fixture" data-requested-width={width}>
    <h1>POS receipt browser fixture</h1>
    <p>Receipts are synthetic confirmed atomic-sale responses; no database or customer data is used.</p>
    <button type="button" onClick={() => setReceipt(receipts[0])}>Select first synthetic sale</button>
    <button type="button" onClick={() => setReceipt(receipts[1])}>Select second synthetic sale</button>
    <POSReceipt receipt={receipt} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
