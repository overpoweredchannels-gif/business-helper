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
    <section data-help-topic="setup and data import" className="rounded-xl border border-primary/30 bg-card p-5">
      <h2 className="text-lg font-semibold">{t('dashboard.setupTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {complete
          ? t('dashboard.setupComplete').replace('{days}', String(retentionDays))
          : t('dashboard.setupHint')}
      </p>
      <div className="mt-3">
        <button type="button" onClick={onOpen} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          {t('dashboard.setupOpen')}
        </button>
      </div>
    </section>
  );
}
