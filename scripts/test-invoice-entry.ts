import assert from "node:assert/strict";
import { enteredInvoiceLines } from "../src/lib/invoices/entry-lines";

const empty = { product_id: null, quantity: "", price: "", unit_mode: "main" };
const completed = { product_id: "brand-b-product", quantity: "12", price: "25", unit_mode: "subunit" };
const partial = { ...empty, quantity: "2" };
assert.deepEqual(enteredInvoiceLines([completed, empty]), [completed]);
assert.deepEqual(enteredInvoiceLines([empty]), []);
assert.deepEqual(enteredInvoiceLines([partial]), [partial], "Partial entries must still be validated");
assert.deepEqual(enteredInvoiceLines([{ ...empty, price: "0" }]), [{ ...empty, price: "0" }]);
assert.equal(enteredInvoiceLines([completed])[0], completed, "Product ID, unit and quantity must remain unchanged");
console.log("Invoice entry: blank placeholders ignored; partial entries, IDs, quantities and units preserved.");
