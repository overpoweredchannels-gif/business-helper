"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useRegional } from "@/components/regional/RegionalProvider";
import { formatBooksMoney } from "@/lib/tradeos/formatters";
import type { AiBusinessQueryResult } from "@/lib/tradeos/types";
import type { MessageKey } from "@/lib/regional/messages";
import { navigationLabel } from "@/lib/regional/navigation";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function AiPage({ kind, children }: {
  kind: "assistant" | "query" | "voice" | null;
  children: ReactNode;
}) {
  const { t, language } = useRegional();
  const title = kind === "voice" ? t("ai.voiceOperator.title")
    : kind === "query" ? navigationLabel("ai-business-query", "AI Business Query", language) : t("ai.assistant.title");
  return (
    <div className={kind ? "ai-workspace workspace-flow" : "contents"}>
      {kind && (
        <header className="mb-5 flex items-center gap-3">
          <span className="surface-icon rounded-full">
            <Image src="/aankh-app-eye.png" alt="" width={28} height={28} unoptimized />
          </span>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{title}</h1>
        </header>
      )}
      {children}
    </div>
  );
}

export const aiPromptKeys = [
  "ai.suggested.businessHealthQuestion",
  "ai.suggested.reorderQuestion",
  "ai.suggested.topProductsQuestion",
  "ai.suggested.revenueQuestion",
] as const satisfies readonly MessageKey[];

export interface AiQueryMetric {
  label: MessageKey;
  value: number;
}

export function AiQueryPanel({ question, onQuestion, onAsk, busy, error, result, metrics, period, notice }: {
  question: string;
  onQuestion: (question: string) => void;
  onAsk: () => void;
  busy: boolean;
  error: string | null;
  result: AiBusinessQueryResult | null;
  metrics: AiQueryMetric[];
  period?: string;
  notice: string | null;
}) {
  const { t } = useRegional();
  const max = metrics.reduce((highest, item) => Math.max(highest, Math.abs(item.value)), 0);
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
        <input
          id="ai-business-question"
          className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-base"
          aria-label={t("ai.assistant.inputPlaceholder")}
          placeholder={t("ai.assistant.inputPlaceholder")}
          value={question}
          onChange={(event) => onQuestion(event.target.value)}
          required
          disabled={busy}
        />
        <button type="submit" disabled={busy || !question.trim()} className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? t("ai.assistant.thinking") : t("ai.voiceOperator.send")}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {aiPromptKeys.map((key) => (
          <button key={key} type="button" className="workspace-button-secondary" disabled={busy} onClick={() => {
            onQuestion(t(key));
            document.getElementById("ai-business-question")?.focus();
          }}>{t(key)}</button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {result && (
        <>
          <div className="rounded-xl border border-border bg-muted p-4 [overflow-wrap:anywhere]">
            <MarkdownRenderer content={result.answer} />
            {[...result.key_points, ...result.warnings].map((point, index) => <p key={index} className="mt-2 text-sm">{point}</p>)}
          </div>
          {metrics.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-border p-4">
                <h2 className="mb-3 font-semibold">{period}</h2>
                <table className="w-full text-sm tabular-nums">
                  <tbody className="divide-y divide-border">
                    {metrics.map(({ label, value }) => (
                      <tr key={label}>
                        <th scope="row" className="py-2 text-start font-medium">{t(label)}</th>
                        <td className="py-2 text-end">{formatBooksMoney(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <div aria-hidden="true" className="space-y-3 rounded-xl border border-border p-4">
                {metrics.map(({ label, value }) => (
                  <div key={label}>
                    <div className="mb-1 flex justify-between gap-2 text-sm tabular-nums">
                      <span>{t(label)}</span><span>{formatBooksMoney(value)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className={`h-full rounded-full ${value < 0 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${max ? Math.abs(value) / max * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
