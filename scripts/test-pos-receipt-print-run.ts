import assert from "node:assert/strict";
import { awaitPrintStage, PRINT_STAGE_ABORTED, PrintRunController } from "../src/lib/print/print-run";

// Regression (2026-10-23): the receipt dialog's Close could not rescue a
// print run parked in a staged wait — the pipeline only unwound when a
// (possibly throttled) timer fired, 70–90s later. The print-run token is
// the seam that fixes it: dismiss aborts the token, and every staged
// continuation becomes a no-op from that instant.

async function main() {
  // 1. A stage that NEVER resolves is unwound by abort, and no later
  //    stage of the pipeline runs.
  const controller = new PrintRunController();
  const token = controller.begin();
  let laterStageRan = false;
  const pipeline = (async () => {
    const first = await awaitPrintStage(token, new Promise<never>(() => {}));
    if (first === PRINT_STAGE_ABORTED) return "aborted";
    laterStageRan = true;
    return "completed";
  })();
  controller.abortCurrent(); // == dismissReceipt() during the print
  assert.equal(await pipeline, "aborted", "aborted run unwinds immediately, without waiting for the parked stage");
  assert.equal(laterStageRan, false, "no continuation runs after an abort");
  assert.ok(token.isAborted(), "the dismissed run's token stays aborted");

  // 2. A stage rejection landing AFTER the abort is absorbed — the
  //    pipeline still reports the abort, and the rejection must not
  //    surface as an unhandled rejection (which would fail this run).
  const controller2 = new PrintRunController();
  const token2 = controller2.begin();
  let rejectStage!: (error: Error) => void;
  const hangingStage = new Promise<never>((_, reject) => { rejectStage = reject; });
  const pipeline2 = (async () => {
    const result = await awaitPrintStage(token2, hangingStage);
    return result === PRINT_STAGE_ABORTED ? "aborted" : "completed";
  })();
  controller2.abortCurrent();
  assert.equal(await pipeline2, "aborted");
  rejectStage(new Error("late stage failure"));
  await new Promise((resolve) => setTimeout(resolve, 25));

  // 3. Beginning a new run supersedes (aborts) the previous one, so a
  //    manual Print after a dismissed auto-print starts from a live
  //    token while the old run stays dead.
  const controller3 = new PrintRunController();
  const first = controller3.begin();
  const second = controller3.begin();
  assert.ok(first.isAborted(), "begin() aborts the previous run");
  assert.ok(!second.isAborted(), "the new run is live");
  assert.equal(
    await awaitPrintStage(first, Promise.resolve("stale")),
    PRINT_STAGE_ABORTED,
    "an already-aborted token short-circuits even a resolved stage",
  );

  // 4. While a run is live, stage values pass through and stage errors
  //    propagate to the caller (the dialog's error path depends on it).
  assert.equal(await awaitPrintStage(second, Promise.resolve(42)), 42, "live stage value passes through");
  await assert.rejects(
    awaitPrintStage(second, Promise.reject(new Error("stage boom"))),
    /stage boom/,
    "live stage rejection propagates",
  );

  console.log("test-pos-receipt-print-run: all assertions passed");
}

void main();
