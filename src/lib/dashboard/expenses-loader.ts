import type { SupabaseClient } from "@supabase/supabase-js";
import { DashboardReadTracker, runDashboardSourceRead } from "./data-read-state";

/** Uses the same read-state path as other dashboard sources so expenses fail
 * closed, honor account/org request guards, and can be retried through this loader. */
export function loadDashboardExpenses<Row>(
  client: SupabaseClient,
  tracker: DashboardReadTracker,
  accountId: string,
  organizationId: string,
  commit: (rows: Row[]) => void,
  reportError: (error: unknown) => void,
) {
  return runDashboardSourceRead(
    tracker,
    "expenses",
    accountId,
    organizationId,
    async () => {
      const { data, error } = await client
        .from("expenses")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    commit,
    reportError,
  );
}
