"use client";

import { useState, useEffect } from "react";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

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

const ACTION_LABELS: Record<string, string> = {
  login: "Sign in",
  logout: "Sign out",
  login_failed: "Failed sign in",
  password_changed: "Password changed",
  password_reset_requested: "Reset requested",
  password_reset_completed: "Reset completed",
  role_assigned: "Role assigned",
  account_activated: "Account activated",
  account_deactivated: "Account deactivated",
  invitation_sent: "Invitation sent",
  invitation_accepted: "Invitation accepted",
  custom_role_created: "Role created",
  custom_role_updated: "Role updated",
  custom_role_deleted: "Role deleted",
  session_revoked: "Session revoked",
  all_sessions_revoked: "All sessions revoked",
  session_policy_updated: "Policy updated",
  ai_action_denied: "AI action denied",
  initial_provision: "Workspace provisioned",
};

export default function AuditLogPanel() {
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
          setError(data.error || "Failed to load audit log");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      }
    })();
  }, []);

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}>Audit Log</h2>
      {error && <p style={{ fontSize: "0.875rem", color: "#dc2626", marginBottom: "0.75rem" }}>{error}</p>}
      {entries.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>No audit events yet.</p>
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
                {entry.success ? "OK" : "FAIL"}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {ACTION_LABELS[entry.action] || entry.action}
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
