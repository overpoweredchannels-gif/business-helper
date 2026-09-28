import assert from "node:assert/strict";
import { validateSaleDraft, type SaleDraftLine } from "../src/lib/sales/sale-draft";

const draftLine = (overrides: Partial<SaleDraftLine> = {}): SaleDraftLine => ({
  product_id: "product-1",
  quantity: "1",
  selling_price: "80.60",
  discount: "",
  bonus: "",
  ...overrides,
});

const calculate = (lines: SaleDraftLine[], options: Partial<Parameters<typeof validateSaleDraft>[0]> = {}) => validateSaleDraft({
  lines,
  invoiceDiscount: "",
  invoiceDiscountType: "flat",
  taxRate: "",
  paymentType: "cash",
  cashReceived: "",
  validateCash: true,
  ...options,
});

let draft = draftLine({ quantity: "" });
let result = calculate([draft]);
assert.equal(result.valid, false, "Cleared quantity remains an invalid editable draft");
assert.equal(result.amounts, undefined, "Incomplete quantity does not become a zero-total sale");
assert.match(result.issues.find(issue => issue.field === "quantity")?.message ?? "", /quantity/i);
assert.equal(draft.quantity, "", "Validation never rewrites the typed value");

draft = { ...draft, quantity: "0.125" };
result = calculate([draft]);
assert.equal(result.valid, true);
assert.equal(result.amounts?.total, 10.08, "0.125 × 80.60 retains SQL numeric rounding parity");
assert.equal(result.lineTotals[0], 10.08);
assert.equal(draft.quantity, "0.125");

draft = { ...draft, quantity: "0.1251" };
result = calculate([draft]);
assert.equal(result.valid, false, "Unsupported quantity precision is reported while editing");
assert.equal(result.amounts, undefined);
assert.equal(draft.quantity, "0.1251", "Unsupported precision remains visible so the user can correct it");
draft = { ...draft, quantity: "0.125" };
assert.equal(calculate([draft]).valid, true, "Correcting excess precision restores a valid total");

draft = { ...draft, selling_price: "" };
result = calculate([draft]);
assert.equal(result.valid, false);
assert.equal(result.amounts, undefined);
assert.equal(result.issues.some(issue => issue.field === "selling_price"), true);
assert.equal(draft.selling_price, "", "A cleared price remains cleared in draft state");
draft = { ...draft, selling_price: "80.60" };
result = calculate([draft], { cashReceived: "" });
assert.equal(result.valid, true, "An empty cash field uses the displayed exact-total default");
assert.equal(result.cashSummary?.change, 0);
result = calculate([draft], { cashReceived: "10.001" });
assert.equal(result.valid, false, "Cash precision is validated without throwing");
assert.equal(result.issues.some(issue => issue.field === "cash_received"), true);
result = calculate([draft], { cashReceived: "11.00" });
assert.equal(result.valid, true);
assert.equal(result.cashSummary?.change, 0.92);

draft = { ...draft, discount: "80.61" };
result = calculate([draft]);
assert.equal(result.valid, false, "A line discount above the subtotal is shown as an editable error");
assert.equal(result.amounts, undefined);
assert.equal(result.issues.some(issue => issue.field === "discount"), true);
assert.equal(draft.discount, "80.61");
draft = { ...draft, discount: "0" };
assert.equal(calculate([draft]).valid, true, "Correcting the excessive line discount restores totals");

const lines = [draftLine({ selling_price: "40.00" }), draftLine({ product_id: "product-2", selling_price: "60.00" })];
const invoiceDiscount = "90.00";
result = calculate(lines, { invoiceDiscount });
assert.equal(result.valid, true);
const afterRemovingItem = lines.slice(0, 1);
result = calculate(afterRemovingItem, { invoiceDiscount });
assert.equal(result.valid, false, "Removing a line revalidates the still-entered invoice discount");
assert.equal(result.issues.some(issue => issue.field === "invoice_discount"), true);
assert.equal(invoiceDiscount, "90.00", "Removing a product does not silently rewrite the user's discount");
assert.equal(afterRemovingItem.length, 1, "The basket mutation is applied while discount text is preserved");

const restoredHeldLine = draftLine({ quantity: "", selling_price: "80.601" });
assert.doesNotThrow(() => calculate([restoredHeldLine]), "Invalid held drafts can be searched and rendered safely");

console.log("Sale draft interaction logic passed: quantity, precision correction, price, cash, discounts, and line removal.");
