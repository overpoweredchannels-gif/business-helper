// TradeOS — print-run cancellation seam.
//
// A receipt print is a staged pipeline (frame load → fonts → layout →
// native print). If the user dismisses the dialog mid-flight, every later
// continuation of that pipeline must become a no-op IMMEDIATELY — even a
// stage whose promise never resolves (a throttled timer, a blocked
// native print call) must not resurrect the run when it finally settles.
//
// PrintRunController hands out one token per run. Beginning a new run
// aborts the previous one; abortCurrent() is what dialog dismissal calls
// before it force-releases the print state synchronously. awaitPrintStage
// races a stage promise against the token's abort signal, so an aborted
// pipeline unwinds at once instead of whenever the stage happens to end.

export const PRINT_STAGE_ABORTED: unique symbol = Symbol("PRINT_STAGE_ABORTED");
export type PrintStageResult<T> = T | typeof PRINT_STAGE_ABORTED;

/**
 * Temporary diagnostic instrumentation (2026-10-24): the ordered stage
 * names the receipt dialog reports when the page URL carries
 * ?receiptdebug=1. The auto-print pipeline has parked somewhere in a
 * real browser across several black-box rounds; these checkpoints make
 * the pipeline say where. Purely observational — a stage callback is a
 * cheap synchronous state write and never alters ordering or timing.
 */
export const RECEIPT_DEBUG_STAGES = [
  "dialog-open",
  "template-loading",
  "template-ready",
  "print-entered",
  "iframe-created",
  "iframe-load-fired",
  "fonts-wait",
  "fonts-done",
  "layout-wait",
  "layout-done",
  "fallback-cleared",
  "dispatch-enter",
  "dispatch-released",
  "dispatch-yielded",
  "print-called",
  "print-returned",
  "cleanup",
  "fallback30-armed",
  "fallback30-fired",
  "watchdog45-armed",
  "watchdog45-fired",
] as const;
export type ReceiptDebugStage = (typeof RECEIPT_DEBUG_STAGES)[number];

export class PrintRunToken {
  readonly id: number;
  /** Resolves the moment this run is aborted. Never rejects. */
  readonly abortedSignal: Promise<void>;
  private resolveAborted!: () => void;
  private abortedFlag = false;

  constructor(id: number) {
    this.id = id;
    this.abortedSignal = new Promise<void>((resolve) => {
      this.resolveAborted = resolve;
    });
  }

  abort(): void {
    if (this.abortedFlag) return;
    this.abortedFlag = true;
    this.resolveAborted();
  }

  isAborted(): boolean {
    return this.abortedFlag;
  }
}

export class PrintRunController {
  private nextId = 0;
  private current: PrintRunToken | null = null;

  /** Start a new run, aborting whichever run was active before it. */
  begin(): PrintRunToken {
    this.current?.abort();
    const token = new PrintRunToken(++this.nextId);
    this.current = token;
    return token;
  }

  /** Abort the active run (dialog dismissed). Safe when no run is active. */
  abortCurrent(): void {
    this.current?.abort();
  }
}

/**
 * The dialog's "Preparing receipt…" UI state, owned by one print run.
 *
 * The state (Print button disabled + label, plus the guard that keeps a
 * second run from starting) belongs to the PRE-print pipeline only:
 * frame load → fonts → layout → dispatch. The moment a run dispatches
 * its native print dialog, the user's interaction is with the OS
 * dialog, while the post-dispatch tail — afterprint listener, fallback
 * timer, watchdog — may be stretched arbitrarily by a throttled
 * browser. Holding the UI state until that tail finishes makes the
 * dialog look frozen even though every stage is bounded, so the owner
 * releases the state AT DISPATCH and the tail finishes in the
 * background, still owning the frame and timers.
 *
 * Ownership is what makes the early release safe: a superseded or
 * dismissed run's late cleanup calls release(itsToken), finds it no
 * longer owns the state, and cannot clear the state of the run that
 * replaced it. Dismissal force-releases via releaseAll() after
 * aborting the active run.
 */
export class PrintRunUiLock {
  private owner: PrintRunToken | null = null;
  private held = false;

  /** True while a run holds the UI state (preparing, or never dispatched). */
  isHeld(): boolean {
    return this.held;
  }

  /** Claim the UI state for a freshly begun run. Callers gate on isHeld() first. */
  acquire(token: PrintRunToken): void {
    this.owner = token;
    this.held = true;
  }

  /**
   * Release the UI state if `token` still owns it. A no-op for a
   * superseded or dismissed run, whose late cleanup must not clear
   * the state of the run that replaced it.
   */
  release(token: PrintRunToken): void {
    if (this.owner !== token) return;
    this.held = false;
  }

  /** Force-release regardless of owner (dialog dismissal). */
  releaseAll(): void {
    this.held = false;
  }
}

/**
 * Await one stage of a print run. Resolves with the stage's value, or
 * PRINT_STAGE_ABORTED as soon as the token is aborted — even if the stage
 * promise never settles. A stage rejection while the run is still live
 * propagates to the caller; a rejection landing after an abort is absorbed
 * (handlers are attached up front, so it can never surface as an
 * unhandled rejection).
 */
/**
 * Dispatch the native print dialog for a run.
 *
 * window.print() is a SYNCHRONOUS, main-thread-blocking call for as long
 * as the browser's print UI is up — and every settle guarantee the dialog
 * has (fallback timer, watchdog, Close/Escape handlers) lives on that
 * same main thread. The release of the run's "Preparing receipt…" UI
 * state must therefore be COMMITTED before the native call is entered,
 * never sequenced after it returns: sequenced after, a print call whose
 * return is delayed (an unattended print preview, a slow spooler) leaves
 * the dialog frozen past every bound — Close and Escape cannot even run —
 * and only a page reload clears it (production, 2026-10-23).
 *
 * Merely CALLING the release first is not enough: the release is a React
 * state update, and in the same task React only QUEUES it. Entering
 * target.print() without yielding parks the thread before the queue can
 * flush, so the last committed DOM is still "Preparing receipt…" for as
 * long as the native call blocks. The dispatch therefore yields one
 * macrotask after the release — React commits (and the browser can
 * paint) the settled state — and only then enters the native call. The
 * yield opens a window in which the run can die (dialog dismissed →
 * token aborted), so liveness is re-checked after it: a dead run never
 * opens the native dialog at all. Once entered, the run's cleanup tail
 * (afterprint / fallback) still owns the frame and timers.
 *
 * Resolves true when the native print was entered, false when the run
 * was aborted during the yield. A throwing print() rejects, propagating
 * to the caller's catch path exactly as the synchronous throw did.
 */
export async function dispatchNativePrint(
  target: { print: () => void },
  releaseUiState: () => void,
  token: PrintRunToken,
  onStage?: (stage: ReceiptDebugStage) => void,
): Promise<boolean> {
  onStage?.("dispatch-enter");
  releaseUiState();
  onStage?.("dispatch-released");
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  onStage?.("dispatch-yielded");
  if (token.isAborted()) return false;
  onStage?.("print-called");
  target.print();
  onStage?.("print-returned");
  return true;
}

export async function awaitPrintStage<T>(token: PrintRunToken, stage: Promise<T>): Promise<PrintStageResult<T>> {
  if (token.isAborted()) return PRINT_STAGE_ABORTED;
  const guarded = stage.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const winner = await Promise.race([
    guarded,
    token.abortedSignal.then(() => ({ ok: false as const, aborted: true as const })),
  ]);
  if ("aborted" in winner) return PRINT_STAGE_ABORTED;
  if (token.isAborted()) return PRINT_STAGE_ABORTED;
  if (!winner.ok) throw winner.error;
  return winner.value;
}
