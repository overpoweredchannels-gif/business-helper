"use client";

import { useRegional } from "@/components/regional/RegionalProvider";

interface SetupImportPromptProps {
  complete: boolean;
  retentionDays: number;
  onOpen: () => void;
}

export function SetupImportPrompt({ complete, retentionDays, onOpen }: SetupImportPromptProps) {
  const { t } = useRegional();
  return (
    <section data-help-topic="setup and data import" className="aankh-card flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0">
      <h2 className="text-sm font-semibold">{t('dashboard.setupTitle')}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {complete
          ? t('dashboard.setupComplete').replace('{days}', String(retentionDays))
          : t('dashboard.setupHint')}
      </p>
      </div>
      <div className="shrink-0">
        <button type="button" onClick={onOpen} className="min-h-11 rounded-lg border border-input bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('dashboard.setupOpen')}
        </button>
      </div>
    </section>
  );
}
