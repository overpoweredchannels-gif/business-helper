import type { AiAlert } from "../tradeos/types";
import { SHOWN_AI_ALERT_STATUSES } from "./ai-alert-sync";

const severityRank = new Map([
  ["critical", 4],
  ["high", 3],
  ["warning", 3],
  ["medium", 2],
  ["low", 1],
]);

export function rankVisibleAiAlerts(alerts: readonly AiAlert[]): AiAlert[] {
  return alerts
    .filter((alert) => SHOWN_AI_ALERT_STATUSES.includes(alert.status))
    .sort((left, right) =>
      (severityRank.get(right.severity) ?? 0) - (severityRank.get(left.severity) ?? 0) ||
      right.created_at.localeCompare(left.created_at) ||
      left.id.localeCompare(right.id)
    );
}

export function formatVisibleAiAlertsContext(alerts: readonly AiAlert[]): string {
  return [
    `Current business alerts (${alerts.length}):`,
    ...alerts.map((alert) =>
      [`- [${alert.severity}] ${alert.title}`, alert.summary, alert.recommended_action]
        .filter(Boolean)
        .join(" ")
    ),
  ].join("\n");
}
