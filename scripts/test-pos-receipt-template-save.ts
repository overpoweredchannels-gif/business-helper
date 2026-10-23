import assert from "node:assert/strict";
import { cloneDefaultTemplate } from "../src/lib/print/default-templates";
import {
  RECEIPT_TEMPLATE_SAVE_TIMEOUT_MS,
  saveReceiptTemplate,
} from "../src/lib/print/receipt-template-save";

// The paper-width save must ALWAYS settle: the width select is disabled
// while savingWidth is true, so a stalled POST (authorizedFetch has no
// default timeout) used to disable it forever (code review, 2026-10-23).

async function main(): Promise<void> {
  // 0. The default bound matches the template loader's 8s bound.
  assert.equal(RECEIPT_TEMPLATE_SAVE_TIMEOUT_MS, 8000);

  // 1. POST rejects → failed (error), no throw.
  {
    const result = await saveReceiptTemplate({
      post: () => Promise.reject(new Error("network down")),
    });
    assert.deepEqual(result, { status: "failed", reason: "error" });
  }

  // 2. POST NEVER settles → the timeout wins: failed (timeout), the
  // request is aborted, and the wait is bounded.
  {
    let aborted = false;
    const startedAt = Date.now();
    const result = await saveReceiptTemplate({
      timeoutMs: 50,
      post: (signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => { aborted = true; });
        }),
    });
    const elapsed = Date.now() - startedAt;
    assert.deepEqual(result, { status: "failed", reason: "timeout" });
    assert.equal(aborted, true, "a timed-out save must abort the underlying fetch");
    assert.ok(elapsed < 5000, `hanging save must settle near the timeout, took ${elapsed}ms`);
  }

  // 3. POST answers after the timeout → timeout still wins (the late
  // answer is discarded, so the dialog keeps the restored width).
  {
    const result = await saveReceiptTemplate({
      timeoutMs: 20,
      post: () => new Promise((resolve) => setTimeout(() => resolve(null), 200)),
    });
    assert.deepEqual(result, { status: "failed", reason: "timeout" });
  }

  // 4. POST answers with the saved config → saved, width honoured.
  {
    const saved = { ...cloneDefaultTemplate("retail_receipt"), receiptWidthMm: 58 as const };
    const result = await saveReceiptTemplate({ post: () => Promise.resolve(saved) });
    assert.equal(result.status, "saved");
    assert.equal(result.status === "saved" && result.config?.receiptWidthMm, 58, "a stored 58 must stay 58");
  }

  // 5. POST answers without a config → saved with null (caller keeps its
  // optimistic template), no throw.
  {
    const result = await saveReceiptTemplate({ post: () => Promise.resolve(null) });
    assert.deepEqual(result, { status: "saved", config: null });
  }

  // 6. Saved width in string form normalizes; a garbage width falls back to 80.
  {
    const savedString = { ...cloneDefaultTemplate("retail_receipt"), receiptWidthMm: "58" as unknown as 58 };
    const fromString = await saveReceiptTemplate({ post: () => Promise.resolve(savedString) });
    assert.equal(fromString.status, "saved");
    assert.equal(fromString.status === "saved" && fromString.config?.receiptWidthMm, 58);

    const savedGarbage = { ...cloneDefaultTemplate("retail_receipt"), receiptWidthMm: 999 as unknown as 58 };
    const fromGarbage = await saveReceiptTemplate({ post: () => Promise.resolve(savedGarbage) });
    assert.equal(fromGarbage.status, "saved");
    assert.equal(fromGarbage.status === "saved" && fromGarbage.config?.receiptWidthMm, 80);
  }

  console.log("test-pos-receipt-template-save: all assertions passed");
}

void main();
