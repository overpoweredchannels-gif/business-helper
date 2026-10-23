// Receipt template loading with a bounded settle guarantee.
//
// The POS receipt dialog used to await the print-templates fetch with no
// timeout anywhere in the chain (supabase.auth.getSession() inside
// authorizedFetch, then fetch — neither has a default timeout). If that
// promise stalled, the dialog sat on "Loading receipt template…" forever:
// the paper-width switch and Print stayed disabled, because templateReady
// only flipped when the fetch settled. This loader ALWAYS resolves —
// with the org's saved template when the fetch answers, and with the
// built-in default on empty / error / timeout — so the dialog can never
// wait indefinitely. Extracted from POSReceipt.tsx so the settle contract
// is unit-testable without a browser.

import type { PrintTemplate } from "@/lib/print/print-template-types";
import { normalizeReceiptWidthMm } from "@/lib/print/retail-receipt";

export type ReceiptTemplateLoadResult =
  | { status: "loaded"; template: PrintTemplate }
  | { status: "defaulted"; reason: "empty" | "error" | "timeout"; template: PrintTemplate };

export interface ReceiptTemplateLoaderOptions {
  /** Performs the fetch and resolves with the parsed JSON body. Receives
   * an AbortSignal that fires when the timeout wins the race. */
  fetchJson: (signal: AbortSignal) => Promise<unknown>;
  /** Built-in fallback template (a fresh clone is returned, never this
   * object, so callers cannot mutate the shared default). */
  defaultTemplate: PrintTemplate;
  /** Hard bound on the wait. Default 8000ms. */
  timeoutMs?: number;
}

export const RECEIPT_TEMPLATE_LOAD_TIMEOUT_MS = 8000;

export async function loadReceiptTemplate(
  options: ReceiptTemplateLoaderOptions
): Promise<ReceiptTemplateLoadResult> {
  const timeoutMs = options.timeoutMs ?? RECEIPT_TEMPLATE_LOAD_TIMEOUT_MS;
  const fallback = (): PrintTemplate => ({ ...options.defaultTemplate });
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
      options.fetchJson(controller.signal).then(
        (data) => ({ kind: "data" as const, data }),
        () => ({ kind: "error" as const })
      ),
      timeout.then((kind) => ({ kind })),
    ]);
    if (outcome.kind === "timeout") {
      return { status: "defaulted", reason: "timeout", template: fallback() };
    }
    if (outcome.kind === "error") {
      return { status: "defaulted", reason: "error", template: fallback() };
    }
    const templates = (outcome.data as { templates?: unknown } | null)?.templates;
    const selected = Array.isArray(templates)
      ? (templates as { is_default?: boolean; config?: PrintTemplate }[]).find((item) => item?.is_default)
      : undefined;
    if (!selected?.config) {
      return { status: "defaulted", reason: "empty", template: fallback() };
    }
    return {
      status: "loaded",
      template: {
        ...fallback(),
        ...selected.config,
        receiptWidthMm: normalizeReceiptWidthMm(selected.config.receiptWidthMm),
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

