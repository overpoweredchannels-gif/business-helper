"use client";

import { useState, useEffect, useCallback } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";

interface SessionView {
  sessionId: string;
  profileId: string;
  deviceName: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  rememberDevice: boolean;
}

interface PolicyView {
  sessionTimeoutMinutes: number;
  singleDevice: boolean;
}

const buttonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  cursor: "pointer",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem 0",
  borderBottom: "1px solid #e5e7eb",
  gap: "0.75rem",
};

export default function SessionManagement() {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [policy, setPolicy] = useState<PolicyView>({ sessionTimeoutMinutes: 480, singleDevice: false });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(true);

  const { t } = useRegional();
  const load = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/identity/sessions");
      const data = await res.json();
      if (data.ok) {
        setSessions(data.sessions || []);
        if (data.policy) setPolicy(data.policy);
        setError(null);
      } else {
        setError(data.error || t('identity.sessions.loadFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracking.networkError'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (sessionId: string) => {
    const res = await authorizedFetch("/api/identity/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (data.ok) {
      setMessage(t('identity.sessions.revoked'));
      load();
    } else {
      setError(data.error || t('identity.sessions.revokeFailed'));
      if (res.status === 403) setIsOwner(false);
    }
  };

  const savePolicy = async () => {
    const res = await authorizedFetch("/api/identity/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    const data = await res.json();
    if (data.ok) {
      setPolicy(data.policy);
      setMessage(t('identity.sessions.policyUpdated'));
    } else {
      setError(data.error || t('identity.sessions.policyFailed'));
      if (res.status === 403) setIsOwner(false);
    }
  };

  return (
    <div style={{ padding: "1.5rem" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}>
        {t('identity.sessions.title')}
      </h2>

      {message && (
        <p style={{ fontSize: "0.875rem", color: "#166534", marginBottom: "0.75rem" }}>{message}</p>
      )}
      {error && (
        <p style={{ fontSize: "0.875rem", color: "#dc2626", marginBottom: "0.75rem" }}>{error}</p>
      )}

      {isOwner && (
        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            marginBottom: "1.25rem",
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
            {t('identity.sessions.timeoutMinutes')}
            <input
              type="number"
              min={15}
              max={1440}
              value={policy.sessionTimeoutMinutes}
              onChange={(e) => setPolicy({ ...policy, sessionTimeoutMinutes: Number(e.target.value) })}
              style={{ width: "5rem", padding: "0.25rem 0.5rem", border: "1px solid #d1d5db", borderRadius: "0.375rem" }}
            />
          </label>
          <label style={{ fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <input
              type="checkbox"
              checked={policy.singleDevice}
              onChange={(e) => setPolicy({ ...policy, singleDevice: e.target.checked })}
            />
            {t('identity.sessions.singleDevice')}
          </label>
          <button onClick={savePolicy} style={buttonStyle}>
            {t('identity.sessions.savePolicy')}
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>{t('identity.sessions.noSessions')}</p>
      ) : (
        sessions.map((session) => (
          <div key={session.sessionId} style={rowStyle}>
            <div>
              <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{session.deviceName}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {t('identity.sessions.lastActive').replace('{time}', new Date(session.lastActiveAt).toLocaleString())} &middot;{" "}
                {session.rememberDevice ? t('identity.sessions.remembered') : t('identity.sessions.expiresAt').replace('{time}', new Date(session.expiresAt).toLocaleString())}
              </div>
            </div>
            <button onClick={() => revoke(session.sessionId)} style={buttonStyle}>
              {t('identity.sessions.revoke')}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
