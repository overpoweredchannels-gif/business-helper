import assert from "node:assert/strict";
import { addBarcodeLine, addScannedLine, type BarcodeLine, type BarcodeProduct } from "../src/lib/invoices/barcode";
import {
  createScanSubmitter,
  hasExactBarcodeMatch,
  isBarcodeShaped,
  SCAN_DEDUPE_WINDOW_MS,
  type ScanSubmitResult,
} from "../src/lib/invoices/scan-submit";
import { rankProductMatch } from "../src/lib/products/search-rank";

// Fixtures are shaped like the product rows the sales surfaces hand to the
// barcode helpers (id, name, barcode, unit fields, default price) — the
// catalogue behind the Spain customer's counter (BUG 1, 2026-10-23):
//   - a lollipop with a full EAN-13,
//   - a "stranger" whose barcode merely STARTS WITH the digits of a shorter
//     in-store code (the prefix hazard behind the wrong-product adds),
//   - a pack product sold both as a box and as single pieces.

const lollipop: BarcodeProduct = {
  id: "prod-lollipop",
  name: "Lollipop Fresa",
  barcode: "8412345678901",
  is_active: true,
  unit_type: "Piece",
  subunit_type: null,
  units_per_pack: null,
  default_selling_price: 25,
};
const stranger: BarcodeProduct = {
  id: "prod-stranger",
  name: "Stranger Cola 1L",
  barcode: "123456789012",
  is_active: true,
  unit_type: "Bottle",
  subunit_type: null,
  units_per_pack: null,
  default_selling_price: 120,
};
const colaPack: BarcodeProduct = {
  id: "prod-cola-pack",
  name: "Cola Cans x12",
  barcode: "5449000000996",
  is_active: true,
  unit_type: "Box",
  subunit_type: "Can",
  units_per_pack: 12,
  default_selling_price: 600,
};
const lateProduct: BarcodeProduct = {
  id: "prod-late",
  name: "Late Arrival Gum",
  barcode: "9999999999999",
  is_active: true,
  unit_type: "Piece",
  subunit_type: null,
  units_per_pack: null,
  default_selling_price: 10,
};
const catalogue = [lollipop, stranger, colaPack];

const makeSubmitter = () => {
  let now = 1_000_000;
  return {
    submitter: createScanSubmitter({ now: () => now }),
    advance: (ms: number) => { now += ms; },
  };
};

// The basket-side half of the parent wiring (page.tsx runSalesScan): only
// an "added" result may touch the lines, via the scan merge.
const applyScan = (lines: BarcodeLine[], result: ScanSubmitResult<BarcodeProduct>, mode: "main" | "subunit"): BarcodeLine[] =>
  result.status === "added" ? addScannedLine(lines, result.product, mode) : lines;

// ── Barcode-shape predicate (gates the search-box Enter fallback) ──────────

assert.equal(isBarcodeShaped("8412345678901"), true, "A full EAN-13 is barcode-shaped");
assert.equal(isBarcodeShaped("123456"), true, "A short in-store code is barcode-shaped");
assert.equal(isBarcodeShaped("  8412345678901  "), true, "Surrounding whitespace is ignored");
assert.equal(isBarcodeShaped("orbit menta"), false, "A product name with a space is a search, not a scan");
assert.equal(isBarcodeShaped("coca cola 500ml"), false, "Multi-word text is a search, not a scan");
assert.equal(isBarcodeShaped("12345"), false, "Under 6 chars is not treated as a code");
assert.equal(isBarcodeShaped("ABC12345"), false, "Mostly-letter SKUs stay searchable text");
assert.equal(isBarcodeShaped(""), false);

// ── (i) Scan lands in the find-product box; the code fails exact match but
//        prefix-matches another product → nothing is added, error surfaces ──

// The hazard is real in the ranker: the short code prefix-matches the
// stranger at rank 3, so the old Enter fallback silently chose it.
assert.equal(
  rankProductMatch({ name: stranger.name, barcode: stranger.barcode }, "123456"),
  3,
  "Control: the short code really does prefix-rank the stranger product"
);
{
  const { submitter } = makeSubmitter();
  let lines: BarcodeLine[] = [];
  const result = submitter.submit("123456", catalogue);
  assert.equal(result.status, "not-found", "A prefix-only code must be rejected, never fuzzy-added");
  if (result.status === "not-found") {
    assert.match(result.message, /123456/, "The error names the scanned code");
  }
  lines = applyScan(lines, result, "main");
  assert.equal(lines.length, 0, "Nothing enters the basket for an unmatched code");
  assert.equal(isBarcodeShaped("123456"), true, "…and the search box must block its fuzzy fallback for this shape");
}

// ── (ii) Auto-detect partial burst → no submit, and probing arms nothing ───

{
  const { submitter } = makeSubmitter();
  assert.equal(submitter.probe("8412345", catalogue), null, "A mid-burst prefix is not an exact match");
  assert.equal(hasExactBarcodeMatch(catalogue, "8412345"), false);
  assert.equal(hasExactBarcodeMatch(catalogue, "8412345678901"), true);
  const completed = submitter.submit("8412345678901", catalogue);
  assert.equal(completed.status, "added", "Probing the partial code must not dedupe the completed scan");
}

// ── (iii) One physical scan, two channels fire → exactly one line, qty 1 ──

{
  const { submitter, advance } = makeSubmitter();
  let lines: BarcodeLine[] = [];
  const first = submitter.submit("8412345678901", catalogue);
  assert.equal(first.status, "added");
  lines = applyScan(lines, first, "main");
  advance(120); // the second channel (box Enter after wedge capture) fires
  const second = submitter.submit("8412345678901", catalogue);
  assert.equal(second.status, "duplicate", "The same code inside the window is one scan, not two");
  lines = applyScan(lines, second, "main");
  assert.equal(lines.length, 1, "Exactly one basket line");
  assert.equal(lines[0].quantity, "1", "Quantity stays 1 — no double add across channels");
  if (second.status === "duplicate") {
    assert.equal(second.product.id, "prod-lollipop", "A duplicate still resolves the product so the caller can focus its line");
  }
  // Normalization: the same code with different case/spacing is the same scan.
  const padded = submitter.submit("  8412345678901 ", catalogue);
  assert.equal(padded.status, "duplicate", "Dedupe keys on the normalized code");
  // A different product inside the window is NOT a duplicate.
  const other = submitter.submit("5449000000996", catalogue);
  assert.equal(other.status, "added", "Dedupe is per-code, not a global lockout");
}

// ── (iv) A failed scan never poisons the next scan of the same code ────────

{
  const { submitter, advance } = makeSubmitter();
  const failed = submitter.submit("9999999999999", catalogue);
  assert.equal(failed.status, "not-found", "Unknown code is rejected while the product is missing");
  advance(100); // the cashier rescans immediately — inside any window
  const retried = submitter.submit("9999999999999", [...catalogue, lateProduct]);
  assert.equal(retried.status, "added", "Once the product exists, the rescan adds — the failure left no marker");
  const stillUnknown = submitter.submit("8888888888888", catalogue);
  const stillUnknownAgain = submitter.submit("8888888888888", catalogue);
  assert.equal(stillUnknown.status, "not-found");
  assert.equal(stillUnknownAgain.status, "not-found", "Repeated failures stay failures, never 'duplicate'");
}

// ── (v) Two genuine scans of the same product → qty 2 on ONE line ──────────

{
  const { submitter, advance } = makeSubmitter();
  let lines: BarcodeLine[] = [];
  const first = submitter.submit("8412345678901", catalogue);
  assert.equal(first.status, "added");
  lines = applyScan(lines, first, "main");
  advance(SCAN_DEDUPE_WINDOW_MS + 100); // a real second presentation of the item
  const second = submitter.submit("8412345678901", catalogue);
  assert.equal(second.status, "added", "Outside the window the same code is a genuine second unit");
  lines = applyScan(lines, second, "main");
  assert.equal(lines.length, 1, "Both units live on one line");
  assert.equal(lines[0].quantity, "2");
  assert.equal(lines[0].product_id, "prod-lollipop");
}

// ── (vi) Pack product scanned under different ambient modes → one line ─────

{
  const { submitter, advance } = makeSubmitter();
  let lines: BarcodeLine[] = [];
  const piece = submitter.submit("5449000000996", catalogue);
  assert.equal(piece.status, "added");
  lines = applyScan(lines, piece, "subunit");
  advance(SCAN_DEDUPE_WINDOW_MS + 100);
  const box = submitter.submit("5449000000996", catalogue);
  assert.equal(box.status, "added");
  lines = applyScan(lines, box, "main");
  assert.equal(lines.length, 1, "Scan adds merge on the product alone — the ambient mode cannot split the line");
  assert.equal(lines[0].quantity, "2");
  assert.equal(lines[0].unit_mode, "subunit", "The existing line keeps its own mode; only its quantity grows");

  // Control: the legacy (product, mode) merge used by manual adds really
  // does split — the exact behaviour the scan path no longer uses.
  let manual: BarcodeLine[] = [];
  manual = addBarcodeLine(manual, colaPack, "subunit");
  manual = addBarcodeLine(manual, colaPack, "main");
  assert.equal(manual.length, 2, "Control: addBarcodeLine still splits on mode for explicit manual adds");
}

console.log(
  "POS scan choke-point tests passed: prefix-only codes are rejected (never fuzzy-added), partial bursts probe clean, cross-channel double-fires dedupe to one line/qty 1, failed scans never poison rescans, genuine rescans reach qty 2 on one line, and scan adds merge on the product alone across ambient modes."
);
