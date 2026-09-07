// Reopening an unchanged field must keep its selected record highlighted.
export function activeSuggestionIndex(options: Array<{ id: string }>, value: string, active: number | null) {
  const index = active ?? options.findIndex(option => option.id === value);
  return Math.max(0, Math.min(index, options.length - 1));
}
