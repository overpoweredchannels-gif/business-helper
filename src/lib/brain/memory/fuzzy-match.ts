const URDU_ALEF_NORMALIZE: Record<string, string> = {
  "\u0622": "\u0627",
  "\u0623": "\u0627",
  "\u0625": "\u0627",
};

const URDU_YE_NORMALIZE: Record<string, string> = {
  "\u064A": "\u06CC",
  "\u0649": "\u06CC",
};

function normalizeText(text: string): string {
  let result = text.trim().toLowerCase();
  result = result.replace(/[\u0622\u0623\u0625]/g, "\u0627");
  result = result.replace(/[\u064A\u0649]/g, "\u06CC");
  result = result.replace(/[-_./,;:!?()'"`~@#$%^&*+=<>[\]{}|\\]/g, " ");
  result = result.replace(/\s+/g, " ");
  return result.trim();
}

function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[] = new Array(bn + 1);
  for (let j = 0; j <= bn; j++) matrix[j] = j;

  for (let i = 1; i <= an; i++) {
    let prev = matrix[0];
    matrix[0] = i;
    for (let j = 1; j <= bn; j++) {
      const temp = matrix[j];
      matrix[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(matrix[j - 1], matrix[j], prev);
      prev = temp;
    }
  }
  return matrix[bn];
}

function wordOverlapScore(query: string, target: string): number {
  const queryWords = query.split(/\s+/).filter((w) => w.length > 1);
  const targetWords = target.split(/\s+/).filter((w) => w.length > 1);
  if (queryWords.length === 0 || targetWords.length === 0) return 0;

  const common = queryWords.filter((qw) =>
    targetWords.some((tw) => tw.includes(qw) || qw.includes(tw))
  ).length;

  return common / Math.max(queryWords.length, targetWords.length);
}

export interface FuzzyMatchOptions {
  threshold?: number;
  maxResults?: number;
  fields?: string[];
}

export function fuzzySearch<T>(
  query: string,
  items: T[],
  extractField: (item: T) => string,
  options: FuzzyMatchOptions = {}
): Array<{ item: T; score: number; matchedField: string; originalQuery: string }> {
  const threshold = options.threshold ?? 0.5;
  const maxResults = options.maxResults ?? 5;

  if (!query || query.trim().length === 0) return [];

  const normalizedQuery = normalizeText(query);
  const results: Array<{ item: T; score: number; matchedField: string; originalQuery: string }> = [];

  for (const item of items) {
    const fieldValue = extractField(item);
    if (!fieldValue) continue;

    const normalizedValue = normalizeText(fieldValue);
    let score = 0;
    let matchedField = "name";

    if (normalizedQuery === normalizedValue) {
      score = 1.0;
    } else if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) {
      score = 0.9;
    } else {
      const distance = levenshteinDistance(normalizedQuery, normalizedValue);
      const maxLen = Math.max(normalizedQuery.length, normalizedValue.length);
      if (maxLen > 0) {
        if ((normalizedQuery.length < 10 && distance <= 2) || (normalizedQuery.length >= 10 && distance <= 3)) {
          score = 0.8;
        } else {
          const wordScore = wordOverlapScore(normalizedQuery, normalizedValue);
          if (wordScore >= 0.5) {
            score = 0.5 + wordScore * 0.3;
          }
        }
      }
    }

    if (score >= threshold) {
      results.push({ item, score, matchedField, originalQuery: query });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function normalizeForSearch(text: string): string {
  return normalizeText(text);
}
