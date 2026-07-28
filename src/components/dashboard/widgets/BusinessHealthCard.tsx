"use client";

import { cn } from "@/lib/utils";

interface Metric {
  label: string;
  value: string;
  status: "good" | "warning" | "critical";
}

interface BusinessHealthCardProps {
  score: number;
  metrics: Metric[];
}

function CircularScore({ score }: { score: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#4CAF50" : score >= 60 ? "#F4A825" : "#D9534F";
  return (
    <div className="relative size-28">
      <svg className="size-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="6" />
        <circle
          cx="50" cy="50" r={r}
          fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold font-heading" style={{ color }}>{score}</span>
        <span className="text-[10px] text-light-text font-medium uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
}

export function BusinessHealthCard({ score, metrics }: BusinessHealthCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:shadow-[0_4px_16px_rgba(45,41,38,0.1)]">
      <h3 className="text-sm font-semibold text-foreground mb-4">Business Health</h3>
      <div className="flex items-start gap-6">
        <CircularScore score={score} />
        <div className="flex-1 grid gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-center justify-between">
              <span className="text-xs text-light-text">{m.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{m.value}</span>
                <span className={cn(
                  "size-2 rounded-full",
                  m.status === "good" && "bg-success",
                  m.status === "warning" && "bg-warning",
                  m.status === "critical" && "bg-destructive",
                )} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
