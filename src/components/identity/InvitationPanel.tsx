"use client";

import { useState, useEffect, useCallback } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

interface InvitationView {
  code: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#111827",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const ROLE_OPTIONS = ["salesman", "purchase_officer", "warehouse_staff", "manager", "viewer"];

export default function InvitationPanel() {
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("salesman");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  const { t } = useRegional();
  const load = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/identity/invite");
      const data = await res.json();
      if (data.ok) {
        setInvitations(data.invitations || []);
        setMessage(null);
      } else {
        setMessage({ type: "error", text: data.error || t('identity.invitations.loadFailed') });
        if (res.status === 403) setIsOwner(false);
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t('tracking.networkError') });
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvite = async () => {
    const res = await authorizedFetch("/api/identity/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    if (data.ok) {
      setMessage({
        type: "ok",
        text: t('identity.invitations.inviteSent').replace('{email}', email).replace('{role}', role).replace('{code}', data.invitation.code),
      });
      setEmail("");
      load();
    } else {
      setMessage({ type: "error", text: data.error || t('identity.invitations.inviteFailed') });
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}>
        {t('identity.invitations.title')}
      </h2>

      {message && (
        <p
          style={{
            fontSize: "0.875rem",
            marginBottom: "0.75rem",
            color: message.type === "ok" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
        </p>
      )}

      {isOwner && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "1.25rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            style={inputStyle}
            placeholder="employee@store.pk"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </select>
          <button style={buttonStyle} onClick={sendInvite} disabled={!email.trim()}>
            {t('identity.invitations.sendInvitation')}
          </button>
        </div>
      )}

      {invitations.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>{t('identity.invitations.noInvitations')}</p>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
          {invitations.map((inv, index) => (
            <div
              key={inv.code}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem 1rem",
                borderTop: index === 0 ? "none" : "1px solid #e5e7eb",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{inv.email}</div>
                <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {inv.role} &middot; {t('identity.invitations.expiresAt').replace('{date}', new Date(inv.expiresAt).toLocaleDateString())}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span
                  style={{
                    fontSize: "0.75rem",
                    background: inv.acceptedAt ? "#dcfce7" : "#fef3c7",
                    color: inv.acceptedAt ? "#166534" : "#92400e",
                    borderRadius: "999px",
                    padding: "0.125rem 0.5rem",
                  }}
                >
                  {inv.acceptedAt ? t('identity.invitations.accepted') : t('identity.invitations.codeLabel').replace('{code}', inv.code)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
