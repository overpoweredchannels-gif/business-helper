import { resolveLiveCandidate, searchSuppliersLive } from "./entity-match";
import type { MemoryStore } from "../brain/memory/business-memory";
import { buildSupplierLedger, SupplierLedger, SupplierLedgerEntry } from "./supplier-ledger";
import { formatAiMoney } from "./ai-money";

/**
 * AI Supplier Intelligence — natural-language query engine over the derived
 * supplier ledger. Mirrors the customer intelligence architecture: every
 * query type returns plain, speakable text (no markdown, no emojis, no
 * formatting) for full voice compatibility. Supports English, Urdu, Roman
 * Urdu and mixed-language inputs.
 */

export type SupplierQueryIntent =
  | "search"
  | "balance"
  | "all_outstanding"
  | "overdue"
  | "near_limit"
  | "credit_limit"
  | "credit_days"
  | "blocked"
  | "history"
  | "payment_history"
  | "last_transaction"
  | "frequency"
  | "avg_order"
  | "top"
  | "inactive"
  | "highest_outstanding"
  | "profitable"
  | "product_supply"
  | "summary";

export interface SupplierQueryResult {
  ok: boolean;
  message: string;
  error?: string;
  queryType: SupplierQueryIntent | null;
}

export interface SupplierQueryContext {
  productName?: string | null;
  message?: string;
}

const MAX_LIST = 5;

function formatMoney(value: number, currency: unknown = "PKR"): string {
  return formatAiMoney(value, currency);
}

function stripBareDate(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function productSummary(invoice: { items: Array<{ productName: string; quantity: number }> }): string {
  if (invoice.items.length === 0) return "";
  const parts = invoice.items
    .slice(0, 3)
    .map((item) => `${item.productName} x${item.quantity}`);
  const extra = invoice.items.length > 3 ? ` and ${invoice.items.length - 3} more` : "";
  return ` (${parts.join(", ")}${extra})`;
}

function findSupplierMatches(ledger: SupplierLedger, name: string) {
  return searchSuppliersLive(name, ledger.suppliers.map((row) => ({ id: row.supplierId, supplier_name: row.supplierName })));
}

function findSupplierEntry(ledger: SupplierLedger, name: string | null): SupplierLedgerEntry | null {
  if (!name) return null;
  const match = resolveLiveCandidate(findSupplierMatches(ledger, name));
  return match ? ledger.byId.get(match.id) ?? null : null;
}

function findManySupplierEntries(ledger: SupplierLedger, name: string): SupplierLedgerEntry[] {
  return findSupplierMatches(ledger, name).flatMap((candidate) => {
    const entry = ledger.byId.get(candidate.id);
    return entry ? [entry] : [];
  });
}

function entryLabel(entry: SupplierLedgerEntry): string {
  const bits: string[] = [entry.supplierName];
  if (entry.contactPerson) bits.push(entry.contactPerson);
  if (entry.area) bits.push(entry.area);
  if (entry.phone) bits.push(entry.phone);
  return bits.join(", ");
}

function listMessage(items: string[], total: number, noun: string): string {
  const shown = items
    .map((item, index) => `${index + 1}. ${item}`)
    .slice(0, MAX_LIST)
    .join("\n");
  const remainder = total > MAX_LIST ? `\nAnd ${total - MAX_LIST} more...` : "";
  return `${shown}${remainder}`;
}

function searchTermFromMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const stripped = message
    .toLowerCase()
    .replace(
      /\b(find|search|khoj|khojo|dhoond|look up|look|show|list|display|supplier|suppliers|vendor|furnisher|thoker|thokar|by|in|from|for|with|the|of|me|all|please|do|phone|mobile|number|area|kitne|kitnay|kaun)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : null;
}

function hasPhoneDigits(value: string | null | undefined): boolean {
  return Boolean(value && /[0-9]{10,}/.test(value.replace(/[\s-]/g, "")));
}

function detectPeriodDays(message: string | null | undefined): number | null {
  if (!message) return null;
  if (/\b(last|past|pichle|pichlay|previous)?\s*(week|hafta|haftay|7 days?)\b/.test(message)) return 7;
  if (/\b(last|past|pichle|pichlay|previous)?\s*(month|mahina|mahinay|30 days?)\b/.test(message)) return 30;
  if (/\b(last|past|pichle|pichlay|previous)?\s*(quarter|90 days?)\b/.test(message)) return 90;
  if (/\b(today|aaj)\b/.test(message)) return 1;
  return null;
}

function balanceMessage(entry: SupplierLedgerEntry, currency: unknown = "PKR"): string {
  const parts: string[] = [];
  if (entry.payableAmount > 0) {
    parts.push(`We owe ${entry.supplierName} ${formatMoney(entry.payableAmount, currency)}.`);
  } else {
    parts.push(`We don't owe ${entry.supplierName} anything.`);
  }
  if (entry.creditLimit !== null && entry.creditLimit > 0) {
    const used = entry.creditUtilizationPct !== null ? ` (${Math.round(entry.creditUtilizationPct)}% used)` : "";
    parts.push(`Credit limit is ${formatMoney(entry.creditLimit, currency)}${used}.`);
  }
  if (entry.overdueAmount > 0) {
    const days = entry.overdueDays ? `, ${entry.overdueDays} day(s) overdue` : "";
    parts.push(`Overdue ${formatMoney(entry.overdueAmount, currency)} (${entry.overdueInvoiceCount} invoice(s))${days}.`);
  }
  if (entry.creditDaysRemaining !== null) {
    if (entry.creditDaysRemaining >= 0) {
      parts.push(`Credit days remaining: ${entry.creditDaysRemaining}.`);
    } else {
      parts.push(`Credit period ended ${Math.abs(entry.creditDaysRemaining)} day(s) ago.`);
    }
  }
  if (entry.isBlocked) {
    parts.push("Supplier credit is currently blocked.");
  }
  return parts.join(" ");
}

export function processSupplierQuery(
  queryType: SupplierQueryIntent | null,
  supplierName: string | null,
  store: MemoryStore,
  ledger: SupplierLedger,
  context: SupplierQueryContext = {}
): SupplierQueryResult {
  const normalized = (supplierName ?? "").toLowerCase().trim();
  const currency = store.meta.currency;

  switch (queryType ?? "summary") {
    case "search": {
      const searchTerm = supplierName ?? searchTermFromMessage(context.message);
      const message = context.message ?? "";
      const phoneDigits = hasPhoneDigits(searchTerm) ? searchTerm : hasPhoneDigits(message) ? message : null;
      if (phoneDigits) {
        const digits = phoneDigits.replace(/[^\d]/g, "");
        const matches = ledger.suppliers.filter((entry) => {
          const phone = (entry.phone ?? "").replace(/[^\d]/g, "");
          if (phone.length === 0) return false;
          return phone.includes(digits) || digits.includes(phone);
        });
        if (matches.length > 0) {
          return {
            ok: true,
            queryType,
            message: `I found ${matches.length} supplier(s) with that phone:\n${listMessage(matches.map((entry) => `${entryLabel(entry)}`), matches.length, "supplier")}`,
          };
        }
        return { ok: true, queryType, message: "No supplier has that phone number." };
      }

      const areaMatches = ledger.suppliers.filter((entry) => {
        if (!entry.area) return false;
        const area = entry.area.toLowerCase();
        return area.length >= 3 && message.toLowerCase().includes(area);
      });
      if (areaMatches.length > 0) {
        return {
          ok: true,
          queryType,
          message: `Suppliers in ${areaMatches[0].area}:\n${listMessage(areaMatches.map((entry) => `${entryLabel(entry)}`), areaMatches.length, "supplier")}`,
        };
      }

      if (!searchTerm) {
        return {
          ok: true,
          queryType,
          message: `You have ${ledger.suppliers.length} supplier(s):\n${listMessage(ledger.suppliers.map((entry) => `${entryLabel(entry)}`), ledger.suppliers.length, "supplier")}`,
        };
      }

      const matches = findManySupplierEntries(ledger, searchTerm);
      if (matches.length === 0) {
        return { ok: false, error: "SUPPLIER_NOT_FOUND", queryType, message: `I couldn't find any supplier matching "${searchTerm}".` };
      }
      return {
        ok: true,
        queryType,
        message: `I found ${matches.length} supplier(s) matching "${searchTerm}":\n${listMessage(matches.map((entry) => `${entryLabel(entry)}`), matches.length, "supplier")}`,
      };
    }

    case "balance":
    case "all_outstanding": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        return { ok: true, queryType, message: balanceMessage(entry, currency) };
      }
      const owing = ledger.suppliers
        .filter((candidate) => candidate.payableAmount > 0)
        .sort((a, b) => b.payableAmount - a.payableAmount);
      if (owing.length === 0) {
        return { ok: true, queryType, message: "We don't owe any supplier right now." };
      }
      const total = owing.reduce((sum, candidate) => sum + candidate.payableAmount, 0);
      return {
        ok: true,
        queryType,
        message: `We owe ${owing.length} supplier(s):\n${listMessage(
          owing.map((candidate) => `${candidate.supplierName} ${formatMoney(candidate.payableAmount, currency)}`),
          owing.length,
          "supplier"
        )}\nTotal payable: ${formatMoney(total, currency)}.`,
      };
    }

    case "overdue": {
      const overdue = ledger.suppliers
        .filter((entry) => entry.overdueAmount > 0)
        .sort((a, b) => b.overdueAmount - a.overdueAmount);
      if (overdue.length === 0) {
        return { ok: true, queryType, message: "No overdue supplier payments. All payables are on time." };
      }
      const total = overdue.reduce((sum, entry) => sum + entry.overdueAmount, 0);
      return {
        ok: true,
        queryType,
        message: `${overdue.length} overdue supplier payment(s):\n${listMessage(
          overdue.map(
            (entry) =>
              `${entry.supplierName} ${formatMoney(entry.overdueAmount, currency)} (${entry.overdueDays ?? 0} day(s) overdue)`
          ),
          overdue.length,
          "supplier"
        )}\nTotal overdue: ${formatMoney(total, currency)}.`,
      };
    }

    case "near_limit": {
      const near = ledger.suppliers
        .filter((entry) => entry.isNearCreditLimit)
        .sort((a, b) => (b.creditUtilizationPct ?? 0) - (a.creditUtilizationPct ?? 0));
      if (near.length === 0) {
        return { ok: true, queryType, message: "No supplier is near their credit limit." };
      }
      return {
        ok: true,
        queryType,
        message: `${near.length} supplier(s) near their credit limit:\n${listMessage(
          near.map(
            (entry) =>
              `${entry.supplierName} ${Math.round(entry.creditUtilizationPct ?? 0)}% of ${formatMoney(entry.creditLimit ?? 0, currency)} used`
          ),
          near.length,
          "supplier"
        )}`,
      };
    }

    case "credit_limit": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        if (entry.creditLimit === null || entry.creditLimit <= 0) {
          return { ok: true, queryType, message: `${entry.supplierName} has no credit limit set.` };
        }
        if (entry.creditUtilizationPct === null) {
          return { ok: true, queryType, message: `${entry.supplierName}'s credit limit is ${formatMoney(entry.creditLimit, currency)}.` };
        }
        return {
          ok: true,
          queryType,
          message: `${entry.supplierName}'s credit limit is ${formatMoney(entry.creditLimit, currency)} (${Math.round(entry.creditUtilizationPct)}% used).`,
        };
      }
      const withLimits = ledger.suppliers.filter((entry) => entry.creditLimit !== null && entry.creditLimit > 0);
      if (withLimits.length === 0) {
        return { ok: true, queryType, message: "No supplier has a credit limit on record." };
      }
      return {
        ok: true,
        queryType,
        message: `Credit limits:\n${listMessage(
          withLimits.map((entry) => `${entry.supplierName}: ${formatMoney(entry.creditLimit ?? 0, currency)}`),
          withLimits.length,
          "supplier"
        )}`,
      };
    }

    case "credit_days": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        if (entry.creditDaysRemaining === null || entry.creditDays === null) {
          return { ok: true, queryType, message: `${entry.supplierName} has no credit-day terms.` };
        }
        if (entry.creditDaysRemaining >= 0) {
          return {
            ok: true,
            queryType,
            message: `${entry.supplierName} has ${entry.creditDaysRemaining} credit day(s) remaining (${entry.creditDays} days total).`,
          };
        }
        return {
          ok: true,
          queryType,
          message: `${entry.supplierName}'s credit period ended ${Math.abs(entry.creditDaysRemaining)} day(s) ago.`,
        };
      }
      const withTerms = ledger.suppliers
        .filter((entry) => entry.creditDaysRemaining !== null)
        .sort((a, b) => (a.creditDaysRemaining ?? 0) - (b.creditDaysRemaining ?? 0));
      if (withTerms.length === 0) {
        return { ok: true, queryType, message: "No supplier has credit-day terms on record." };
      }
      return {
        ok: true,
        queryType,
        message: `Credit days remaining:\n${listMessage(
          withTerms.map(
            (entry) =>
              `${entry.supplierName}: ${entry.creditDaysRemaining! >= 0 ? `${entry.creditDaysRemaining} day(s) left` : `ended ${Math.abs(entry.creditDaysRemaining!)} day(s) ago`}`
          ),
          withTerms.length,
          "supplier"
        )}`,
      };
    }

    case "blocked": {
      const blocked = ledger.suppliers.filter((entry) => entry.isBlocked);
      if (blocked.length === 0) {
        return { ok: true, queryType, message: "No supplier is blocked from credit." };
      }
      return {
        ok: true,
        queryType,
        message: `${blocked.length} blocked supplier(s):\n${listMessage(
          blocked.map((entry) => {
            const reason = entry.overdueAmount > 0 ? "overdue" : "over credit limit";
            return `${entry.supplierName} (${reason})`;
          }),
          blocked.length,
          "supplier"
        )}`,
      };
    }

    case "history": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        if (entry.invoices.length === 0) {
          return { ok: true, queryType, message: `${entry.supplierName} has no purchases yet.` };
        }
        const rows = [...entry.invoices].reverse().map(
          (inv) =>
            `${stripBareDate(inv.date)} Invoice ${inv.invoiceNumber} ${formatMoney(inv.amount, currency)}${productSummary(inv)}`
        );
        return {
          ok: true,
          queryType,
          message: `${entry.supplierName}'s purchase history (${entry.invoices.length} invoice(s)):\n${listMessage(rows, entry.invoices.length, "invoice")}`,
        };
      }
      const recent = ledger.suppliers
        .flatMap((candidate) => candidate.invoices.map((inv) => ({ ...inv, supplierName: candidate.supplierName })))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, MAX_LIST);
      if (recent.length === 0) {
        return { ok: true, queryType, message: "No purchases have been recorded yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Recent purchases:\n${listMessage(
          recent.map((inv) => `${inv.supplierName}: ${stripBareDate(inv.date)} ${formatMoney(inv.amount, currency)}`),
          recent.length,
          "purchase"
        )}`,
      };
    }

    case "payment_history": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        if (entry.payments.length === 0) {
          return { ok: true, queryType, message: `${entry.supplierName} has no payment records.` };
        }
        const rows = [...entry.payments]
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
          .map((payment) => `${stripBareDate(payment.date)} ${formatMoney(payment.amount, currency)}`);
        return {
          ok: true,
          queryType,
          message: `${entry.supplierName}'s payment history (${entry.payments.length} payment(s)):\n${listMessage(rows, entry.payments.length, "payment")}`,
        };
      }
      const recent = ledger.suppliers
        .flatMap((candidate) => candidate.payments.map((payment) => ({ ...payment, supplierName: candidate.supplierName })))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, MAX_LIST);
      if (recent.length === 0) {
        return { ok: true, queryType, message: "No supplier payments have been recorded yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Recent supplier payments:\n${listMessage(
          recent.map((payment) => `${payment.supplierName}: ${stripBareDate(payment.date)} ${formatMoney(payment.amount, currency)}`),
          recent.length,
          "payment"
        )}`,
      };
    }

    case "last_transaction": {
      const entry = findSupplierEntry(ledger, supplierName);
      const candidate = entry ?? ledger.suppliers
        .filter((s) => s.lastInvoice)
        .sort((a, b) => (b.lastPurchaseDate ?? "").localeCompare(a.lastPurchaseDate ?? ""))[0];
      if (!candidate || !candidate.lastInvoice) {
        return { ok: true, queryType, message: "No purchases have been recorded yet." };
      }
      const inv = candidate.lastInvoice;
      return {
        ok: true,
        queryType,
        message: `${candidate.supplierName}'s last purchase: ${stripBareDate(inv.date)}, Invoice ${inv.invoiceNumber}, ${formatMoney(inv.amount, currency)}${productSummary(inv)}.`,
      };
    }

    case "frequency": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        if (entry.invoiceCount === 0) {
          return { ok: true, queryType, message: `No purchases from ${entry.supplierName} yet.` };
        }
        const perMonth = ((entry.invoiceCount / 90) * 30);
        return {
          ok: true,
          queryType,
          message: `${entry.supplierName} has supplied ${entry.invoiceCount} order(s) in total, ${entry.frequency30d} in the last 30 days — about ${perMonth.toFixed(1)} order(s) per month.`,
        };
      }
      const frequent = [...ledger.suppliers]
        .sort((a, b) => b.invoiceCount - a.invoiceCount)
        .slice(0, MAX_LIST);
      return {
        ok: true,
        queryType,
        message: `Most frequent suppliers:\n${listMessage(
          frequent.map((candidate) => `${candidate.supplierName}: ${candidate.invoiceCount} order(s)`),
          frequent.length,
          "supplier"
        )}`,
      };
    }

    case "avg_order": {
      const entry = findSupplierEntry(ledger, supplierName);
      if (entry) {
        if (entry.invoiceCount === 0) {
          return { ok: true, queryType, message: `No purchases from ${entry.supplierName} yet.` };
        }
        return {
          ok: true,
          queryType,
          message: `${entry.supplierName}'s average purchase is ${formatMoney(entry.averageOrderValue, currency)} across ${entry.invoiceCount} order(s).`,
        };
      }
      const total = ledger.totals;
      const overall = total.totalInvoices > 0 ? total.totalPurchases / total.totalInvoices : 0;
      return {
        ok: true,
        queryType,
        message: `Average purchase across all suppliers is ${formatMoney(overall, currency)} (${total.totalInvoices} orders).`,
      };
    }

    case "top": {
      const top = [...ledger.suppliers].sort((a, b) => b.totalPurchases - a.totalPurchases).slice(0, MAX_LIST);
      if (top.length === 0) {
        return { ok: true, queryType, message: "No suppliers on record yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Top suppliers by purchases:\n${listMessage(
          top.map((entry) => `${entry.supplierName} ${formatMoney(entry.totalPurchases, currency)} (${entry.invoiceCount} order(s))`),
          top.length,
          "supplier"
        )}`,
      };
    }

    case "inactive": {
      const cutoff = 30;
      const inactive = ledger.suppliers
        .filter((entry) => entry.invoiceCount === 0 || (entry.daysSinceLastPurchase ?? 999) >= cutoff)
        .sort((a, b) => (b.daysSinceLastPurchase ?? 999) - (a.daysSinceLastPurchase ?? 999));
      if (inactive.length === 0) {
        return { ok: true, queryType, message: `Every supplier has supplied within the last ${cutoff} days.` };
      }
      return {
        ok: true,
        queryType,
        message: `Supplier(s) with no purchase in ${cutoff}+ days:\n${listMessage(
          inactive.map((entry) =>
            entry.invoiceCount === 0
              ? `${entry.supplierName} (never supplied)`
              : `${entry.supplierName} (${entry.daysSinceLastPurchase} day(s) ago)`
          ),
          inactive.length,
          "supplier"
        )}`,
      };
    }

    case "highest_outstanding": {
      const owing = ledger.suppliers
        .filter((entry) => entry.payableAmount > 0)
        .sort((a, b) => b.payableAmount - a.payableAmount);
      if (owing.length === 0) {
        return { ok: true, queryType, message: "No supplier has an outstanding payable." };
      }
      return {
        ok: true,
        queryType,
        message: `Supplier(s) with the highest payable:\n${listMessage(
          owing.map((entry) => `${entry.supplierName} ${formatMoney(entry.payableAmount, currency)}`),
          owing.length,
          "supplier"
        )}`,
      };
    }

    case "profitable": {
      const profitable = [...ledger.suppliers]
        .filter((entry) => entry.totalProfit > 0)
        .sort((a, b) => b.totalProfit - a.totalProfit)
        .slice(0, MAX_LIST);
      if (profitable.length === 0) {
        return { ok: true, queryType, message: "No profitability data yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Most profitable suppliers:\n${listMessage(
          profitable.map(
            (entry) =>
              `${entry.supplierName} ${formatMoney(entry.totalProfit, currency)} margin on ${formatMoney(entry.totalPurchases, currency)} purchases`
          ),
          profitable.length,
          "supplier"
        )}`,
      };
    }

    case "product_supply": {
      const productName = context.productName?.trim();
      if (!productName) {
        return { ok: false, error: "MISSING_PRODUCT", queryType, message: "Which product would you like me to check?" };
      }
      const periodDays = detectPeriodDays(context.message);
      const windowNote = periodDays !== null ? ` in the last ${periodDays} day(s)` : "";
      const productKey = productName.toLowerCase();
      const suppliers: Array<{ entry: SupplierLedgerEntry; units: number; lastDate: string }> = [];
      for (const entry of ledger.suppliers) {
        let units = 0;
        let lastDate = "";
        for (const inv of entry.invoices) {
          for (const item of inv.items) {
            const itemKey = item.productName.toLowerCase();
            if (itemKey === productKey || itemKey.includes(productKey) || productKey.includes(itemKey)) {
              if (periodDays !== null) {
                const ageDays = (Date.now() - new Date(inv.date).getTime()) / 86400000;
                if (ageDays > periodDays) continue;
              }
              units += item.quantity;
              if (inv.date > lastDate) lastDate = inv.date;
            }
          }
        }
        if (units > 0) suppliers.push({ entry, units, lastDate });
      }
      suppliers.sort((a, b) => b.units - a.units);
      if (suppliers.length === 0) {
        return {
          ok: true,
          queryType,
          message: `No supplier supplied ${productName}${windowNote}.`,
        };
      }
      return {
        ok: true,
        queryType,
        message: `Suppliers who supplied ${productName}${windowNote}:\n${listMessage(
          suppliers.map(({ entry, units }) => `${entry.supplierName} (${units} unit(s))`),
          suppliers.length,
          "supplier"
        )}`,
      };
    }

    case "summary":
    default: {
      const total = ledger.totals;
      const parts: string[] = [
        `You have ${ledger.suppliers.length} supplier(s).`,
        `Total purchases: ${formatMoney(total.totalPurchases, currency)} (${total.totalInvoices} order(s)).`,
        `Total payable: ${formatMoney(total.totalPayable, currency)}${total.totalOverdue > 0 ? `, of which ${formatMoney(total.totalOverdue, currency)} is overdue` : ""}.`,
      ];
      if (total.suppliersOwing > 0) parts.push(`We owe ${total.suppliersOwing} supplier(s).`);
      const blocked = ledger.suppliers.filter((entry) => entry.isBlocked).length;
      if (blocked > 0) parts.push(`${blocked} supplier(s) are blocked from credit.`);
      return { ok: true, queryType, message: parts.join(" ") };
    }
  }
}
