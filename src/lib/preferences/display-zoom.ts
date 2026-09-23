export const DISPLAY_ZOOM_STORAGE_KEY = "tradeos_display_zoom";
/** Suggested ratios; any whole percentage inside the allowed range also works. */
export const DISPLAY_ZOOM_PRESETS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_DISPLAY_ZOOM_PERCENT = 50;
export const MAX_DISPLAY_ZOOM_PERCENT = 200;
export type DisplayZoom = number;
export const DEFAULT_DISPLAY_ZOOM: DisplayZoom = 1;

/** Keeps any typed percentage inside the supported range, rounded to whole percent. */
export function normalizeDisplayZoom(value: unknown): DisplayZoom {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_DISPLAY_ZOOM;
  const clamped = Math.min(MAX_DISPLAY_ZOOM_PERCENT / 100, Math.max(MIN_DISPLAY_ZOOM_PERCENT / 100, numeric));
  return Math.round(clamped * 100) / 100;
}

export function formatDisplayZoom(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** Turns a percentage typed by the user (72) into the stored ratio (0.72). */
export function displayZoomFromPercent(percent: unknown): DisplayZoom {
  const numeric = typeof percent === "number" ? percent : Number(percent);
  if (!Number.isFinite(numeric)) return DEFAULT_DISPLAY_ZOOM;
  return normalizeDisplayZoom(numeric / 100);
}

/** The whole-percent value shown back to the user for a stored ratio. */
export function displayZoomPercent(value: unknown) {
  return Math.round(normalizeDisplayZoom(value) * 100);
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
