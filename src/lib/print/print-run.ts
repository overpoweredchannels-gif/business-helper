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
 * Await one stage of a print run. Resolves with the stage's value, or
 * PRINT_STAGE_ABORTED as soon as the token is aborted — even if the stage
 * promise never settles. A stage rejection while the run is still live
 * propagates to the caller; a rejection landing after an abort is absorbed
 * (handlers are attached up front, so it can never surface as an
 * unhandled rejection).
 */
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
