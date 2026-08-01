"use client";

import { Package, Users, Truck, TrendingUp, AlertTriangle, DollarSign, ShoppingCart } from "lucide-react";

const CARD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  product: Package,
  customer: Users,
  supplier: Truck,
  revenue: DollarSign,
  profit: TrendingUp,
  alert: AlertTriangle,
  order: ShoppingCart,
};

interface BusinessCardProps {
  type: string;
  title: string;
  metrics: Array<{ label: string; value: string }>;
  status?: "positive" | "negative" | "neutral";
}

export function BusinessCard({ type, title, metrics, status = "neutral" }: BusinessCardProps) {
  const Icon = CARD_ICONS[type] || Package;
  const borderColor = status === "positive" ? "border-emerald-400/40" : status === "negative" ? "border-red-400/40" : "border-border";

  return (
    <div className={`my-3 rounded-lg border ${borderColor} bg-card/50 p-3 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {metrics.map((m, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="font-medium text-foreground">{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function extractBusinessCards(text: string): { cards: BusinessCardProps[]; cleanText: string } {
  const cards: BusinessCardProps[] = [];
  const cardRegex = /```card\s*\n([\s\S]*?)```/g;
  let match;
  let cleanText = text;

  while ((match = cardRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.title && parsed.metrics) {
        cards.push({
          type: parsed.type || "product",
          title: parsed.title,
          metrics: parsed.metrics,
          status: parsed.status || "neutral",
        });
      }
    } catch {
      // skip invalid JSON inside card blocks
    }
    cleanText = cleanText.replace(match[0], "");
  }

  return { cards, cleanText: cleanText.trim() };
}
