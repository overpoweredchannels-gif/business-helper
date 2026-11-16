// Supplier list display helpers (P0-6, supplier full-field API slice).
//
// The supplier form already writes every field through the full-field API
// (src/lib/purchases/services/supplier-service.ts), but the list only
// rendered part of what it stores: the credit summary showed limit, days,
// policy and method, while the area and the two over-limit flags were
// captured by the form and stored, yet invisible anywhere except the Edit
// form. These pure helpers are the single rendering for both surfaces that
// show them — the suppliers list in src/app/page.tsx and the CSV export in
// src/lib/suppliers/export.ts — so the list and the export can never drift
// apart again.
//
// The credit summary is moved here verbatim from page.tsx (same output);
// only the over-limit summary and the credit-number guard are new.

import { formatBooksMoney } from "@/lib/tradeos/formatters";
import type { MessageKey } from "@/lib/regional/messages";
import type { Supplier } from "@/lib/tradeos/types";

export type SupplierTranslator = (key: MessageKey) => string;

// One-line credit summary for the list; unset parts show as "None", never invented.
export const supplierCreditSummary = (supplier: Supplier, t: SupplierTranslator): string => {
  const limit = supplier.credit_limit != null ? formatBooksMoney(supplier.credit_limit) : t("common.none");
  const days = supplier.credit_days != null ? `${supplier.credit_days} ${t("suppliers.creditDaysSuffix")}` : t("common.none");
  let policy = t("common.none");
  if (supplier.credit_policy === "cash_only") policy = t("page.creditCashOnly");
  if (supplier.credit_policy === "unrestricted") policy = t("page.creditUnrestricted");
  let method = t("common.none");
  if (supplier.preferred_payment_method === "cash") method = t("money.cash");
  if (supplier.preferred_payment_method === "bank") method = t("money.bank");
  if (supplier.preferred_payment_method === "card") method = t("money.card");
  if (supplier.preferred_payment_method === "cheque") method = t("money.cheque");
  return `${limit} · ${days} · ${policy} · ${method}`;
};

// Over-limit flags line. A null flag counts as "No": the form's checkbox
// defaults to unchecked, and unchecked means not allowed, so null carries
// the same effective permission as false — this renders the permission,
// it does not invent data.
export const supplierOverLimitSummary = (supplier: Supplier, t: SupplierTranslator): string => {
  const overLimit = supplier.allow_over_limit === true ? t("common.yes") : t("common.no");
  const overdue = supplier.allow_overdue_sales === true ? t("common.yes") : t("common.no");
  return `${t("suppliers.allowOverLimitLabel")}: ${overLimit} · ${t("suppliers.allowOverdueSalesLabel")}: ${overdue}`;
};

// Client-side guard for the credit number fields, mirroring the server rule
// in validateSupplierInput (finite, >= 0). Without it, a non-numeric string
// becomes NaN, JSON.stringify turns NaN into null, and the value the user
// typed is silently dropped; a negative value only fails after a server
// round-trip. Returns the message key to show, or null when both fields
// are fine. Empty means "unset" and is always fine.
export const validateSupplierCreditFields = (
  creditLimitRaw: string,
  creditDaysRaw: string,
): "suppliers.creditLimitInvalid" | "suppliers.creditDaysInvalid" | null => {
  const limit = creditLimitRaw.trim();
  if (limit !== "") {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 0) return "suppliers.creditLimitInvalid";
  }
  const days = creditDaysRaw.trim();
  if (days !== "") {
    const value = Number(days);
    if (!Number.isFinite(value) || value < 0) return "suppliers.creditDaysInvalid";
  }
  return null;
};
