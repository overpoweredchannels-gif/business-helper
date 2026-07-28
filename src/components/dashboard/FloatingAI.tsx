"use client";

import { Sparkles, Mic, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface FloatingAIProps {
  onVoice?: () => void;
  onChat?: () => void;
}

export function FloatingAI({ onVoice, onChat }: FloatingAIProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex flex-col items-end gap-2 animate-slideUp">
          <button
            onClick={() => { onVoice?.(); setOpen(false); }}
            className="flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-muted transition-all hover:-translate-y-0.5"
          >
            <Mic className="size-4" />
            Voice Command
          </button>
          <button
            onClick={() => { onChat?.(); setOpen(false); }}
            className="flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-muted transition-all hover:-translate-y-0.5"
          >
            <MessageSquare className="size-4" />
            AI Chat
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "size-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200",
          "hover:scale-105 active:scale-95",
          open
            ? "bg-destructive text-destructive-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary-hover",
        )}
      >
        {open ? <X className="size-6" /> : <Sparkles className="size-6" />}
      </button>
    </div>
  );
}
