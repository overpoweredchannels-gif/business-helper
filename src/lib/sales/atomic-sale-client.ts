import type { SupabaseClient } from "@supabase/supabase-js";

export type AtomicSaleInput = {
  customer_id: string;
  sale_date: string;
  payment_type: "cash" | "credit";
  invoice_discount: number;
  invoice_discount_type: "flat" | "percent";
  tax_rate: number;
  cash_received: number | null;
  credit_override_confirmed: boolean;
  lines: Array<{
    product_id: string;
    quantity: number;
    selling_price: number;
    discount: number;
    bonus: number;
    unit_mode: "main" | "subunit";
  }>;
};

export type AtomicSaleResult = {
  transaction: Record<string, unknown>;
  customer_name: string;
  items: Array<Record<string, unknown>>;
  replayed: boolean;
};

type PendingSale = { requestId: string; input: AtomicSaleInput };
type SaleStatus = { status: "unknown" | "confirmed"; result?: AtomicSaleResult };

const storageKey = (scope: string) => `tradeos:pending-sale:v1:${scope}`;
const clearPending = (scope: string) => {
  try { window.localStorage.removeItem(storageKey(scope)); } catch { /* Replaying a confirmed request is safe. */ }
};

export function readPendingAtomicSale(scope: string): PendingSale | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(storageKey(scope));
  return stored ? JSON.parse(stored) as PendingSale : null;
}

const sameSale = (a: AtomicSaleInput, b: AtomicSaleInput) => {
  return JSON.stringify({ ...a, credit_override_confirmed: false }) ===
    JSON.stringify({ ...b, credit_override_confirmed: false });
};

async function readSaleStatus(supabase: SupabaseClient, requestId: string) {
  try {
    return await supabase.rpc("get_sales_invoice_request_status", { p_request_id: requestId }) as unknown as {
      data: SaleStatus | null;
      error: { code?: string; message?: string } | null;
    };
  } catch {
    return { data: null, error: { message: "Request status could not be reached" } };
  }
}

export async function createAtomicSale(
  supabase: SupabaseClient,
  scope: string,
  input: AtomicSaleInput,
): Promise<{ result: AtomicSaleResult; previousPendingConfirmed: boolean }> {
  const pending = readPendingAtomicSale(scope);
  if (pending && !sameSale(pending.input, input)) {
    const status = await readSaleStatus(supabase, pending.requestId);
    if (status.error) throw new Error("An earlier sale is still being checked. Your basket is saved; retry after reconnecting.");
    if (status.data?.status !== "confirmed" || !status.data.result) {
      throw new Error("An earlier sale is unresolved. Reload to restore its saved basket, then retry that sale before starting another.");
    }
    clearPending(scope);
    return { result: status.data.result, previousPendingConfirmed: true };
  }

  const attempt = pending ?? { requestId: crypto.randomUUID(), input };
  if (!pending) window.localStorage.setItem(storageKey(scope), JSON.stringify(attempt));

  let data: AtomicSaleResult | null = null;
  let error: { code?: string; message?: string } | null = null;
  try {
    ({ data, error } = await supabase.rpc("create_sales_invoice_atomic", {
      p_request_id: attempt.requestId,
      p_input: attempt.input,
    }) as unknown as { data: AtomicSaleResult | null; error: { code?: string; message?: string } | null });
  } catch (caught) {
    error = { message: caught instanceof Error ? caught.message : "Sale request connection failed" };
  }

  if (!error && data?.transaction) {
    clearPending(scope);
    return { result: data, previousPendingConfirmed: false };
  }

  const status = await readSaleStatus(supabase, attempt.requestId);
  if (!status.error && status.data?.status === "confirmed" && status.data.result) {
    clearPending(scope);
    return { result: status.data.result, previousPendingConfirmed: false };
  }

  if (!status.error && /^[0-9A-Z]{5}$/.test(error?.code ?? "")) {
    clearPending(scope);
    throw new Error(error?.message || "Sale was rejected. Correct the sale details and try again.");
  }

  throw new Error("Sale status could not be confirmed. Your basket and request are saved; retry to reconcile the same sale.");
}
