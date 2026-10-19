"use client";

import { useRegional } from "@/components/regional/RegionalProvider";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ur', label: 'Urdu', native: 'اردو' },
] as const;

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage } = useRegional();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0];

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
        aria-label="Select language"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4" />
        <span>{current.native}</span>
      </button>
      
      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border bg-background shadow-lg z-50 overflow-hidden">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => {
                setLanguage(lang.code);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-muted transition-colors min-h-[44px]",
                language === lang.code && "bg-primary/10 text-primary font-medium"
              )}
            >
              <span>{lang.native}</span>
              <span className="text-xs text-light-text">{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
