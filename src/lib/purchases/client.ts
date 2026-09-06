import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
import type { PurchaseItemRecord, PurchaseTransactionRecord } from "./repositories/purchase-repository";

const pendingRequests = new Map<string, string>();

/** Retain the same key after an uncertain network outcome, so retry cannot double stock. */
export async function createPurchase(input: Record<string, unknown>) {
  const fingerprint = JSON.stringify(input);
  let key = typeof input.request_key === "string" ? input.request_key : pendingRequests.get(fingerprint);
  if (!key) {
    key = crypto.randomUUID();
    pendingRequests.set(fingerprint, key);
  }
  const response = await authorizedFetch("/api/purchases", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, request_key: key }),
  });
  const data = await response.json();
  if (!response.ok || !data.transaction) throw new Error(data.error || "Purchase could not be saved. Please retry.");
  pendingRequests.delete(fingerprint);
  return data as { transaction: PurchaseTransactionRecord; items: PurchaseItemRecord[]; purchase_order_status?: string };
}
