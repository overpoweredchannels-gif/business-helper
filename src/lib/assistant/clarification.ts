import type {
  PendingClarification,
  ClarificationCandidate,
  AssistantResponse,
  MemorySnapshot,
} from "./types";

/**
 * Clarification engine. When an entity name is ambiguous (e.g. two
 * employees named "Ali"), the assistant pauses the flow, lists numbered
 * candidates and accepts either the number or the exact name as the
 * answer. Non-entity clarifications (e.g. quantity) are also supported.
 */
export class ClarificationEngine {
  resolveAnswer(
    clarification: PendingClarification,
    rawAnswer: string,
    memory: MemorySnapshot
  ): { value: unknown; key: string } | null {
    const trimmed = rawAnswer.trim();
    const numberMatch = trimmed.match(/^(\d+)\s*$/);
    if (numberMatch) {
      const index = Number(numberMatch[1]) - 1;
      const candidate = clarification.candidates[index];
      if (candidate) {
        return { value: candidate.key, key: candidate.key };
      }
      return null;
    }

    const exact = clarification.candidates.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (exact) return { value: exact.key, key: exact.key };

    const partial = clarification.candidates.find(
      (c) => c.name.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(c.name.toLowerCase())
    );
    if (partial) return { value: partial.key, key: partial.key };

    return null;
  }

  formatQuestion(clarification: PendingClarification): string {
    if (clarification.kind === "quantity") {
      return clarification.question;
    }
    const list = clarification.candidates
      .map((c, i) => `${i + 1}. ${c.name}${c.detail ? ` (${c.detail})` : ""}`)
      .join("\n");
    return `${clarification.question}\n${list}\n\nReply with the number or the exact name.`;
  }
}

export function buildClarificationResponse(
  clarification: PendingClarification,
  memory: MemorySnapshot
): AssistantResponse {
  const engine = new ClarificationEngine();
  return {
    text: engine.formatQuestion(clarification),
    module: "clarification",
    intent: null,
    state: "clarifying",
    workflowId: null,
    performed: null,
    revertedAction: null,
    clarification,
    memory,
  };
}

export type { ClarificationCandidate };
