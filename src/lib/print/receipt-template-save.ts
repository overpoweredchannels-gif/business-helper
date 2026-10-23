// Receipt template saving with a bounded settle guarantee.
//
// The POS receipt dialog's paper-width switch used to await the
// print-templates POST with no timeout anywhere in the chain
// (supabase.auth.getSession() inside authorizedFetch, then fetch —
// neither has a default timeout). If that promise stalled, the save
// never settled: savingWidth stayed true and the width select stayed
// disabled for the rest of the dialog's life. This helper mirrors the
// loader (receipt-template-loader.ts): it ALWAYS resolves — "saved"
// with the persisted config when the POST answers, "failed" on error /
// timeout — so the dialog always re-enables the control and can restore
// the previous width. Extracted from POSReceipt.tsx so the settle
// contract is unit-testable without a browser.

import type { PrintTemplate } from "@/lib/print/print-template-types";
import { normalizeReceiptWidthMm } from "@/lib/print/retail-receipt";

export type ReceiptTemplateSaveResult =
  | { status: "saved"; config: PrintTemplate | null }
  | { status: "failed"; reason: "timeout" | "error" };

export interface ReceiptTemplateSaveOptions {
  /** Performs the POST and resolves with the saved template config (or
   * null when the response carries none). Rejects on any failure.
   * Receives an AbortSignal that fires when the timeout wins the race. */
  post: (signal: AbortSignal) => Promise<PrintTemplate | null>;
  /** Hard bound on the wait. Default 8000ms. */
  timeoutMs?: number;
}

export const RECEIPT_TEMPLATE_SAVE_TIMEOUT_MS = 8000;

export async function saveReceiptTemplate(
  options: ReceiptTemplateSaveOptions
): Promise<ReceiptTemplateSaveResult> {
  const timeoutMs = options.timeoutMs ?? RECEIPT_TEMPLATE_SAVE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      options.post(controller.signal).then(
        (config) => ({ kind: "saved" as const, config }),
        () => ({ kind: "error" as const })
      ),
      timeout.then((kind) => ({ kind })),
    ]);
    if (outcome.kind === "timeout") {
      return { status: "failed", reason: "timeout" };
    }
    if (outcome.kind === "error") {
      return { status: "failed", reason: "error" };
    }
    return {
      status: "saved",
      config: outcome.config
        ? { ...outcome.config, receiptWidthMm: normalizeReceiptWidthMm(outcome.config.receiptWidthMm) }
        : null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
