import assert from "node:assert/strict";
import { activeSuggestionIndex } from "../src/components/invoices/search-selection";

const customers = [{ id: "unassigned" }, { id: "assigned" }];
assert.equal(customers[activeSuggestionIndex(customers, "assigned", null)].id, "assigned",
  "Reopening a chosen customer and pressing Enter must preserve that customer");
assert.equal(activeSuggestionIndex(customers, "assigned", 0), 0, "Explicit keyboard movement can change selection");
assert.equal(activeSuggestionIndex(customers, "", null), 0, "New searches start at the first match");
assert.equal(activeSuggestionIndex([], "", -1), 0, "ArrowUp with no matches must not leave a negative index");
assert.equal(activeSuggestionIndex(customers.slice(0, 1), "", 5), 0, "Changing matches clamps the highlight");
assert.equal(activeSuggestionIndex([...customers].reverse(), "assigned", null), 0, "Selection follows record ID after reordering");
console.log("Search selection: selected record retained, explicit navigation supported, empty and changed results handled.");
