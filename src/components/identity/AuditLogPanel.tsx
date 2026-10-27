"use client";

import { useState, useEffect } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { useRegional } from "@/components/regional/RegionalProvider";

interface AuditEntryView {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string | null;
  createdAt: string;
  success: boolean;
}

export default function AuditLogPanel() {
  const { t } = useRegional();
  const actionLabel = (a: string) => {
    const labels: Record<string, string> = {
      login: t('identity.audit.actionLogin'),
      logout: t('identity.audit.actionLogout'),
      login_failed: t('identity.audit.actionLoginFailed'),
      password_changed: t('identity.audit.actionPasswordChanged'),
      password_reset_requested: t('identity.audit.actionPasswordResetRequested'),
      password_reset_completed: t('identity.audit.actionPasswordResetCompleted'),
      role_assigned: t('identity.audit.actionRoleAssigned'),
      account_activated: t('identity.audit.actionAccountActivated'),
      account_deactivated: t('identity.audit.actionAccountDeactivated'),
      invitation_sent: t('identity.audit.actionInvitationSent'),
      invitation_accepted: t('identity.audit.actionInvitationAccepted'),
      custom_role_created: t('identity.audit.actionCustomRoleCreated'),
      custom_role_updated: t('identity.audit.actionCustomRoleUpdated'),
      custom_role_deleted: t('identity.audit.actionCustomRoleDeleted'),
      session_revoked: t('identity.audit.actionSessionRevoked'),
      all_sessions_revoked: t('identity.audit.actionAllSessionsRevoked'),
      session_policy_updated: t('identity.audit.actionSessionPolicyUpdated'),
      ai_action_denied: t('identity.audit.actionAiDenied'),
      initial_provision: t('identity.audit.actionInitialProvision'),
    };
    return labels[a] ?? a;
  };
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authorizedFetch("/api/audit");
        const data = await res.json();
        if (data.ok) {
          setEntries(data.entries || []);
        } else {
          setError(data.error || t('identity.audit.loadFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('tracking.networkError'));
      }
    })();
  }, [t]);

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}>{t('identity.audit.title')}</h2>
      {error && <p style={{ fontSize: "0.875rem", color: "#dc2626", marginBottom: "0.75rem" }}>{error}</p>}
      {entries.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>{t('identity.audit.empty')}</p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {entries.slice(0, 50).map((entry, index) => (
            <div
              key={entry.id}
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "flex-start",
                padding: "0.625rem 1rem",
                borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
                fontSize: "0.8125rem",
              }}
            >
              <span
                style={{
                  borderRadius: "999px",
                  padding: "0.125rem 0.5rem",
                  fontSize: "0.6875rem",
                  background: entry.success ? "#dcfce7" : "#fee2e2",
                  color: entry.success ? "#166534" : "#991b1b",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.success ? t('identity.audit.ok') : t('identity.audit.fail')}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {actionLabel(entry.action)}
                  {entry.actorEmail ? <span style={{ color: "#6b7280" }}> — {entry.actorEmail}</span> : null}
                </div>
                {entry.description && <div style={{ color: "#6b7280" }}>{entry.description}</div>}
                <div style={{ color: "#9ca3af", fontSize: "0.6875rem" }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
