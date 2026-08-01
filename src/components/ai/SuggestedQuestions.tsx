"use client";

import { Sparkles, TrendingUp, AlertTriangle, BarChart3, Package, DollarSign } from "lucide-react";

const DEFAULT_QUESTIONS: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; question: string }> = [
  { icon: BarChart3, label: "Business Health", question: "How is my business performing overall?" },
  { icon: TrendingUp, label: "Top Products", question: "What are my top selling products this month?" },
  { icon: DollarSign, label: "Revenue", question: "What is my revenue and profit this month?" },
  { icon: AlertTriangle, label: "Alerts", question: "Are there any issues I need to address?" },
  { icon: Package, label: "Reorder", question: "What products need to be reordered?" },
  { icon: Sparkles, label: "Recommendations", question: "What recommendations do you have for my business?" },
];

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
  visible: boolean;
}

export function SuggestedQuestions({ onSelect, visible }: SuggestedQuestionsProps) {
  if (!visible) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">Try asking:</p>
      <div className="flex flex-wrap gap-2">
        {DEFAULT_QUESTIONS.map((q) => {
          const Icon = q.icon;
          return (
            <button
              key={q.question}
              onClick={() => onSelect(q.question)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:border-primary/30 transition-all"
            >
              <Icon className="size-3" />
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
