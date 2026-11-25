"use client";

import { useEffect, useId, useState } from "react";
import { ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DISPLAY_ZOOM,
  DISPLAY_ZOOM_PRESETS,
  MAX_DISPLAY_ZOOM_PERCENT,
  MIN_DISPLAY_ZOOM_PERCENT,
  applyDisplayZoom,
  displayZoomFromPercent,
  displayZoomPercent,
  formatDisplayZoom,
  readDisplayZoom,
  saveDisplayZoom,
} from "@/lib/preferences/display-zoom";
import { useRegional } from "@/components/regional/RegionalProvider";
import { navigationText } from "@/lib/regional/navigation";

const PRESET_PERCENTAGES = DISPLAY_ZOOM_PRESETS.map(displayZoomPercent);

export function DisplayZoomControl({ collapsed = false }: { collapsed?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [percentText, setPercentText] = useState(String(displayZoomPercent(DEFAULT_DISPLAY_ZOOM)));
  const [applied, setApplied] = useState<number>(DEFAULT_DISPLAY_ZOOM);
  const { language } = useRegional();

  useEffect(() => {
    // The preferred ratio lives in this browser, so it is read once after mount
    // instead of during render (which would not match the server markup).
    const saved = readDisplayZoom();
    /* eslint-disable react-hooks/set-state-in-effect */
    setPercentText(String(displayZoomPercent(saved)));
    setApplied(saved);
    /* eslint-enable react-hooks/set-state-in-effect */
    applyDisplayZoom(saved);
  }, []);

  const typedPercent = Number(percentText);
  const percentValid =
    percentText.trim() !== "" && Number.isFinite(typedPercent) && typedPercent >= MIN_DISPLAY_ZOOM_PERCENT && typedPercent <= MAX_DISPLAY_ZOOM_PERCENT;
  const apply = () => {
    if (!percentValid) return;
    setApplied(saveDisplayZoom(displayZoomFromPercent(typedPercent)));
    setOpen(false);
  };

  return (
    <div data-context-help-skip className="space-y-1">
      <button
        type="button"
        onClick={() => { setPercentText(String(displayZoomPercent(applied))); setOpen(value => !value); }}
        data-help-id="sidebar-zoom"
        aria-expanded={open}
        aria-label={navigationText('Screen zoom',language)}
        className="min-h-11 w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-nav-muted hover:text-panel-foreground hover:bg-nav-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-on-dark"
      >
        <ZoomIn className="size-3.5" />
        {!collapsed && <span>{navigationText('Screen zoom',language)}</span>}
        {!collapsed && <span className="ms-auto tabular-nums text-nav-muted">{formatDisplayZoom(applied)}</span>}
      </button>
      {open && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-foreground">
          <label className="block text-xs font-semibold" htmlFor={`${id}-preset`}>{navigationText('Suggested zoom ratio',language)}</label>
          <select
            id={`${id}-preset`}
            value={PRESET_PERCENTAGES.includes(typedPercent) ? String(typedPercent) : "custom"}
            onChange={event => { if (event.target.value !== "custom") setPercentText(event.target.value); }}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PRESET_PERCENTAGES.map(percent => <option key={percent} value={percent}>{percent}%</option>)}
            <option value="custom">{navigationText('Custom percentage',language)}</option>
          </select>
          <label className="block text-xs font-semibold" htmlFor={`${id}-percent`}>{navigationText('Custom zoom percentage',language)}</label>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-percent`}
              type="number"
              inputMode="numeric"
              min={MIN_DISPLAY_ZOOM_PERCENT}
              max={MAX_DISPLAY_ZOOM_PERCENT}
              step={5}
              value={percentText}
              onChange={event => setPercentText(event.target.value)}
              aria-describedby={`${id}-hint`}
              className="min-h-11 min-w-0 w-full rounded-lg border border-input bg-background px-2 py-2 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-sm text-light-text">%</span>
          </div>
          <p id={`${id}-hint`} className={cn("text-[11px]", percentValid ? "text-light-text" : "text-destructive")}>
            {language === 'es' ? `Escribe un porcentaje entre ${MIN_DISPLAY_ZOOM_PERCENT}% y ${MAX_DISPLAY_ZOOM_PERCENT}%.`
              : language === 'it' ? `Digita una percentuale tra ${MIN_DISPLAY_ZOOM_PERCENT}% e ${MAX_DISPLAY_ZOOM_PERCENT}%.`
              : language === 'ur' ? `${MIN_DISPLAY_ZOOM_PERCENT}% سے ${MAX_DISPLAY_ZOOM_PERCENT}% تک کوئی بھی فیصد درج کریں۔`
              : `Type any percentage from ${MIN_DISPLAY_ZOOM_PERCENT}% to ${MAX_DISPLAY_ZOOM_PERCENT}%.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={apply} disabled={!percentValid} className="min-h-11 min-w-11 flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50">{navigationText('Okay',language)}</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 min-w-11 flex-1 rounded-lg border border-input px-3 py-2 text-xs font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">{navigationText('Cancel',language)}</button>
          </div>
        </div>
      )}
    </div>
  );
}
