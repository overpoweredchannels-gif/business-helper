"use client";

import { Sparkles, ArrowRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

interface AIInsightCardProps {
  insight: string;
  confidence: number;
  action?: string;
  onLearnMore?: () => void;
  reason?: string;
}

export function AIInsightCard({ insight, confidence, action, onLearnMore, reason }: AIInsightCardProps) {
  const confidenceColor =
    confidence >= 80 ? "text-success" : confidence >= 60 ? "text-warning" : "text-destructive";
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-primary-light/60 to-card p-5 transition-all duration-200 hover:shadow-[0_4px_16px_rgba(45,41,38,0.1)]">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-sm">
          <Lightbulb className="size-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="size-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">AI Recommendation</span>
          </div>
          <p className="text-sm text-foreground font-medium leading-relaxed">{insight}</p>
          {reason && <p className="text-xs text-light-text mt-1.5 leading-relaxed">{reason}</p>}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-light-text">Confidence</span>
              <span className={cn("text-xs font-semibold", confidenceColor)}>{confidence}%</span>
            </div>
            {action && (
              <button
                onClick={onLearnMore}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover transition-colors"
              >
                {action}
                <ArrowRight className="size-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
