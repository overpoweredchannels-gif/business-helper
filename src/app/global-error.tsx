"use client";

import { useEffect } from "react";
import { reportClientRuntimeError } from "@/lib/monitoring/client-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientRuntimeError({
      kind: "error",
      message: error.message,
      stack: error.stack,
      path: window.location.pathname,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "100%", maxWidth: 520, border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: 32, boxShadow: "0 20px 45px rgba(15, 23, 42, 0.08)" }}>
            <div style={{ fontWeight: 800, color: "#2563eb", marginBottom: 20 }}>TradeOS</div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Something went wrong</h1>
            <p style={{ color: "#475569", lineHeight: 1.6 }}>
              The issue has been recorded. Try loading this screen again; your saved business data has not been changed.
            </p>
            {error.digest && <p style={{ color: "#64748b", fontSize: 12 }}>Reference: {error.digest}</p>}
            <button
              type="button"
              onClick={reset}
              style={{ border: 0, borderRadius: 10, background: "#2563eb", color: "white", padding: "11px 18px", fontWeight: 700, cursor: "pointer" }}
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
