import assert from "node:assert/strict";
import { awaitPrintStage, PRINT_STAGE_ABORTED, PrintRunController, PrintRunUiLock } from "../src/lib/print/print-run";

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

  // 5. The UI state is released at DISPATCH, not at cleanup: a run
  //    whose post-dispatch tail never resolves (its cleanup simply
  //    never runs) still frees the UI the moment its native print is
  //    dispatched — and a second run can begin while that tail is
  //    still pending. Regression (2026-10-23): live QA showed the
  //    dialog sitting on "Preparing receipt…" for minutes when the
  //    environment stretched the afterprint/fallback tail, even
  //    though every stage was bounded.
  const controller5 = new PrintRunController();
  const uiLock = new PrintRunUiLock();
  const runA = controller5.begin();
  uiLock.acquire(runA);
  assert.equal(uiLock.isHeld(), true, "a preparing run holds the UI state");
  // The staged pipeline dispatches targetWindow.print() here; from this
  // instant the component releases the UI state, while the cleanup tail
  // (afterprint / 1500ms fallback / watchdog) is parked and — in this
  // scenario — never fires.
  uiLock.release(runA);
  assert.equal(uiLock.isHeld(), false, "dispatch releases the UI state even though the tail never resolves");
  const runB = controller5.begin(); // supersedes runA while its tail is pending
  uiLock.acquire(runB);
  assert.equal(uiLock.isHeld(), true, "a second run begins while the first run's tail is pending");

  // 6. The stale run's late cleanup must not release the live run's
  //    state: when runA's tail finally fires, its release call names a
  //    token that no longer owns the lock.
  uiLock.release(runA);
  assert.equal(uiLock.isHeld(), true, "a superseded run's late cleanup leaves the live run's UI state held");
  uiLock.release(runB);
  assert.equal(uiLock.isHeld(), false, "the owning run's release clears the UI state");

  // 7. Dismissal force-releases regardless of owner (the dialog's
  //    Close path: abortCurrent + releaseAll), so an aborted run can
  //    never strand the UI state.
  const runC = controller5.begin();
  uiLock.acquire(runC);
  controller5.abortCurrent();
  uiLock.releaseAll();
  assert.equal(uiLock.isHeld(), false, "dismissal force-releases the UI state");

  console.log("test-pos-receipt-print-run: all assertions passed");
}

void main();
