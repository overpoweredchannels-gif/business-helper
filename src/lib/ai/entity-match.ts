import { fuzzySearch, normalizeForSearch } from "../brain/memory/fuzzy-match";
import type { MemoryWriterRawData } from "../brain/contracts/memory";

// Suggestions use score >= 0.3, top 3. Only a single candidate scoring
// >= 0.5 may auto-resolve. Check all plausible candidates before choosing.
export const MATCH_THRESHOLD = 0.3;
export const RESOLVE_THRESHOLD = 0.5;
export const MATCH_LIMIT = 3;
type EntityRow = { id: string | number; is_active?: boolean | null };
const compareCandidates = (a: EntityCandidate, b: EntityCandidate) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
type ProductRow = EntityRow & { name: string; default_selling_price?: number | null; current_stock?: number | null };
type CustomerRow = EntityRow & { customer_name: string; shop_name?: string | null; credit_policy?: string | null };
type SupplierRow = EntityRow & { supplier_name: string };
type EmployeeRow = EntityRow & { display_name: string };
export type MatchingLists = Pick<MemoryWriterRawData, "products" | "customers" | "suppliers" | "staff">;
export type EntityCandidate = {
  id: string;
  name: string;
  score: number;
  matchedField: string;
  status: "active" | "inactive";
  defaultSellingPrice?: number | null;
  currentStock?: number | null;
  creditPolicy?: string | null;
  detail?: string | null;
};

function search<T extends EntityRow>(query: string, rows: readonly T[], name: (row: T) => string,
  fields: Array<[string, (row: T) => string]> = [["name", name]],
): EntityCandidate[] {
  if (!normalizeForSearch(query.trim())) return [];
  const ids = new Map<string, EntityCandidate>();
  for (const [matchedField, field] of fields) {
    for (const { item, score } of fuzzySearch(query, [...rows], (row) => normalizeForSearch(field(row)) ? field(row) : "", { threshold: MATCH_THRESHOLD, maxResults: rows.length })) {
      const id = String(item.id);
      if ((ids.get(id)?.score ?? -1) >= score) continue;
      ids.set(id, { id, name: name(item), score, matchedField, status: item.is_active === false ? "inactive" : "active" });
    }
  }
  return [...ids.values()].sort(compareCandidates).slice(0, MATCH_LIMIT);
}

export function searchProductsLive(query: string, products: readonly ProductRow[]) {
  const rows = new Map(products.map((row) => [String(row.id), row]));
  const name = (row: ProductRow) => row.name;
  const matches = search(query, products, name);
  // Labels can end in catalogue emoji. Preserve literal exact/substring
  // scores, while letting the existing typo scorer compare the text alone.
  const plain = products.filter((row) => /\p{Extended_Pictographic}/u.test(row.name));
  const alternate = search(query, plain, (row) => row.name.replace(/\p{Extended_Pictographic}/gu, "").trim());
  for (const candidate of alternate) {
    const index = matches.findIndex((match) => match.id === candidate.id);
    const match = { ...candidate, name: rows.get(candidate.id)!.name, score: Math.min(candidate.score, 0.8) };
    if (index < 0) matches.push(match);
    else if (matches[index].score < match.score) matches[index] = match;
  }
  return matches.sort(compareCandidates).slice(0, MATCH_LIMIT).map((candidate) => ({
    ...candidate, defaultSellingPrice: rows.get(candidate.id)?.default_selling_price ?? null,
    currentStock: rows.get(candidate.id)?.current_stock ?? null,
  }));
}

export function searchCustomersLive(query: string, customers: readonly CustomerRow[]) {
  const rows = new Map(customers.map((row) => [String(row.id), row]));
  const name = (row: CustomerRow) => row.customer_name;
  const term = /^walk[ -]?in customer$/i.test(query.trim()) ? "Walk-in" : query;
  return search(term, customers, name, [["name", name], ["shop", (row) => row.shop_name ?? ""]]).map((candidate) => ({
    ...candidate, creditPolicy: rows.get(candidate.id)?.credit_policy ?? null, detail: rows.get(candidate.id)?.shop_name ?? null,
  }));
}

export const searchSuppliersLive = (query: string, rows: readonly SupplierRow[]) => search(query, rows, (row) => row.supplier_name);
export const searchEmployeesLive = (query: string, rows: readonly EmployeeRow[]) => search(query, rows, (row) => row.display_name);

export function resolveLiveCandidate(candidates: readonly EntityCandidate[]): EntityCandidate | null {
  const plausible = candidates.filter((candidate) => candidate.score >= RESOLVE_THRESHOLD);
  return plausible.length === 1 && plausible[0].status === "active" ? plausible[0] : null;
}

export function describeLiveMatch(kind: string, query: string, candidates: readonly EntityCandidate[] | null): string {
  if (!candidates) return `The live ${kind} search is unavailable. Please try again.`;
  if (!candidates.length) return `The live search did not find a ${kind} named “${query}”. Please check the name.`;
  if (candidates.every((candidate) => candidate.status === "inactive")) {
    return `${candidates.map((candidate) => candidate.name).join(", ")} is inactive. Please choose an active ${kind}.`;
  }
  const names = candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.name}${candidate.detail ? ` (${candidate.detail})` : ""}${candidate.status === "inactive" ? " (inactive)" : ""}`);
  return `Which ${kind} did you mean? ${names.join("; ")}`;
}

export const LIVE_MATCH_INSTRUCTION = "LIVE ENTITY SEARCH is authoritative for the exact names searched. Report not found only for a searched name with zero candidates. An unavailable read or unsearched name means you cannot verify it. Ask the user to choose if multiple candidates qualify. Never fabricate numbers.";
