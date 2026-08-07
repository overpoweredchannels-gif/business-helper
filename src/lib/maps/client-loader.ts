"use client";
// Client-side Google Maps loader for interactive map components (territory map
// picker, route builder). Loads the Maps JS API with the Places + Geometry
// libraries once per browser session and caches the loading promise so multiple
// components never inject duplicate <script> tags.

let googleMapPromise: Promise<any> | null = null;
let lastKey: string | null = null;

declare global {
  interface Window {
    google: any;
  }
}

function getApiKey(): string {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined;
  return (key ?? "").trim();
}

function loadOnce(key: string): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google && window.google.maps) return Promise.resolve(window.google);
  if (googleMapPromise && lastKey === key) return googleMapPromise;

  lastKey = key;
  const callbackName = `__tradeosMaps_${Date.now()}`;

  googleMapPromise = new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured."));
      return;
    }
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      if (window.google && window.google.maps) {
        resolve(window.google);
      } else {
        reject(new Error("Google Maps loaded but the maps library is unavailable."));
      }
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key,
    )}&libraries=places,geometry&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete (window as any)[callbackName];
      reject(new Error("Failed to load Google Maps. Check your API key and network."));
    };
    document.head.appendChild(script);
  });

  return googleMapPromise;
}

export async function getGoogleMaps(): Promise<any> {
  const key = getApiKey();
  if (!key) return null;
  try {
    return await loadOnce(key);
  } catch {
    return null;
  }
}