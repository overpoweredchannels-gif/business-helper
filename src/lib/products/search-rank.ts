// Shared product-search relevance ranking.
//
// Ranking contract (deterministic; no fuzzy matching, no dependencies):
//   0. Exact barcode or SKU match.
//   1. Exact normalized product-name match.
//   2. Product name starts with the query.
//   3. A word in the product name starts with the query.
//   4. Every query word appears in the product name (broader substring matches
//      naturally land here, ordered after the more precise ranks above).
//   5. The query appears in the brand or category name (legacy behavior,
//      kept as the lowest rank so brand/category search keeps working).
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

  const sku = normalizeSearchText(fields.sku);
  const barcode = normalizeSearchText(fields.barcode);
  if ((sku && sku === normalizedQuery) || (barcode && barcode === normalizedQuery)) return 0;
  if (name === normalizedQuery) return 1;
  if (name.startsWith(normalizedQuery)) return 2;
  if (wordsOf(name).some((word) => word.startsWith(normalizedQuery))) return 3;

  const queryWords = wordsOf(normalizedQuery);
  if (queryWords.length > 0 && queryWords.every((word) => name.includes(word))) return 4;

  const brand = normalizeSearchText(fields.brandName);
  const category = normalizeSearchText(fields.categoryName);
  if ((brand && brand.includes(normalizedQuery)) || (category && category.includes(normalizedQuery))) return 5;
  return null;
}

/**
 * Filter and relevance-rank items for a raw query. Empty queries return the
 * input untouched (callers decide what "no query" shows). Tenant/role scoping
 * stays with the caller: this only reorders already-authorized items.
 */
export function rankSearchResults<T>(items: readonly T[], query: string, fieldsOf: (item: T) => SearchRankFields): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [...items];
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
  return scored.map((entry) => entry.item);
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
