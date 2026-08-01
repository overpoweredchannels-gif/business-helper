import type { AssistantSession, ResolvedEntities, EntityRef, UnifiedAssistantOptions } from "./types";
import type { UnifiedConversationMemory } from "./memory";

/**
 * Cross-module reference resolver. Handles pronouns and carry-over phrases
 * ("it", "same customer", "wahi", "increase it to 15") by resolving against
 * the unified conversation memory across modules — a sale workflow can refer
 * to the customer of a previous purchase workflow, and vice versa.
 */
export class ReferenceResolver {
  constructor(
    private readonly memory: UnifiedConversationMemory,
    private readonly options: UnifiedAssistantOptions
  ) {}

  /**
   * Applies references on top of the raw extracted entities.
   * Returns the resolved entities plus any direct entity-carry-over text.
   */
  resolve(
    session: AssistantSession,
    normalized: string,
    entities: ResolvedEntities
  ): ResolvedEntities {
    const resolved: ResolvedEntities = { ...entities };

    const usesSameCustomer = /(\bsame customer\b|\bwahi customer\b|\buska\b|\bits? customer\b|\bsame person\b)/i.test(normalized);
    const usesSameSupplier = /(\bsame supplier\b|\bwahi supplier\b|\busi supplier\b)/i.test(normalized);
    const usesSameProduct = /(\bsame product\b|\bwahi product\b|\bwahi cheez\b|\bsame item\b|\bsame cheez\b)/i.test(normalized);
    const usesSameEmployee = /(\bsame employee\b|\bwahi karmi\b|\bwahi employee\b|\bsame staff\b)/i.test(normalized);

    if (usesSameCustomer && !resolved.customer) {
      const last = this.memory.getReference(session, "lastCustomer");
      if (last) resolved.customer = last;
    }
    if (usesSameSupplier && !resolved.supplier) {
      const last = this.memory.getReference(session, "lastSupplier");
      if (last) resolved.supplier = last;
    }
    if (usesSameProduct && !resolved.product) {
      const last = this.memory.getReference(session, "lastProduct");
      if (last) resolved.product = last;
    }
    if (usesSameEmployee && !resolved.employee) {
      const last = this.memory.getReference(session, "lastEmployee");
      if (last) resolved.employee = last;
    }

    const increaseMatch = normalized.match(/(increase|raise|increase it|barhao|zyada karo|badhao)\s*(?:it\s*)?to\s*(\d+)/i);
    if (increaseMatch) {
      resolved.quantity = Number(increaseMatch[2]);
    }

    const decreaseMatch = normalized.match(/(decrease|reduce|kam karo|ghatao)\s*(?:it\s*)?to\s*(\d+)/i);
    if (decreaseMatch) {
      resolved.quantity = Number(decreaseMatch[2]);
    }

    if (!resolved.quantity && /\b(another|ek aur|same)\b/i.test(normalized)) {
      const lastSale = this.memory.getObject(session, "lastSale") as { quantity?: number } | null;
      if (lastSale && typeof lastSale.quantity === "number") {
        resolved.quantity = lastSale.quantity;
      }
    }

    return resolved;
  }

  /**
   * Resolves a bare quantity token ("15") into a quantity when the context
   * is clearly an adjustment of the last sale (e.g. after "increase it to").
   */
  isQuantityAdjustment(normalized: string, hasActiveWorkflow: boolean): boolean {
    if (hasActiveWorkflow) return false;
    return /(increase|decrease|reduce|raise|barhao|kam karo|ghatao|badhao)/i.test(normalized);
  }
}

export function refsEqual(a: EntityRef | null, b: EntityRef | null): boolean {
  return a !== null && b !== null && a.id === b.id;
}
