// Shared product-search relevance ranking.
//
// Ranking contract (deterministic; no fuzzy matching, no dependencies).
// Lower rank = better. Exact codes keep the highest priority; code prefix and
// code substring matches have their own documented ranks while the agreed name
// ranking keeps its relative order (exact name > name prefix > word prefix >
// all-words-in-name):
//   0. Exact SKU/barcode match: the whole query, or (for multiword queries)
//      a query word, exactly equals a normalized SKU or barcode.
//   1. Exact normalized product-name match.
//   2. Product name starts with the whole query.
//   3. A SKU/barcode starts with a query word (code prefix).
//   4. A word in the product name starts with a query word.
//   5. A query word appears inside a SKU/barcode (code substring, non-prefix).
//   6. Every query word appears in the product name.
//   7. Every query word appears in at least one of name/SKU/barcode/brand/
//      category (combined-label parity: the legacy selector matched across its
//      "name — sku — barcode" label; single-word brand/category matches land
//      here too, keeping them the lowest rank).
//
// Within a rank, ordering is by normalized name, then by id, so results are
// stable across keystrokes and renders. Products matching nothing are excluded.
export interface SearchRankFields {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  brandName?: string | null;
  categoryName?: string | null;
}

export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function wordsOf(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/** Rank for one product against an already-normalized query; null = no match. */
export function rankProductMatch(fields: SearchRankFields, normalizedQuery: string): number | null {
  if (!normalizedQuery) return null;
  const name = normalizeSearchText(fields.name);
  if (!name) return null;
  const codes = [normalizeSearchText(fields.sku), normalizeSearchText(fields.barcode)].filter(Boolean);
  const brand = normalizeSearchText(fields.brandName);
  const category = normalizeSearchText(fields.categoryName);

  // Exact code match on the whole query: highest priority, short-circuit.
  if (codes.some((code) => code === normalizedQuery)) return 0;

  let best: number | null = null;
  if (name === normalizedQuery) best = 1;
  else if (name.startsWith(normalizedQuery)) best = 2;

  // Per-word matching: every query word must match at least one field;
  // the product rank is the best (lowest) word rank.
  let wordBest = Infinity;
  for (const word of wordsOf(normalizedQuery)) {
    let rank: number | null = null;
    if (codes.some((code) => code === word)) rank = 0;
    else if (codes.some((code) => code.startsWith(word))) rank = 3;
    else if (wordsOf(name).some((nameWord) => nameWord.startsWith(word))) rank = 4;
    else if (codes.some((code) => code.includes(word))) rank = 5;
    else if (name.includes(word)) rank = 6;
    else if (brand.includes(word) || category.includes(word)) rank = 7;
    if (rank === null) return null;
    if (rank < wordBest) wordBest = rank;
  }
  if (best === null || wordBest < best) best = wordBest;
  return best;
}

/**
 * Filter and relevance-rank items for a raw query. Empty queries return the
 * input untouched (callers decide what "no query" shows). Tenant/role scoping
 * stays with the caller: this only reorders already-authorized items.
 */
export function rankSearchResults<T>(items: readonly T[], query: string, fieldsOf: (item: T) => SearchRankFields): T[] {
  return rankSearchResultsWithTiers(items, query, fieldsOf).map((entry) => entry.item);
}

export interface RankedResult<T> {
  item: T;
  /** Relevance tier (0 = best); see the contract above. */
  rank: number;
}

/**
 * Like rankSearchResults, but exposes each item's rank tier so callers can
 * merge differently-typed result sets (e.g. navigation sections and products)
 * with one explicit, deterministic cross-type ordering.
 */
export function rankSearchResultsWithTiers<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => SearchRankFields,
): RankedResult<T>[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...items].map((item) => ({ item, rank: Number.MAX_SAFE_INTEGER }));
  const scored: Array<{ item: T; rank: number; sortName: string; sortId: string }> = [];
  for (const item of items) {
    const fields = fieldsOf(item);
    const rank = rankProductMatch(fields, normalizedQuery);
    if (rank === null) continue;
    const anyItem = item as { id?: unknown };
    scored.push({
      item,
      rank,
      sortName: normalizeSearchText(fields.name),
      sortId: typeof anyItem.id === "string" || typeof anyItem.id === "number" ? String(anyItem.id) : "",
    });
  }
  scored.sort((a, b) =>
    a.rank - b.rank ||
    (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0) ||
    (a.sortId < b.sortId ? -1 : a.sortId > b.sortId ? 1 : 0),
  );
  return scored.map((entry) => ({ item: entry.item, rank: entry.rank }));
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split text into segments marking where query words occur, for safe
 * <mark> rendering (no HTML injection: segments are plain strings).
 * Only segments against the product name are highlighted by callers.
 */
export function highlightSearchMatches(text: string, query: string): HighlightSegment[] {
  const terms = wordsOf(normalizeSearchText(query)).filter((term) => term.length > 0);
  if (!terms.length || !text) return [{ text, match: false }];
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index), match: false });
    segments.push({ text: match[0], match: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), match: false });
  return segments;
}
