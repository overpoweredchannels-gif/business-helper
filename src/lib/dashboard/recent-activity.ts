// Dashboard Recent Activity feed: merge sales + purchases into one
// recency-ordered list, capped at the number of rows the widget shows.
//
// The feed used to be built as "up to 5 sales, then up to 3 purchases"
// concatenated sales-first, and the widget then showed only the first 5
// rows — so whenever there were 5 recent sales, no purchase ever appeared,
// and a purchase from 5 minutes ago sat below a sale from yesterday.
// Both kinds now compete fairly on recency: the 5 most recent activities
// across both types, newest first.
export const RECENT_ACTIVITY_LIMIT = 5;

export type RecentActivityType = "sale" | "purchase" | "payment" | "stock" | "customer" | "task";

export type RecentActivityEntryInput = {
  id: string;
  type: RecentActivityType;
  description: string;
  /** Already-formatted display time (see formatDateTime in page.tsx). */
  time: string;
  amount?: string;
  /** Raw ISO timestamp the merge sorts on — never rendered. */
  createdAt: string;
};

export type RecentActivityEntry = Omit<RecentActivityEntryInput, "createdAt">;

export function buildRecentActivities(entries: RecentActivityEntryInput[]): RecentActivityEntry[] {
  return entries
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map(({ id, type, description, time, amount }) => ({ id, type, description, time, amount }));
}
