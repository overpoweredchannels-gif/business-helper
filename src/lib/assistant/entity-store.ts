import { MemoryStore, MemoryWriter } from "../brain";
import { PreferenceStore } from "../brain/learning/preference-store";
import type { MemoryWriterRawData } from "../brain/contracts/memory";
import type { EntityRef, ClarificationCandidate } from "./types";

export interface EntityMatch {
  ref: EntityRef;
  score: number;
  detail: string;
}

/**
 * Entity store for the assistant. Reuses the Business Brain's memory
 * architecture (MemoryStore + MemoryWriter — read-only reuse, no
 * modification) to index products, customers, suppliers and staff, and
 * resolves names with ambiguity detection for the Clarification Engine.
 */
export class AssistantEntityStore {
  private _store: MemoryStore;

  get store(): MemoryStore {
    return this._store;
  }

  constructor(data: MemoryWriterRawData) {
    this._store = new MemoryStore();
    const writer = new MemoryWriter(this._store, new PreferenceStore());
    writer.writeRaw(data);
  }

  /**
   * Rebuilds the in-memory index from updated raw data (used by the
   * customer CRUD flow so newly added/updated customers are searchable).
   */
  refresh(data: MemoryWriterRawData): void {
    const fresh = new MemoryStore();
    const writer = new MemoryWriter(fresh, new PreferenceStore());
    writer.writeRaw(data);
    this._store = fresh;
  }

  getOrganizationId(): string {
    return this.store.meta.organizationId;
  }

  getBusinessSummary(): string {
    return this.store.getBusinessSummary();
  }

  getConversationContext(count: number): Array<{ role: string; text: string }> {
    return this.store.getConversationContext(count);
  }

  // ─── Product resolution ─────────────────────────────────────────────────────

  searchProducts(name: string, limit = 5): EntityMatch[] {
    const results = this.store.searchProducts(name, 0.2, limit);
    return results.map((r) => ({
      ref: { id: r.item.id, name: r.item.name },
      score: r.score,
      detail: `stock ${r.item.currentStock}`,
    }));
  }

  resolveProduct(name: string): { resolved: EntityRef | null; candidates: ClarificationCandidate[] } {
    const exact = this.store.findExactProduct(name);
    if (exact) return { resolved: { id: exact.id, name: exact.name }, candidates: [] };
    for (const p of this.store.products.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        return { resolved: { id: p.id, name: p.name }, candidates: [] };
      }
    }
    const matches = this.searchProducts(name);
    if (matches.length === 1 && matches[0].score >= 0.5) {
      return { resolved: matches[0].ref, candidates: [] };
    }
    if (matches.length > 1) {
      return {
        resolved: null,
        candidates: matches.map((m) => ({
          key: m.ref.id,
          name: m.ref.name,
          detail: m.detail,
        })),
      };
    }
    return { resolved: null, candidates: [] };
  }

  // ─── Customer resolution ────────────────────────────────────────────────────

  searchCustomers(name: string, limit = 5): EntityMatch[] {
    const results = this.store.searchCustomers(name, 0.2, limit);
    return results.map((r) => ({
      ref: { id: r.item.id, name: r.item.name },
      score: r.score,
      detail: r.item.shopName ? `shop ${r.item.shopName}` : "",
    }));
  }

  resolveCustomer(name: string): { resolved: EntityRef | null; candidates: ClarificationCandidate[] } {
    const exact = this.store.findExactCustomer(name);
    if (exact) return { resolved: { id: exact.id, name: exact.name }, candidates: [] };
    for (const c of this.store.customers.values()) {
      if (c.name.toLowerCase() === name.toLowerCase()) {
        return { resolved: { id: c.id, name: c.name }, candidates: [] };
      }
    }
    const matches = this.searchCustomers(name);
    if (matches.length === 1 && matches[0].score >= 0.5) {
      return { resolved: matches[0].ref, candidates: [] };
    }
    if (matches.length > 1) {
      return {
        resolved: null,
        candidates: matches.map((m) => ({
          key: m.ref.id,
          name: m.ref.name,
          detail: m.detail,
        })),
      };
    }
    return { resolved: null, candidates: [] };
  }

  // ─── Supplier resolution ────────────────────────────────────────────────────

  searchSuppliers(name: string, limit = 5): EntityMatch[] {
    const results = this.store.searchSuppliers(name, 0.2, limit);
    return results.map((r) => ({
      ref: { id: r.item.id, name: r.item.name },
      score: r.score,
      detail: r.item.phone ? `phone ${r.item.phone}` : "",
    }));
  }

  resolveSupplier(name: string): { resolved: EntityRef | null; candidates: ClarificationCandidate[] } {
    const exact = this.store.findExactSupplier(name);
    if (exact) return { resolved: { id: exact.id, name: exact.name }, candidates: [] };
    for (const s of this.store.suppliers.values()) {
      if (s.name.toLowerCase() === name.toLowerCase()) {
        return { resolved: { id: s.id, name: s.name }, candidates: [] };
      }
    }
    const matches = this.searchSuppliers(name);
    if (matches.length === 1 && matches[0].score >= 0.5) {
      return { resolved: matches[0].ref, candidates: [] };
    }
    if (matches.length > 1) {
      return {
        resolved: null,
        candidates: matches.map((m) => ({
          key: m.ref.id,
          name: m.ref.name,
          detail: m.detail,
        })),
      };
    }
    return { resolved: null, candidates: [] };
  }

  // ─── Employee resolution ────────────────────────────────────────────────────

  searchStaff(name: string, limit = 5): EntityMatch[] {
    const results = this.store.searchStaff(name, 0.2, limit);
    return results.map((r) => ({
      ref: { id: r.item.id, name: r.item.name },
      score: r.score,
      detail: r.item.role ? `role ${r.item.role}` : "",
    }));
  }

  resolveEmployee(name: string): { resolved: EntityRef | null; candidates: ClarificationCandidate[] } {
    const results = this.store.searchStaff(name, 0.35, 10);
    const exactMatches = results.filter((r) => r.item.name.toLowerCase() === name.toLowerCase());
    if (exactMatches.length === 1) {
      return { resolved: { id: exactMatches[0].item.id, name: exactMatches[0].item.name }, candidates: [] };
    }
    for (const s of this.store.staff.values()) {
      if (s.name.toLowerCase() === name.toLowerCase()) {
        return { resolved: { id: s.id, name: s.name }, candidates: [] };
      }
    }
    if (results.length === 1 && results[0].score >= 0.5) {
      return { resolved: { id: results[0].item.id, name: results[0].item.name }, candidates: [] };
    }
    if (results.length > 1) {
      return {
        resolved: null,
        candidates: results.map((r) => ({
          key: r.item.id,
          name: r.item.name,
          detail: r.item.role ? `role ${r.item.role}` : "",
        })),
      };
    }
    return { resolved: null, candidates: [] };
  }
}
