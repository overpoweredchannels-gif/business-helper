/**
 * Slice 5 (HYBRID) — Walk-in customer LOCAL seed (B7 fix).
 *
 * The desktop build has no service key, so `POST /api/sales/walk-in`
 * on the local standalone server 500s ("Could not prepare the Walk-in
 * customer") and a POS quick sale cannot start without a manual
 * customer pick. The desktop now stops calling that route entirely:
 * it upserts the deterministic Walk-in row LOCALLY, with the same row
 * identity the server route would create.
 *
 * Row identity (must match `src/app/api/sales/walk-in/route.ts`
 * exactly): SHA-256 of `tradeos:walk-in:${organizationId}`, formatted
 * as a UUID (version 5, variant `a`). The hash is a vendored pure-TS
 * SHA-256 — the browser bundle cannot use `node:crypto`, and
 * `crypto.subtle` needs a secure context and is async; this is sync,
 * deterministic, and verified against `node:crypto` in
 * `scripts/test-walk-in-local-seed.ts`.
 *
 * Sync discipline — the seed is a normal pending local-customer row,
 * so it drains through the EXISTING customer sync (first in the
 * engine order, before sales — customers are parents):
 * - the server Walk-in row already exists → the drain's existence
 *   check reconciles with NO customer write and the local seed is
 *   removed (no duplicate, no second row);
 * - it does not exist yet → the drain creates exactly the row the
 *   walk-in route would create (same id, same fields) via the normal
 *   `POST /api/customers` create, and only then can a Walk-in sale
 *   sync — the sale RPC raises "Customer is unavailable in this
 *   organization" for a missing customer, so a seed that never
 *   reached the server would park every Walk-in sale.
 * The seed is therefore never a *separate* customer: it is the
 * canonical Walk-in row, and the server never ends up with two of
 * them (the id is the dedup key on both sides).
 *
 * Display discipline — the seed is a FALLBACK in the customer list,
 * never an override: when the server list already holds the Walk-in
 * row (e.g. the owner deactivated it), the server row wins, so the
 * UI shows the truth instead of masking it with the active seed.
 */

import {
  getLocalCustomersBackend,
  mergeLocalCustomers,
  type LocalCustomerRow,
} from "@/lib/offline/local-customers";
import type { Customer } from "@/lib/tradeos/types";

/** The customer name the server route uses for the Walk-in row. */
export const WALK_IN_CUSTOMER_NAME = "Walk-in customer";

/**
 * The exact upsert payload of `POST /api/sales/walk-in` (minus `id` /
 * `organization_id`, which the seed adds). Keep in sync with the route.
 */
export const WALK_IN_CUSTOMER_FIELDS = {
  customer_name: "Walk-in customer",
  customer_type: "Retailer",
  credit_policy: "cash_only",
  is_active: true,
  visit_frequency: "none",
  priority: "medium",
} as const;

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), pure TypeScript over TextEncoder bytes.
// ---------------------------------------------------------------------------

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const bitLength = data.length * 8;
  // Pad to a multiple of 64 bytes: 0x80, zeros, then the 64-bit length.
  // (The high 32 bits of the length stay zero — an org id is never
  // anywhere near 2^32 bits long.)
  const paddedLength = (((data.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  new DataView(padded.buffer).setUint32(paddedLength - 4, bitLength >>> 0);
  const view = new DataView(padded.buffer);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t += 1) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + ch + SHA256_K[t] + w[t]) | 0;
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/**
 * The deterministic Walk-in customer id for an org — byte-identical to
 * the server route's `createHash("sha256").update("tradeos:walk-in:" +
 * organizationId)` + UUID formatting (version 5, variant `a`).
 */
export function walkInCustomerIdForOrganization(organizationId: string): string {
  const hash = sha256Hex(`tradeos:walk-in:${organizationId}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** The Walk-in customer record as the POS customer list holds it. */
export function walkInCustomerRecord(organizationId: string): Customer & { organization_id: string } {
  return {
    id: walkInCustomerIdForOrganization(organizationId),
    organization_id: organizationId,
    customer_name: WALK_IN_CUSTOMER_FIELDS.customer_name,
    shop_name: null,
    organization_name: null,
    contact_person: null,
    phone: null,
    whatsapp: null,
    city: null,
    area: null,
    address: null,
    shipping_address: null,
    customer_type: WALK_IN_CUSTOMER_FIELDS.customer_type,
    credit_policy: WALK_IN_CUSTOMER_FIELDS.credit_policy,
    credit_limit: null,
    credit_days: null,
    allow_over_limit: null,
    allow_overdue_sales: null,
    preferred_payment_method: null,
    is_active: WALK_IN_CUSTOMER_FIELDS.is_active,
    notes: null,
    latitude: null,
    longitude: null,
    assigned_salesman_id: null,
    assigned_territory_id: null,
    visit_frequency: WALK_IN_CUSTOMER_FIELDS.visit_frequency,
    priority: WALK_IN_CUSTOMER_FIELDS.priority,
  };
}

/** True when a local-customer row is the Walk-in seed for this org. */
export function isWalkInSeedRow(row: LocalCustomerRow, organizationId: string): boolean {
  return row.id === walkInCustomerIdForOrganization(organizationId) && row.kind === "create";
}

/** A new Walk-in seed row: deterministic id, kind "create", pending. */
export function newWalkInCustomerSeedRow(organizationId: string): LocalCustomerRow {
  const now = new Date().toISOString();
  const record = walkInCustomerRecord(organizationId);
  return {
    id: record.id,
    kind: "create",
    data: record as unknown as Record<string, unknown>,
    idempotencyKey: crypto.randomUUID(),
    synced: 0,
    serverId: null,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Upsert the Walk-in seed into the local-customer store for a scope
 * (`orgId:profileId`, same scope as every other local row). Never
 * overwrites an existing row for the id — a user edit of the Walk-in
 * customer stays an edit and keeps its own data. No network call.
 */
export async function ensureWalkInCustomerSeed(
  scope: string,
  organizationId: string,
): Promise<LocalCustomerRow> {
  const backend = getLocalCustomersBackend();
  const seedId = walkInCustomerIdForOrganization(organizationId);
  const existing = (await backend.list(scope)).find((row) => row.id === seedId);
  if (existing) return existing;
  return backend.upsert(scope, newWalkInCustomerSeedRow(organizationId));
}

/**
 * Merge local customers into a fetched server list (desktop read path),
 * with the Walk-in seed as a FALLBACK, never an override: the seed row
 * is kept out of `mergeLocalCustomers` (which lets local rows win per
 * id), and the pure seed record is appended only when neither the
 * server rows nor a local edit already hold the Walk-in id — so a
 * server Walk-in row (e.g. deactivated by the owner) is shown as it
 * is, and a user edit of the Walk-in customer keeps winning.
 */
export function mergeLocalCustomersWithWalkInSeed(
  serverRows: Customer[],
  localRows: LocalCustomerRow[],
  organizationId: string,
): Customer[] {
  const seedId = walkInCustomerIdForOrganization(organizationId);
  const nonSeedLocal = localRows.filter(
    (row) => row.id !== seedId || row.kind !== "create",
  );
  const merged = mergeLocalCustomers(serverRows, nonSeedLocal);
  if (merged.some((row) => String(row.id) === seedId)) return merged;
  const next = [...merged, walkInCustomerRecord(organizationId)];
  next.sort((a, b) => String(a.customer_name ?? "").localeCompare(String(b.customer_name ?? "")));
  return next;
}
