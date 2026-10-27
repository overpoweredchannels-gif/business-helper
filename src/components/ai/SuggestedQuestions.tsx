"use client";

import { Sparkles, TrendingUp, AlertTriangle, BarChart3, Package, DollarSign } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { MessageKey } from "@/lib/regional/messages";

const DEFAULT_QUESTIONS: Array<{ icon: React.ComponentType<{ className?: string }>; labelKey: MessageKey; questionKey: MessageKey }> = [
  { icon: BarChart3, labelKey: "dashboard.businessHealth", questionKey: "ai.suggested.businessHealthQuestion" },
  { icon: TrendingUp, labelKey: "dashboard.topProducts", questionKey: "ai.suggested.topProductsQuestion" },
  { icon: DollarSign, labelKey: "team.metricRevenue", questionKey: "ai.suggested.revenueQuestion" },
  { icon: AlertTriangle, labelKey: "ai.suggested.alertsLabel", questionKey: "ai.suggested.alertsQuestion" },
  { icon: Package, labelKey: "inventory.import.field.reorder", questionKey: "ai.suggested.reorderQuestion" },
  { icon: Sparkles, labelKey: "ai.suggested.recommendationsLabel", questionKey: "ai.suggested.recommendationsQuestion" },
];

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
  visible: boolean;
}

export function SuggestedQuestions({ onSelect, visible }: SuggestedQuestionsProps) {
  const { t } = useRegional();
  if (!visible) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">{t('ai.suggested.tryAsking')}</p>
      <div className="flex flex-wrap gap-2">
        {DEFAULT_QUESTIONS.map((q) => {
          const Icon = q.icon;
          return (
            <button
              key={q.questionKey}
              onClick={() => onSelect(t(q.questionKey))}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:border-primary/30 transition-all"
            >
              <Icon className="size-3" />
              {t(q.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
