import { useState } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { syncIssueCanRetry, type SyncIssue, type SyncIssueKind } from "@/lib/offline/sync-issues";

/**
 * Slice S3 (Offline Tier-1) — owner-only Sync issues list.
 *
 * Rendered in the desktop build only, for owner/admin, when open
 * issues exist. Each row is a sale the server refused (parked with its
 * full payload, never dropped) or a provisional number that could not
 * be linked. Retry re-submits the parked sale with its ORIGINAL
 * idempotency key — safe once the cause is fixed. Discard is a
 * two-step in-app confirm (never window.confirm) and only marks the
 * row discarded; nothing is ever auto-deleted. A fingerprint mismatch
 * has no Retry: the same key with different contents can never
 * succeed, so the sale must be entered again as a new sale.
 */
export function SyncIssuesPanel({
  issues,
  formatAmount,
  retryingId,
  onRetry,
  onDiscard,
}: {
  issues: SyncIssue[];
  formatAmount: (value: number) => string;
  retryingId: string | null;
  onRetry: (issue: SyncIssue) => void;
  onDiscard: (issue: SyncIssue) => void;
}) {
  const { t } = useRegional();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const kindLabel = (kind: SyncIssueKind): string => {
    switch (kind) {
      case "stock-conflict":
        return t("syncIssues.kindStockConflict");
      case "fingerprint-mismatch":
        return t("syncIssues.kindFingerprintMismatch");
      case "provisional-link":
        return t("syncIssues.kindProvisionalLink");
      default:
        return t("syncIssues.kindRejected");
    }
  };

  if (issues.length === 0) return null;

  return (
    <section aria-label={t("syncIssues.title")} className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <h3 className="text-sm font-medium">{t("syncIssues.title")}</h3>
      <p className="mt-1 text-sm">{t("syncIssues.intro")}</p>
      <ul className="mt-3 space-y-3">
        {issues.map((issue) => (
          <li key={issue.id} className="rounded-lg border border-warning/40 bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium">
                {kindLabel(issue.kind)}
              </span>
              {issue.provisionalNumber && (
                <span className="text-xs tabular-nums">
                  {t("syncIssues.provisional").replace("{number}", issue.provisionalNumber)}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-medium">
              {issue.customerName ?? t("syncIssues.unknownCustomer")}
              {issue.total !== null && (
                <span className="ml-2 tabular-nums">{formatAmount(issue.total)}</span>
              )}
            </p>
            <p className="mt-1 text-sm">{issue.reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {syncIssueCanRetry(issue) && (
                <button
                  type="button"
                  disabled={retryingId === issue.id}
                  onClick={() => onRetry(issue)}
                  className="min-h-11 rounded border border-input bg-background px-3 font-medium focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {retryingId === issue.id ? t("syncIssues.retrying") : t("syncIssues.retry")}
                </button>
              )}
              {confirmingId === issue.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingId(null);
                    onDiscard(issue);
                  }}
                  className="min-h-11 rounded border border-input bg-background px-3 font-medium focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("syncIssues.confirmDiscard")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(issue.id)}
                  className="min-h-11 rounded border border-input bg-background px-3 font-medium focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("syncIssues.discard")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
