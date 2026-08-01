"use client";

import { useEffect, useState } from "react";
import { runAllValidations, printReport, formatAsMarkdown, ValidationReport } from "@/lib/brain/validation";

export default function BrainValidationPage() {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runAll();
    async function runAll() {
      setRunning(true);
      setError(null);
      try {
        const r = await runAllValidations();
        setReport(r);
        setMarkdown(formatAsMarkdown(r));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }
  }, []);

  return (
    <div style={{ padding: "24px", fontFamily: "monospace", maxWidth: "960px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}>
        Business Brain Validation
      </h1>

      {running && (
        <div style={{ padding: "16px", background: "#f0f0f0", borderRadius: "8px" }}>
          Running validation suite...
        </div>
      )}

      {error && (
        <div style={{ padding: "16px", background: "#fee", borderRadius: "8px", color: "#c00" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {report && (
        <>
          <div
            style={{
              padding: "16px",
              background: report.verdict === "PASS" ? "#efe" : "#fee",
              borderRadius: "8px",
              marginBottom: "16px",
              fontSize: "18px",
            }}
          >
            <strong>Verdict: {report.verdict}</strong>
            <span style={{ marginLeft: "16px", fontSize: "14px" }}>
              {report.totalPassed}/{report.totalTests} passed | {report.totalDurationMs}ms
            </span>
          </div>

          {report.suites.map((suite) => {
            const allPassed = suite.failed === 0;
            return (
              <div
                key={suite.name}
                style={{
                  marginBottom: "16px",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    background: allPassed ? "#dfd" : "#fdd",
                    fontWeight: "bold",
                    fontSize: "16px",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{allPassed ? "✅" : "❌"} {suite.name}</span>
                  <span style={{ fontSize: "13px" }}>
                    {suite.passed}/{suite.total} | {suite.durationMs}ms
                  </span>
                </div>
                <div style={{ padding: "8px 16px" }}>
                  {suite.tests.map((t) => (
                    <div
                      key={t.name}
                      style={{
                        padding: "4px 0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderBottom: "1px solid #eee",
                        fontSize: "13px",
                      }}
                    >
                      <span>
                        {t.passed ? "✅" : "❌"} {t.name}
                      </span>
                      <span style={{ color: t.passed ? "#080" : "#c00", fontSize: "12px" }}>
                        {t.passed ? "PASS" : "FAIL"} ({t.durationMs}ms)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: "24px" }}>
            <h2 style={{ fontSize: "18px", marginBottom: "8px" }}>Raw Report</h2>
            <pre
              style={{
                background: "#f5f5f5",
                padding: "16px",
                borderRadius: "8px",
                fontSize: "12px",
                overflow: "auto",
                maxHeight: "400px",
                whiteSpace: "pre-wrap",
              }}
            >
              {markdown}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
