import assert from "node:assert/strict";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import { loadReceiptTemplate } from "../src/lib/print/receipt-template-loader";

// The receipt dialog must ALWAYS settle: saved template when the API
// answers, the built-in default otherwise — never an endless
// "Loading receipt template…" (QA regression, 2026-10-23: the old chain
// awaited getSession() + fetch with no timeout anywhere).

async function main(): Promise<void> {
  const defaultTemplate = cloneDefaultTemplate("retail_receipt");

  // 1. Fetch rejects → defaulted (error), with a usable default template.
  {
    const result = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () => Promise.reject(new Error("network down")),
    });
    assert.equal(result.status, "defaulted");
    assert.equal(result.status === "defaulted" && result.reason, "error");
    assert.equal(result.template.docType, "retail_receipt");
    assert.notEqual(result.template, defaultTemplate, "fallback must be a copy, not the shared default object");
  }

  // 2. Fetch answers but the org has no templates at all → defaulted (empty).
  {
    const result = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () => Promise.resolve({ ok: true, templates: [] }),
    });
    assert.equal(result.status, "defaulted");
    assert.equal(result.status === "defaulted" && result.reason, "empty");
  }

  // 3. Fetch answers with a malformed body → defaulted (empty), no throw.
  {
    const result = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () => Promise.resolve(null),
    });
    assert.equal(result.status, "defaulted");
    assert.equal(result.status === "defaulted" && result.reason, "empty");
  }

  // 4. Fetch NEVER settles → the timeout wins: defaulted (timeout), the
  // request is aborted, and the wait is bounded.
  {
    let aborted = false;
    const startedAt = Date.now();
    const result = await loadReceiptTemplate({
      defaultTemplate,
      timeoutMs: 50,
      fetchJson: (signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => { aborted = true; });
        }),
    });
    const elapsed = Date.now() - startedAt;
    assert.equal(result.status, "defaulted");
    assert.equal(result.status === "defaulted" && result.reason, "timeout");
    assert.equal(aborted, true, "a timed-out load must abort the underlying fetch");
    assert.ok(elapsed < 5000, `hanging fetch must settle near the timeout, took ${elapsed}ms`);
  }

  // 5. Saved default template → loaded, with its paper width honoured.
  {
    const saved = { ...cloneDefaultTemplate("retail_receipt"), name: "Counter receipt", receiptWidthMm: 58 as const };
    const result = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () => Promise.resolve({ ok: true, templates: [{ id: "builtin", is_default: false }, { id: "saved", is_default: true, config: saved }] }),
    });
    assert.equal(result.status, "loaded");
    assert.equal(result.template.name, "Counter receipt");
    assert.equal(result.template.receiptWidthMm, 58, "a stored 58 must stay 58");
  }

  // 6. Saved width in string form normalizes; a garbage width falls back to 80.
  {
    const savedString = { ...cloneDefaultTemplate("retail_receipt"), receiptWidthMm: "58" as unknown as 58 };
    const fromString = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () => Promise.resolve({ templates: [{ is_default: true, config: savedString }] }),
    });
    assert.equal(fromString.status, "loaded");
    assert.equal(fromString.template.receiptWidthMm, 58);

    const savedGarbage = { ...cloneDefaultTemplate("retail_receipt"), receiptWidthMm: 999 as unknown as 58 };
    const fromGarbage = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () => Promise.resolve({ templates: [{ is_default: true, config: savedGarbage }] }),
    });
    assert.equal(fromGarbage.status, "loaded");
    assert.equal(fromGarbage.template.receiptWidthMm, 80);
  }

  // 7. The fetch ANSWERS with a backend failure body (what response.json()
  // yields when the templates/settings backend errors — production
  // 2026-10-23 served a 42703 there) → the load still settles, with the
  // built-in default: the dialog must never depend on a successful
  // settings/templates load to become usable.
  {
    const result = await loadReceiptTemplate({
      defaultTemplate,
      fetchJson: () =>
        Promise.resolve({
          ok: false,
          error: 'column organizations.regional_preferences does not exist',
          code: '42703',
        }),
    });
    assert.equal(result.status, "defaulted");
    assert.equal(result.status === "defaulted" && result.reason, "empty");
    assert.equal(result.template.docType, "retail_receipt", "the default template keeps the dialog usable");
    assert.equal(result.template.receiptWidthMm, 80, "the default template carries the default width");
  }

  console.log("test-pos-receipt-template-loader: all assertions passed");
}

void main();
