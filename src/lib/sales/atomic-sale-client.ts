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
const clearPending = (scope: string, requestId: string) => {
  try {
    const key = storageKey(scope);
    const current = window.localStorage.getItem(key);
    if (current && (JSON.parse(current) as PendingSale).requestId === requestId) {
      window.localStorage.removeItem(key);
    }
  } catch { /* Replaying a confirmed request is safe. */ }
};

export function readPendingAtomicSale(scope: string): PendingSale | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(storageKey(scope));
  return stored ? JSON.parse(stored) as PendingSale : null;
}

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

async function submitAtomicSale(
  supabase: SupabaseClient,
  scope: string,
  attempt: PendingSale,
  isRecovery: boolean,
): Promise<{ result: AtomicSaleResult; previousPendingConfirmed: boolean }> {
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
    clearPending(scope, attempt.requestId);
    return { result: data, previousPendingConfirmed: isRecovery };
  }

  const status = await readSaleStatus(supabase, attempt.requestId);
  if (!status.error && status.data?.status === "confirmed" && status.data.result) {
    clearPending(scope, attempt.requestId);
    return { result: status.data.result, previousPendingConfirmed: isRecovery };
  }

  if (!status.error && status.data?.status === "unknown" && /^[0-9A-Z]{5}$/.test(error?.code ?? "")) {
    clearPending(scope, attempt.requestId);
    throw new Error(error?.message || "Sale was rejected. Correct the sale details and try again.");
  }

  throw new Error("Sale status could not be confirmed. Your basket and request are saved; retry to reconcile the same sale.");
}

export async function reconcilePendingAtomicSale(
  supabase: SupabaseClient,
  scope: string,
): Promise<{ result: AtomicSaleResult; previousPendingConfirmed: true } | null> {
  const pending = readPendingAtomicSale(scope);
  if (!pending) return null;

  const status = await readSaleStatus(supabase, pending.requestId);
  if (status.error) {
    throw new Error("An earlier sale is still being checked. Your basket and request are saved; retry after reconnecting.");
  }
  if (status.data?.status === "confirmed" && status.data.result) {
    clearPending(scope, pending.requestId);
    return { result: status.data.result, previousPendingConfirmed: true };
  }
  if (status.data?.status !== "unknown") {
    throw new Error("An earlier sale is unresolved. Its saved request is preserved; retry after reconnecting.");
  }

  return submitAtomicSale(supabase, scope, pending, true);
}

export async function createAtomicSale(
  supabase: SupabaseClient,
  scope: string,
  input: AtomicSaleInput,
): Promise<{ result: AtomicSaleResult; previousPendingConfirmed: boolean }> {
  const pending = readPendingAtomicSale(scope);
  if (pending) {
    const recovered = await reconcilePendingAtomicSale(supabase, scope);
    if (recovered) return recovered;
    throw new Error("An earlier sale request changed in another window. Reload before submitting another sale.");
  }

  const attempt = { requestId: crypto.randomUUID(), input };
  window.localStorage.setItem(storageKey(scope), JSON.stringify(attempt));
  return submitAtomicSale(supabase, scope, attempt, false);
}
