"use client";

import { Sparkles, ArrowRight } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";

interface AIInsightCardProps {
  insight: string;
  /** Freshness label ("Updated X min ago"). A rule-based alert has no confidence to show. */
  updatedLabel?: string;
  action?: string;
  onLearnMore?: () => void;
  reason?: string;
}

export function AIInsightCard({ insight, updatedLabel, action, onLearnMore, reason }: AIInsightCardProps) {
  const { t } = useRegional();
  return (
    <section className="aankh-card flex flex-wrap items-center gap-4 rounded-xl border border-border bg-primary-light p-5">
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-card text-primary">
        <Sparkles aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0 flex-1 basis-44">
        <h3 className="mb-1 text-sm font-semibold text-primary">{t('dashboard.aiRecommendation')}</h3>
        <p className="text-sm text-foreground font-medium leading-relaxed">{insight}</p>
        {reason && <p className="text-xs text-light-text mt-1.5 leading-relaxed">{reason}</p>}
        {updatedLabel && <p className="mt-1.5 text-xs text-light-text">{updatedLabel}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={onLearnMore}
          className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-semibold text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {action}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      )}
    </section>
  );
}
