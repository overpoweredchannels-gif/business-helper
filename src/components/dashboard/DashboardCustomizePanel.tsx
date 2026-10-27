"use client";

import { Plus, RotateCcw } from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type { DashboardWidgetDefinition, DashboardWidgetId } from "@/lib/preferences/dashboard-widgets";
import type { DashboardSectionCardDefinition } from "@/lib/dashboard/section-cards";
import type { SectionId } from "@/lib/tradeos/types";

/**
 * Shown while the home dashboard is being arranged. Removing a card only takes it
 * off the dashboard - the records stay untouched and the sidebar keeps the feature.
 */
export function DashboardCustomizePanel({ removed, onShow, onReset, availableSections = [], onAddSection }: {
  removed: DashboardWidgetDefinition[];
  onShow: (id: DashboardWidgetId) => void;
  onReset: () => void;
  availableSections?: DashboardSectionCardDefinition[];
  onAddSection?: (section: SectionId) => void;
}) {
  const { t } = useRegional();
  return (
    <section aria-label={t('dashboard.customize.ariaLabel')} className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t('dashboard.customize.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('dashboard.customize.help').split('{remove}')[0]}<span className="font-medium text-foreground">{t('sell.remove')}</span>{t('dashboard.customize.help').split('{remove}')[1]}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={removed.length === 0}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" />
          {t('inventory.reset')}
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold text-foreground">
          {removed.length > 0 ? t('dashboard.customize.removedCount').replace('{count}', String(removed.length)) : t('dashboard.customize.nothingRemoved')}
        </p>
        {removed.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.customize.allOnDashboard')}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {removed.map((widget) => (
              <button
                key={widget.id}
                type="button"
                onClick={() => onShow(widget.id)}
                title={t('dashboard.customize.addBackTitle').replace('{label}', widget.label).replace('{where}', widget.whereToFind)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus className="size-3" />
                {widget.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {onAddSection && (
        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-semibold text-foreground">{t('dashboard.customize.addFromSidebar')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('dashboard.customize.addHelp')}
          </p>
          {availableSections.length === 0 ? (
            <p className="mt-2 text-xs text-light-text">{t('dashboard.customize.allSectionsOn')}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {availableSections.map((card) => (
                <button
                  key={card.section}
                  type="button"
                  onClick={() => onAddSection(card.section)}
                  title={card.description}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Plus className="size-3" />
                  {card.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
