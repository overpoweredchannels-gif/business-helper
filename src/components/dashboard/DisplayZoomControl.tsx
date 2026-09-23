"use client";

import { useEffect, useState } from "react";
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

export function DisplayZoomControl({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [percentText, setPercentText] = useState(String(displayZoomPercent(DEFAULT_DISPLAY_ZOOM)));
  const [applied, setApplied] = useState<number>(DEFAULT_DISPLAY_ZOOM);

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
        aria-expanded={open}
        aria-label="Screen zoom"
        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-light-text hover:text-foreground hover:bg-muted transition-colors"
      >
        <ZoomIn className="size-3.5" />
        {!collapsed && <span>Screen zoom</span>}
        {!collapsed && <span className="ml-auto text-muted-foreground">{formatDisplayZoom(applied)}</span>}
      </button>
      {open && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <label className="block text-xs font-medium" htmlFor="display-zoom-ratio">Suggested zoom ratio</label>
          <select
            id="display-zoom-ratio"
            value={DISPLAY_ZOOM_PRESETS.includes(typedPercent as (typeof DISPLAY_ZOOM_PRESETS)[number]) ? String(typedPercent) : "custom"}
            onChange={event => { if (event.target.value !== "custom") setPercentText(event.target.value); }}
            className="w-full rounded border border-border px-2 py-2 text-sm"
          >
            {DISPLAY_ZOOM_PRESETS.map(step => <option key={step} value={step}>{formatDisplayZoom(step)}</option>)}
            <option value="custom">Custom percentage</option>
          </select>
          <label className="block text-xs font-medium" htmlFor="display-zoom-percent">Custom zoom percentage</label>
          <div className="flex items-center gap-2">
            <input
              id="display-zoom-percent"
              type="number"
              inputMode="numeric"
              min={MIN_DISPLAY_ZOOM_PERCENT}
              max={MAX_DISPLAY_ZOOM_PERCENT}
              step={5}
              value={percentText}
              onChange={event => setPercentText(event.target.value)}
              aria-describedby="display-zoom-hint"
              className="w-full rounded border border-border px-2 py-2 text-sm"
            />
            <span className="text-sm text-light-text">%</span>
          </div>
          <p id="display-zoom-hint" className={cn("text-[11px]", percentValid ? "text-light-text" : "text-destructive")}>
            Type any percentage from {MIN_DISPLAY_ZOOM_PERCENT}% to {MAX_DISPLAY_ZOOM_PERCENT}%.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={apply} disabled={!percentValid} className="min-h-9 flex-1 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Okay</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 flex-1 rounded border border-border px-3 py-2 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
