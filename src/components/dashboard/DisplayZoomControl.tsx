"use client";

import { useEffect, useState } from "react";
import { ZoomIn } from "lucide-react";
import {
  DEFAULT_DISPLAY_ZOOM,
  DISPLAY_ZOOM_STEPS,
  applyDisplayZoom,
  formatDisplayZoom,
  readDisplayZoom,
  saveDisplayZoom,
  type DisplayZoom,
} from "@/lib/preferences/display-zoom";

export function DisplayZoomControl({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DisplayZoom>(DEFAULT_DISPLAY_ZOOM);
  const [applied, setApplied] = useState<DisplayZoom>(DEFAULT_DISPLAY_ZOOM);

  useEffect(() => {
    // The preferred ratio lives in this browser, so it is read once after mount
    // instead of during render (which would not match the server markup).
    const saved = readDisplayZoom();
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(saved);
    setApplied(saved);
    /* eslint-enable react-hooks/set-state-in-effect */
    applyDisplayZoom(saved);
  }, []);

  const apply = () => {
    setApplied(saveDisplayZoom(draft));
    setOpen(false);
  };

  return (
    <div data-context-help-skip className="space-y-1">
      <button
        type="button"
        onClick={() => { setDraft(applied); setOpen(value => !value); }}
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
          <label className="block text-xs font-medium" htmlFor="display-zoom-ratio">Zoom ratio</label>
          <select
            id="display-zoom-ratio"
            value={draft}
            onChange={event => setDraft(Number(event.target.value) as DisplayZoom)}
            className="w-full rounded border border-border px-2 py-2 text-sm"
          >
            {DISPLAY_ZOOM_STEPS.map(step => <option key={step} value={step}>{formatDisplayZoom(step)}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={apply} className="min-h-9 flex-1 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Okay</button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 flex-1 rounded border border-border px-3 py-2 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
