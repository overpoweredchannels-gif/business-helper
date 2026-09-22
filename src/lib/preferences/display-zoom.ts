export const DISPLAY_ZOOM_STORAGE_KEY = "tradeos_display_zoom";
export const DISPLAY_ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export type DisplayZoom = (typeof DISPLAY_ZOOM_STEPS)[number];
export const DEFAULT_DISPLAY_ZOOM: DisplayZoom = 1;

export function normalizeDisplayZoom(value: unknown): DisplayZoom {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_DISPLAY_ZOOM;
  return DISPLAY_ZOOM_STEPS.reduce<DisplayZoom>(
    (closest, step) => (Math.abs(step - numeric) < Math.abs(closest - numeric) ? step : closest),
    DEFAULT_DISPLAY_ZOOM,
  );
}

export function formatDisplayZoom(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function readDisplayZoom(): DisplayZoom {
  try {
    return normalizeDisplayZoom(localStorage.getItem(DISPLAY_ZOOM_STORAGE_KEY));
  } catch {
    return DEFAULT_DISPLAY_ZOOM;
  }
}

export function applyDisplayZoom(value: unknown): DisplayZoom {
  const zoom = normalizeDisplayZoom(value);
  const root = document.documentElement;
  if (zoom === DEFAULT_DISPLAY_ZOOM) root.style.removeProperty("--app-zoom");
  else root.style.setProperty("--app-zoom", String(zoom));
  return zoom;
}

export function saveDisplayZoom(value: unknown): DisplayZoom {
  const zoom = normalizeDisplayZoom(value);
  try {
    localStorage.setItem(DISPLAY_ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    // Browser storage may be unavailable; the zoom still applies to this session.
  }
  return applyDisplayZoom(zoom);
}

/** Runs before first paint so a saved ratio never flashes at 100%. */
export const DISPLAY_ZOOM_BOOTSTRAP_SCRIPT = `try{var raw=localStorage.getItem("${DISPLAY_ZOOM_STORAGE_KEY}");var zoom=Number(raw);if(raw&&isFinite(zoom)&&zoom>0&&zoom!==1){document.documentElement.style.setProperty("--app-zoom",String(zoom));}}catch(error){}`;
