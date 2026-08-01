import { voiceEvents } from "../telemetry";
import { DialogueRuntimeEventNames as Emit } from "../events";

export interface TurnRecord {
  turnId: string;
  sequence: number;
  startedAt: number;
  endedAt: number | null;
  status: "in_progress" | "completed" | "interrupted" | "timed_out" | "recovered";
  attempts: number;
  lastError: string | null;
}

export interface ClarificationRecord {
  field: string;
  question: string;
  answered: boolean;
  value: string | null;
}

export interface ConfirmationRecord {
  summary: string;
  answered: boolean;
  confirmed: boolean | null;
}

export interface DialogueRuntimeOptions {
  turnTimeoutMs?: number;
}

export type TurnWork<T> = (turn: TurnRecord) => Promise<T>;

/**
 * Dialogue runtime: turn lifecycle (start/end/timeout), interruptions,
 * clarification and confirmation flows, and failure recovery. Contains no
 * business logic — it coordinates turns and emits dialogue.* events.
 */
export class DialogueRuntime {
  private turns: TurnRecord[] = [];
  private sequence = 0;
  private currentTurnId: string | null = null;
  private interrupted = false;
  private clarifications = new Map<string, ClarificationRecord>();
  private confirmations = new Map<string, ConfirmationRecord>();
  private turnTimeoutMs: number;

  constructor(options: DialogueRuntimeOptions = {}) {
    this.turnTimeoutMs = options.turnTimeoutMs ?? 30000;
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  getTurns(): readonly TurnRecord[] {
    return this.turns;
  }

  getTurn(turnId: string): TurnRecord | undefined {
    return this.turns.find((t) => t.turnId === turnId);
  }

  async startTurn(): Promise<TurnRecord> {
    this.sequence++;
    const turn: TurnRecord = {
      turnId: `turn_${Date.now()}_${this.sequence}`,
      sequence: this.sequence,
      startedAt: Date.now(),
      endedAt: null,
      status: "in_progress",
      attempts: 1,
      lastError: null,
    };
    this.turns.push(turn);
    this.currentTurnId = turn.turnId;
    this.interrupted = false;
    voiceEvents.emit("dialogue", Emit.TURN_STARTED, { turnId: turn.turnId, sequence: turn.sequence });
    return turn;
  }

  async endTurn(turnId?: string): Promise<void> {
    const turn = this.resolveTurn(turnId);
    if (turn.status === "completed" || turn.status === "interrupted" || turn.status === "timed_out") {
      return;
    }
    turn.endedAt = Date.now();
    turn.status = this.interrupted ? "interrupted" : "completed";
    if (this.currentTurnId === turn.turnId) {
      this.currentTurnId = null;
    }
    voiceEvents.emit("dialogue", Emit.TURN_ENDED, {
      turnId: turn.turnId,
      durationMs: turn.endedAt - turn.startedAt,
    });
  }

  async interrupt(turnId?: string): Promise<void> {
    const turn = this.resolveTurn(turnId);
    turn.status = "interrupted";
    turn.endedAt = Date.now();
    this.interrupted = true;
    if (this.currentTurnId === turn.turnId) {
      this.currentTurnId = null;
    }
    voiceEvents.emit("dialogue", Emit.INTERRUPTED, { turnId: turn.turnId });
  }

  isInterrupted(): boolean {
    return this.interrupted;
  }

  /**
   * Executes a unit of work with interruption + timeout + recovery.
   * On failure, retries up to maxAttempts emitting recovery events.
   */
  async runTurn<T>(work: TurnWork<T>, options: { maxAttempts?: number; timeoutMs?: number } = {}): Promise<T> {
    const interruptedBefore = this.interrupted;
    const turn = await this.startTurn();
    const timeoutMs = options.timeoutMs ?? this.turnTimeoutMs;
    const maxAttempts = options.maxAttempts ?? 1;
    let attempts = 0;
    let lastError: unknown = null;

    while (attempts < maxAttempts) {
      if (this.interrupted || interruptedBefore) {
        await this.interrupt(turn.turnId);
        throw new Error(`Turn interrupted: ${turn.turnId}`);
      }
      attempts++;
      turn.attempts = attempts;
      if (attempts > 1) {
        voiceEvents.emit("dialogue", Emit.RECOVERY_ATTEMPTED, {
          turnId: turn.turnId,
          attempt: attempts,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
      }
      const timedOut = await this.withTimeout(work(turn), timeoutMs);
      if (timedOut.kind === "timeout") {
        turn.status = "timed_out";
        turn.endedAt = Date.now();
        this.currentTurnId = null;
        voiceEvents.emit("dialogue", Emit.TURN_TIMEOUT, { turnId: turn.turnId, timeoutMs });
        throw new Error(`Turn timed out after ${timeoutMs}ms: ${turn.turnId}`);
      }
      try {
        const value = await timedOut.value;
        if (attempts > 1) {
          voiceEvents.emit("dialogue", Emit.RECOVERY_COMPLETED, { turnId: turn.turnId, attempts });
          turn.status = "recovered";
        }
        await this.endTurn(turn.turnId);
        return value;
      } catch (err) {
        lastError = err;
        turn.lastError = err instanceof Error ? err.message : String(err);
      }
    }
    turn.endedAt = Date.now();
    turn.status = "interrupted";
    this.currentTurnId = null;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async requestClarification(field: string, question: string): Promise<void> {
    const turnId = this.currentTurnId ?? this.sequence.toString();
    this.clarifications.set(field, { field, question, answered: false, value: null });
    voiceEvents.emit("dialogue", Emit.CLARIFICATION_REQUESTED, { turnId, field, question });
  }

  async answerClarification(field: string, value: string): Promise<boolean> {
    const turnId = this.currentTurnId ?? this.sequence.toString();
    const record = this.clarifications.get(field);
    if (!record) {
      return false;
    }
    record.answered = true;
    record.value = value;
    voiceEvents.emit("dialogue", Emit.CLARIFICATION_ANSWERED, { turnId, field, value });
    return true;
  }

  hasPendingClarification(field: string): boolean {
    return this.clarifications.get(field)?.answered === false;
  }

  async requestConfirmation(summary: string): Promise<void> {
    const turnId = this.currentTurnId ?? this.sequence.toString();
    this.confirmations.set(summary, { summary, answered: false, confirmed: null });
    voiceEvents.emit("dialogue", Emit.CONFIRMATION_REQUESTED, { turnId, summary });
  }

  async answerConfirmation(summary: string, confirmed: boolean): Promise<boolean> {
    const turnId = this.currentTurnId ?? this.sequence.toString();
    const record = this.confirmations.get(summary);
    if (!record) {
      return false;
    }
    record.answered = true;
    record.confirmed = confirmed;
    voiceEvents.emit("dialogue", Emit.CONFIRMATION_ANSWERED, { turnId, confirmed });
    return true;
  }

  hasPendingConfirmation(summary: string): boolean {
    return this.confirmations.get(summary)?.answered === false;
  }

  private resolveTurn(turnId?: string): TurnRecord {
    const id = turnId ?? this.currentTurnId;
    if (!id) {
      throw new Error("No active turn.");
    }
    const turn = this.getTurn(id);
    if (!turn) {
      throw new Error(`Turn not found: ${id}`);
    }
    return turn;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<{ kind: "value"; value: Promise<T> } | { kind: "timeout" }> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const result = await Promise.race([
      promise.then(() => "value" as const, () => "error" as const),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (result === "timeout") {
      return { kind: "timeout" };
    }
    return { kind: "value", value: promise };
  }
}
