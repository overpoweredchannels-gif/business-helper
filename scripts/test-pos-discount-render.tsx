import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RetailPOS, type CounterSale } from "../src/components/sales/RetailPOS";
import type { Product, Customer } from "../src/lib/tradeos/types";

const sale: CounterSale = {
  customerId: "walk-in",
  date: "2026-09-29",
  paymentType: "cash",
  discount: "10",
  discountType: "percent",
  tax: "",
  lines: [{ product_id: "p1", quantity: "1", selling_price: "80.60", discount: "", unit_mode: "main" }],
};
const products = [{ id: "p1", name: "Test product", unit_type: "Unit", units_per_pack: null }] as unknown as Product[];
const customers = [{ id: "walk-in", customer_name: "Walk-in" }] as Customer[];
const render = (draft: CounterSale, owner: boolean) => renderToStaticMarkup(
  <RetailPOS scope="test" sale={draft} products={products} customers={customers} busy={false} owner={owner}
    scanUnit="main" cashReceived="" focusSignal={0} onScan={() => null} onAdd={() => undefined}
    onUnit={() => undefined} onCustomer={() => undefined} onLine={() => undefined}
    onRemove={() => undefined} onSave={() => undefined} onCashReceived={() => undefined}
    onDiscount={() => undefined} onDiscountType={() => undefined} onAdvanced={() => undefined}
    onRestore={() => undefined} onClear={() => undefined} />,
);

const percent = render(sale, true);
assert.match(percent, /Sale discount percentage/);
assert.match(percent, /option value="percent" selected=""/);
assert.match(percent, /Discount before tax:.*8\.06/);
assert.match(percent, /Total payable.*72\.54/);

const invalid = render({ ...sale, discount: "100.01" }, true);
assert.match(invalid, /Invoice discount percentage cannot exceed 100/);
assert.match(invalid, /Total payable.*Unavailable/);

const employee = render({ ...sale, discount: "", discountType: "flat" }, false);
assert.doesNotMatch(employee, /Sale discount percentage|Sale discount type/);

const restoredEmployee = render(sale, false);
assert.doesNotMatch(restoredEmployee, /Sale discount percentage|Sale discount type/, "employees cannot edit invoice discounts");
assert.match(restoredEmployee, /Invoice discount and tax are not available for this approval flow/, "a restored discounted draft explains why it cannot be submitted");
assert.match(restoredEmployee, /Total payable.*Unavailable/, "a restored discounted draft does not show a misleading total");
assert.match(restoredEmployee, /<button[^>]*disabled=""[^>]*>Send for approval<\/button>/, "an employee cannot submit a restored discounted draft");
console.log("Retail POS discount UI rendering passed: percentage totals, invalid value, employee restrictions, and restored-draft validation.");
