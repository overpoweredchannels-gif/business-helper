import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import { purchaseCloudFetch } from "@/lib/desktop/cloud-endpoint";
import { isDesktopApp, isNetworkError } from "@/lib/offline/identity-cache";
import type { PurchaseItemRecord, PurchaseTransactionRecord } from "./repositories/purchase-repository";

const pendingRequests = new Map<string, string>();

/** A purchase-save failure carrying the HTTP status and the request key it used. */
export type PurchaseSaveError = Error & { status?: number; requestKey?: string };

/**
 * HYBRID Slice 4 — park this save locally instead of losing it?
 *
 * Desktop only. A network failure parks (as before); a server 5xx parks
 * too — the server never confirmed the purchase, so the local row can
 * still sync it exactly once with the same key. A definitive refusal
 * (4xx: validation, fingerprint mismatch, forbidden) is a real error
 * and is never parked — retrying it with the same key can never succeed.
 */
export function shouldParkPurchaseSaveError(error: unknown): boolean {
  if (!isDesktopApp()) return false;
  if (isNetworkError(error)) return true;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}

/** Retain the same key after an uncertain network outcome, so retry cannot double stock. */
export async function createPurchase(input: Record<string, unknown>) {
  const fingerprint = JSON.stringify(input);
  let key = typeof input.request_key === "string" ? input.request_key : pendingRequests.get(fingerprint);
  if (!key) {
    key = crypto.randomUUID();
    pendingRequests.set(fingerprint, key);
  }
  // Slice 4 — on desktop the POST goes to the Vercel endpoint with the
  // user's Bearer token (purchaseCloudFetch); the local standalone
  // server has no service key and would 500 every online save. The
  // web build keeps the relative authorizedFetch exactly as before.
  const fetchImpl = isDesktopApp() ? purchaseCloudFetch : authorizedFetch;
  const response = await fetchImpl("/api/purchases", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, request_key: key }),
  });
  // Slice 4 — a 500 error page is not JSON: never let a parse failure
  // hide the status the caller needs to decide park-vs-error.
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !data.transaction) {
    const error = new Error(
      typeof data.error === "string" && data.error
        ? data.error
        : "Purchase could not be saved. Please retry.",
    ) as PurchaseSaveError;
    error.status = response.status;
    error.requestKey = key;
    throw error;
  }
  pendingRequests.delete(fingerprint);
  return data as { transaction: PurchaseTransactionRecord; items: PurchaseItemRecord[]; purchase_order_status?: string };
}
