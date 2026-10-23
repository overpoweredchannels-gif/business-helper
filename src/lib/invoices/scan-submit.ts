import { findBarcodeProduct, type BarcodeProduct } from "./barcode";

// The single submit choke point for scanned codes (BUG 1).
//
// Every way a barcode can reach a sales basket — the barcode box's
// auto-detect timer, its Enter key / button, the POS global wedge capture,
// and Enter in a find-product box on either sales surface — submits through
// a ScanSubmitter. Before this module each channel had its own semantics:
// the barcode box guarded only itself, the find-product box fell through to
// fuzzy suggestion selection when exact match failed (silently adding a
// prefix/substring stranger), and nothing deduplicated across channels.
//
// The contract enforced here:
//   * Exact match or nothing. A submitted code either resolves to exactly
//     one active product or is rejected as not-found; no channel may turn a
//     failed lookup into a near-match add.
//   * One physical scan adds once. The same normalized code re-submitted
//     within SCAN_DEDUPE_WINDOW_MS of an ACCEPTED submission is a duplicate
//     trigger (a second channel firing for the same scan), not a new unit.
//   * Rejections never poison. A not-found submission leaves no marker, so
//     re-scanning the same code is always tried fresh.

export const SCAN_DEDUPE_WINDOW_MS = 800;

/**
 * Barcode-shaped text: long enough to be a code (>= 6 chars), a single
 * token (no whitespace — product names have spaces), and digit-heavy
 * (>= 80% digits; real barcodes are overwhelmingly numeric, and letter
 * tails like a check character still pass). Used to decide when Enter in a
 * search box must behave like a scan (exact-match-or-error) instead of a
 * name search (top suggestion wins).
 */
export function isBarcodeShaped(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 6 || /\s/.test(value)) return false;
  let digits = 0;
  for (const char of value) if (char >= "0" && char <= "9") digits += 1;
  return digits / value.length >= 0.8;
}

/** True when the code resolves to exactly one active product. Never throws. */
export function hasExactBarcodeMatch<T extends BarcodeProduct>(products: T[], raw: string): boolean {
  try {
    findBarcodeProduct(products, raw);
    return true;
  } catch {
    return false;
  }
}

export type ScanSubmitResult<T extends BarcodeProduct> =
  | { status: "added"; product: T }
  | { status: "duplicate"; product: T }
  | { status: "not-found"; code: string; message: string };

export interface ScanSubmitter {
  /**
   * Resolve a scanned code against the catalogue. "added" accepts the code
   * and arms the dedupe window; "duplicate" means the same code was already
   * accepted inside the window (the product is still returned so callers
   * can focus its line); "not-found" rejects without arming anything.
   */
  submit<T extends BarcodeProduct>(raw: string, products: T[]): ScanSubmitResult<T>;
  /**
   * Exact-match lookup with no side effects (no dedupe marker read or
   * written). Used by scanner auto-detect: a partial burst must not submit,
   * and probing one must not block the completed scan that follows.
   */
  probe<T extends BarcodeProduct>(raw: string, products: T[]): T | null;
}

export function createScanSubmitter(options?: { windowMs?: number; now?: () => number }): ScanSubmitter {
  const windowMs = options?.windowMs ?? SCAN_DEDUPE_WINDOW_MS;
  const now = options?.now ?? Date.now;
  let lastAccepted: { key: string; at: number } | null = null;
  const keyOf = (raw: string) => raw.trim().toLowerCase();
  return {
    submit(raw, products) {
      let product;
      try {
        product = findBarcodeProduct(products, raw);
      } catch (error) {
        return {
          status: "not-found",
          code: raw.trim(),
          message: error instanceof Error ? error.message : "No active product has that barcode.",
        };
      }
      const key = keyOf(raw);
      const at = now();
      if (lastAccepted && lastAccepted.key === key && at - lastAccepted.at < windowMs) {
        return { status: "duplicate", product };
      }
      lastAccepted = { key, at };
      return { status: "added", product };
    },
    probe(raw, products) {
      try {
        return findBarcodeProduct(products, raw);
      } catch {
        return null;
      }
    },
  };
}
