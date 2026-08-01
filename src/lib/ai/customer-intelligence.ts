import type { MemoryStore } from "../brain/memory/business-memory";
import type { CustomerLedger, CustomerLedgerEntry } from "./customer-ledger";

/**
 * Customer Intelligence query processor — the customer counterpart of
 * inventory-intelligence / staff-intelligence / location-intelligence.
 *
 * Answers search, balance, credit intelligence, history, analytics and
 * AI questions (e.g. "Who bought Pepsi last week?") with plain speakable
 * text over the derived customer ledger. It reuses the Brain's entity index
 * for fuzzy name matching and reads nothing from the gateway.
 */

export type CustomerQueryIntent =
  | "search"
  | "balance"
  | "all_outstanding"
  | "overdue"
  | "near_limit"
  | "credit_limit"
  | "credit_days"
  | "blocked"
  | "history"
  | "last_transaction"
  | "frequency"
  | "avg_order"
  | "top"
  | "inactive"
  | "highest_outstanding"
  | "profitable"
  | "product_sales"
  | "summary";

export interface CustomerQueryResult {
  ok: boolean;
  message: string;
  error?: string;
  queryType: CustomerQueryIntent | null;
}

export interface CustomerQueryContext {
  productName?: string | null;
  message?: string;
}

const MAX_LIST = 5;

function formatMoney(value: number): string {
  return `Rs ${Math.round(value).toLocaleString("en-PK")}`;
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

function findCustomerEntry(ledger: CustomerLedger, store: MemoryStore, name: string | null): CustomerLedgerEntry | null {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();
  const exact = ledger.customers.find(
    (entry) => entry.customerName.toLowerCase() === normalized || (entry.shopName ?? "").toLowerCase() === normalized
  );
  if (exact) return exact;

  const fuzzy = store.searchCustomers(normalized, 0.35, 10);
  if (fuzzy.length === 0) return null;
  const best = fuzzy[0];
  if (best.score < 0.5) return null;
  return ledger.byId.get(String(best.item.id)) ?? null;
}

function findManyCustomerEntries(ledger: CustomerLedger, store: MemoryStore, name: string): CustomerLedgerEntry[] {
  const normalized = name.toLowerCase().trim();
  const exact = ledger.customers.filter(
    (entry) =>
      entry.customerName.toLowerCase() === normalized ||
      (entry.shopName ?? "").toLowerCase() === normalized
  );
  if (exact.length > 0) return exact;
  const termTokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  const firstToken = termTokens[0] ?? "";
  const fuzzy = store.searchCustomers(normalized, 0.3, 8);
  return fuzzy
    .filter((result) => {
      const candidateName = result.item.name.toLowerCase();
      return firstToken.length > 0 && candidateName.includes(firstToken) && result.score >= 0.45;
    })
    .map((result) => ledger.byId.get(String(result.item.id)))
    .filter((entry): entry is CustomerLedgerEntry => Boolean(entry));
}

function entryLabel(entry: CustomerLedgerEntry): string {
  const bits: string[] = [entry.customerName];
  if (entry.shopName) bits.push(entry.shopName);
  if (entry.area) bits.push(entry.area);
  if (entry.customerType) bits.push(entry.customerType);
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
      /\b(find|search|khoj|khojo|dhoond|look up|look|show|list|display|customer|customers|client|clients|gahak|kharidar|khareedar|by|in|from|for|with|the|of|me|all|please|do|phone|mobile|number|area|category|kitne|kitnay|kaun)\b/g,
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

function balanceMessage(entry: CustomerLedgerEntry): string {
  const parts: string[] = [];
  if (entry.outstandingBalance > 0) {
    parts.push(`${entry.customerName} currently owes ${formatMoney(entry.outstandingBalance)}.`);
  } else {
    parts.push(`${entry.customerName} has no outstanding balance.`);
  }
  if (entry.creditLimit !== null && entry.creditLimit > 0) {
    const used = entry.creditUtilizationPct !== null ? ` (${Math.round(entry.creditUtilizationPct)}% used)` : "";
    parts.push(`Credit limit is ${formatMoney(entry.creditLimit)}${used}.`);
  }
  if (entry.overdueAmount > 0) {
    const days = entry.overdueDays ? `, ${entry.overdueDays} day(s) overdue` : "";
    parts.push(`Overdue ${formatMoney(entry.overdueAmount)} (${entry.overdueInvoiceCount} invoice(s))${days}.`);
  }
  if (entry.creditDaysRemaining !== null) {
    if (entry.creditDaysRemaining >= 0) {
      parts.push(`Credit days remaining: ${entry.creditDaysRemaining}.`);
    } else {
      parts.push(`Credit period ended ${Math.abs(entry.creditDaysRemaining)} day(s) ago.`);
    }
  }
  if (entry.isBlocked) {
    parts.push("Credit is currently blocked.");
  }
  return parts.join(" ");
}

export function processCustomerQuery(
  queryType: CustomerQueryIntent | null,
  customerName: string | null,
  store: MemoryStore,
  ledger: CustomerLedger,
  context: CustomerQueryContext = {}
): CustomerQueryResult {
  const normalized = (customerName ?? "").toLowerCase().trim();

  switch (queryType ?? "summary") {
    case "search": {
      const searchTerm = customerName ?? searchTermFromMessage(context.message);
      const message = context.message ?? "";
      const phoneDigits = hasPhoneDigits(searchTerm) ? searchTerm : hasPhoneDigits(message) ? message : null;
      if (phoneDigits) {
        const digits = phoneDigits.replace(/[^\d]/g, "");
        const matches = ledger.customers.filter((entry) => {
          const phone = (entry.phone ?? "").replace(/[^\d]/g, "");
          if (phone.length === 0) return false;
          return phone.includes(digits) || digits.includes(phone);
        });
        if (matches.length > 0) {
          return {
            ok: true,
            queryType,
            message: `I found ${matches.length} customer(s) with that phone:\n${listMessage(matches.map((entry) => `${entryLabel(entry)}`), matches.length, "customer")}`,
          };
        }
        return { ok: true, queryType, message: "No customer has that phone number." };
      }

      const areaMatches = ledger.customers.filter((entry) => {
        if (!entry.area) return false;
        const area = entry.area.toLowerCase();
        return area.length >= 3 && message.toLowerCase().includes(area);
      });
      if (areaMatches.length > 0) {
        return {
          ok: true,
          queryType,
          message: `Customers in ${areaMatches[0].area}:\n${listMessage(areaMatches.map((entry) => `${entryLabel(entry)}`), areaMatches.length, "customer")}`,
        };
      }

      const TYPE_KEYWORDS: Array<[string, string]> = [
        ["wholesale", "Wholesale"],
        ["wholesaler", "Wholesale"],
        ["retail", "Retail"],
        ["retailer", "Retail"],
        ["institutional", "Institutional"],
        ["distributor", "Distributor"],
        ["reseller", "Reseller"],
      ];
      const typeTargets = TYPE_KEYWORDS.filter(([keyword]) => new RegExp(`\\b${keyword}`, "i").test(message)).map(
        ([, target]) => target
      );
      if (typeTargets.length > 0) {
        const typeMatches = ledger.customers.filter((entry) => {
          if (!entry.customerType) return false;
          const type = entry.customerType.toLowerCase();
          return typeTargets.some((target) => type.startsWith(target.toLowerCase()));
        });
        if (typeMatches.length > 0) {
          return {
            ok: true,
            queryType,
            message: `${typeTargets[0]} customers:\n${listMessage(typeMatches.map((entry) => `${entryLabel(entry)}`), typeMatches.length, "customer")}`,
          };
        }
      }

      if (!searchTerm) {
        return {
          ok: true,
          queryType,
          message: `You have ${ledger.customers.length} customer(s):\n${listMessage(ledger.customers.map((entry) => `${entryLabel(entry)}`), ledger.customers.length, "customer")}`,
        };
      }

      const matches = findManyCustomerEntries(ledger, store, searchTerm);
      if (matches.length === 0) {
        return { ok: false, error: "CUSTOMER_NOT_FOUND", queryType, message: `I couldn't find any customer matching "${searchTerm}".` };
      }
      return {
        ok: true,
        queryType,
        message: `I found ${matches.length} customer(s) matching "${searchTerm}":\n${listMessage(matches.map((entry) => `${entryLabel(entry)}`), matches.length, "customer")}`,
      };
    }

    case "balance":
    case "all_outstanding": {
      const entry = findCustomerEntry(ledger, store, customerName);
      if (entry) {
        return { ok: true, queryType, message: balanceMessage(entry) };
      }
      const owing = ledger.customers
        .filter((candidate) => candidate.outstandingBalance > 0)
        .sort((a, b) => b.outstandingBalance - a.outstandingBalance);
      if (owing.length === 0) {
        return { ok: true, queryType, message: "No customer owes you money right now." };
      }
      const total = owing.reduce((sum, candidate) => sum + candidate.outstandingBalance, 0);
      return {
        ok: true,
        queryType,
        message: `${owing.length} customer(s) owe you money:\n${listMessage(
          owing.map((candidate) => `${candidate.customerName} ${formatMoney(candidate.outstandingBalance)}`),
          owing.length,
          "customer"
        )}\nTotal outstanding: ${formatMoney(total)}.`,
      };
    }

    case "overdue": {
      const overdue = ledger.customers
        .filter((entry) => entry.overdueAmount > 0)
        .sort((a, b) => b.overdueAmount - a.overdueAmount);
      if (overdue.length === 0) {
        return { ok: true, queryType, message: "No overdue payments. All credit is on time." };
      }
      const total = overdue.reduce((sum, entry) => sum + entry.overdueAmount, 0);
      return {
        ok: true,
        queryType,
        message: `${overdue.length} overdue customer(s):\n${listMessage(
          overdue.map(
            (entry) =>
              `${entry.customerName} ${formatMoney(entry.overdueAmount)} (${entry.overdueDays ?? 0} day(s) overdue)`
          ),
          overdue.length,
          "customer"
        )}\nTotal overdue: ${formatMoney(total)}.`,
      };
    }

    case "near_limit": {
      const near = ledger.customers
        .filter((entry) => entry.isNearCreditLimit)
        .sort((a, b) => (b.creditUtilizationPct ?? 0) - (a.creditUtilizationPct ?? 0));
      if (near.length === 0) {
        return { ok: true, queryType, message: "No customer is near their credit limit." };
      }
      return {
        ok: true,
        queryType,
        message: `${near.length} customer(s) near their credit limit:\n${listMessage(
          near.map(
            (entry) =>
              `${entry.customerName} ${Math.round(entry.creditUtilizationPct ?? 0)}% of ${formatMoney(entry.creditLimit ?? 0)} used`
          ),
          near.length,
          "customer"
        )}`,
      };
    }

    case "credit_limit": {
      const entry = findCustomerEntry(ledger, store, customerName);
      if (entry) {
        if (entry.creditLimit === null || entry.creditLimit <= 0) {
          return { ok: true, queryType, message: `${entry.customerName} has no credit limit set.` };
        }
        if (entry.creditUtilizationPct === null) {
          return { ok: true, queryType, message: `${entry.customerName}'s credit limit is ${formatMoney(entry.creditLimit)}.` };
        }
        return {
          ok: true,
          queryType,
          message: `${entry.customerName}'s credit limit is ${formatMoney(entry.creditLimit)} (${Math.round(entry.creditUtilizationPct)}% used).`,
        };
      }
      const withLimits = ledger.customers.filter((entry) => entry.creditLimit !== null && entry.creditLimit > 0);
      if (withLimits.length === 0) {
        return { ok: true, queryType, message: "No customer has a credit limit on record." };
      }
      return {
        ok: true,
        queryType,
        message: `Credit limits:\n${listMessage(
          withLimits.map((entry) => `${entry.customerName}: ${formatMoney(entry.creditLimit ?? 0)}`),
          withLimits.length,
          "customer"
        )}`,
      };
    }

    case "credit_days": {
      const entry = findCustomerEntry(ledger, store, customerName);
      if (entry) {
        if (entry.creditDaysRemaining === null || entry.creditDays === null) {
          return { ok: true, queryType, message: `${entry.customerName} has no credit-day terms.` };
        }
        if (entry.creditDaysRemaining >= 0) {
          return {
            ok: true,
            queryType,
            message: `${entry.customerName} has ${entry.creditDaysRemaining} credit day(s) remaining (${entry.creditDays} days total).`,
          };
        }
        return {
          ok: true,
          queryType,
          message: `${entry.customerName}'s credit period ended ${Math.abs(entry.creditDaysRemaining)} day(s) ago.`,
        };
      }
      const withTerms = ledger.customers
        .filter((entry) => entry.creditDaysRemaining !== null)
        .sort((a, b) => (a.creditDaysRemaining ?? 0) - (b.creditDaysRemaining ?? 0));
      if (withTerms.length === 0) {
        return { ok: true, queryType, message: "No customer has credit-day terms on record." };
      }
      return {
        ok: true,
        queryType,
        message: `Credit days remaining:\n${listMessage(
          withTerms.map(
            (entry) =>
              `${entry.customerName}: ${entry.creditDaysRemaining! >= 0 ? `${entry.creditDaysRemaining} day(s) left` : `ended ${Math.abs(entry.creditDaysRemaining!)} day(s) ago`}`
          ),
          withTerms.length,
          "customer"
        )}`,
      };
    }

    case "blocked": {
      const blocked = ledger.customers.filter((entry) => entry.isBlocked);
      if (blocked.length === 0) {
        return { ok: true, queryType, message: "No customer is blocked from credit." };
      }
      return {
        ok: true,
        queryType,
        message: `${blocked.length} blocked customer(s):\n${listMessage(
          blocked.map((entry) => {
            const reason = entry.overdueAmount > 0 ? "overdue" : "over credit limit";
            return `${entry.customerName} (${reason})`;
          }),
          blocked.length,
          "customer"
        )}`,
      };
    }

    case "history": {
      const entry = findCustomerEntry(ledger, store, customerName);
      if (entry) {
        if (entry.invoices.length === 0) {
          return { ok: true, queryType, message: `${entry.customerName} has no sales yet.` };
        }
        const rows = [...entry.invoices].reverse().map(
          (inv) =>
            `${stripBareDate(inv.date)} Invoice ${inv.invoiceNumber} ${formatMoney(inv.amount)}${productSummary(inv)}`
        );
        return {
          ok: true,
          queryType,
          message: `${entry.customerName}'s sales history (${entry.invoices.length} invoice(s)):\n${listMessage(rows, entry.invoices.length, "invoice")}`,
        };
      }
      const recent = ledger.customers
        .flatMap((candidate) => candidate.invoices.map((inv) => ({ ...inv, customerName: candidate.customerName })))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, MAX_LIST);
      if (recent.length === 0) {
        return { ok: true, queryType, message: "No sales have been recorded yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Recent sales:\n${listMessage(
          recent.map((inv) => `${inv.customerName}: ${stripBareDate(inv.date)} ${formatMoney(inv.amount)}`),
          recent.length,
          "sale"
        )}`,
      };
    }

    case "last_transaction": {
      const entry = findCustomerEntry(ledger, store, customerName);
      const candidate = entry ?? ledger.customers
        .filter((c) => c.lastInvoice)
        .sort((a, b) => (b.lastSaleDate ?? "").localeCompare(a.lastSaleDate ?? ""))[0];
      if (!candidate || !candidate.lastInvoice) {
        return { ok: true, queryType, message: "No transactions have been recorded yet." };
      }
      const inv = candidate.lastInvoice;
      return {
        ok: true,
        queryType,
        message: `${candidate.customerName}'s last transaction: ${stripBareDate(inv.date)}, Invoice ${inv.invoiceNumber}, ${formatMoney(inv.amount)}${productSummary(inv)}.`,
      };
    }

    case "frequency": {
      const entry = findCustomerEntry(ledger, store, customerName);
      if (entry) {
        if (entry.invoiceCount === 0) {
          return { ok: true, queryType, message: `${entry.customerName} hasn't purchased yet.` };
        }
        const perMonth = ((entry.invoiceCount / 90) * 30);
        return {
          ok: true,
          queryType,
          message: `${entry.customerName} has ${entry.invoiceCount} invoice(s) in total, ${entry.frequency30d} in the last 30 days — about ${perMonth.toFixed(1)} purchase(s) per month.`,
        };
      }
      const frequent = [...ledger.customers]
        .sort((a, b) => b.invoiceCount - a.invoiceCount)
        .slice(0, MAX_LIST);
      return {
        ok: true,
        queryType,
        message: `Most frequent buyers:\n${listMessage(
          frequent.map((candidate) => `${candidate.customerName}: ${candidate.invoiceCount} invoice(s)`),
          frequent.length,
          "customer"
        )}`,
      };
    }

    case "avg_order": {
      const entry = findCustomerEntry(ledger, store, customerName);
      if (entry) {
        if (entry.invoiceCount === 0) {
          return { ok: true, queryType, message: `${entry.customerName} hasn't purchased yet.` };
        }
        return {
          ok: true,
          queryType,
          message: `${entry.customerName}'s average order is ${formatMoney(entry.averageOrderValue)} across ${entry.invoiceCount} invoice(s).`,
        };
      }
      const total = ledger.totals;
      const overall = total.totalInvoices > 0 ? total.totalSales / total.totalInvoices : 0;
      return {
        ok: true,
        queryType,
        message: `Average order across all customers is ${formatMoney(overall)} (${total.totalInvoices} invoices).`,
      };
    }

    case "top": {
      const top = [...ledger.customers].sort((a, b) => b.totalSales - a.totalSales).slice(0, MAX_LIST);
      if (top.length === 0) {
        return { ok: true, queryType, message: "No customers on record yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Top customers by sales:\n${listMessage(
          top.map((entry) => `${entry.customerName} ${formatMoney(entry.totalSales)} (${entry.invoiceCount} invoice(s))`),
          top.length,
          "customer"
        )}`,
      };
    }

    case "inactive": {
      const cutoff = 30;
      const inactive = ledger.customers
        .filter((entry) => entry.invoiceCount === 0 || (entry.daysSinceLastSale ?? 999) >= cutoff)
        .sort((a, b) => (b.daysSinceLastSale ?? 999) - (a.daysSinceLastSale ?? 999));
      if (inactive.length === 0) {
        return { ok: true, queryType, message: `Every customer has purchased within the last ${cutoff} days.` };
      }
      return {
        ok: true,
        queryType,
        message: `Customer(s) with no purchase in ${cutoff}+ days:\n${listMessage(
          inactive.map((entry) =>
            entry.invoiceCount === 0
              ? `${entry.customerName} (never purchased)`
              : `${entry.customerName} (${entry.daysSinceLastSale} day(s) ago)`
          ),
          inactive.length,
          "customer"
        )}`,
      };
    }

    case "highest_outstanding": {
      const owing = ledger.customers
        .filter((entry) => entry.outstandingBalance > 0)
        .sort((a, b) => b.outstandingBalance - a.outstandingBalance);
      if (owing.length === 0) {
        return { ok: true, queryType, message: "No customer has an outstanding balance." };
      }
      return {
        ok: true,
        queryType,
        message: `Customer(s) with the highest outstanding:\n${listMessage(
          owing.map((entry) => `${entry.customerName} ${formatMoney(entry.outstandingBalance)}`),
          owing.length,
          "customer"
        )}`,
      };
    }

    case "profitable": {
      const profitable = [...ledger.customers]
        .filter((entry) => entry.totalProfit > 0)
        .sort((a, b) => b.totalProfit - a.totalProfit)
        .slice(0, MAX_LIST);
      if (profitable.length === 0) {
        return { ok: true, queryType, message: "No profitability data yet." };
      }
      return {
        ok: true,
        queryType,
        message: `Most profitable customers:\n${listMessage(
          profitable.map(
            (entry) =>
              `${entry.customerName} ${formatMoney(entry.totalProfit)} profit on ${formatMoney(entry.totalSales)} sales`
          ),
          profitable.length,
          "customer"
        )}`,
      };
    }

    case "product_sales": {
      const productName = context.productName?.trim();
      if (!productName || normalized && false) {
        if (!productName) {
          return { ok: false, error: "MISSING_PRODUCT", queryType, message: "Which product would you like me to check?" };
        }
      }
      const periodDays = detectPeriodDays(context.message);
      const windowNote = periodDays !== null ? ` in the last ${periodDays} day(s)` : "";
      const productKey = productName.toLowerCase();
      const buyers: Array<{ entry: CustomerLedgerEntry; units: number; lastDate: string }> = [];
      for (const entry of ledger.customers) {
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
        if (units > 0) buyers.push({ entry, units, lastDate });
      }
      buyers.sort((a, b) => b.units - a.units);
      if (buyers.length === 0) {
        return {
          ok: true,
          queryType,
          message: `No customer bought ${productName}${windowNote}.`,
        };
      }
      return {
        ok: true,
        queryType,
        message: `Customers who bought ${productName}${windowNote}:\n${listMessage(
          buyers.map(({ entry, units }) => `${entry.customerName} (${units} unit(s))`),
          buyers.length,
          "customer"
        )}`,
      };
    }

    case "summary":
    default: {
      const total = ledger.totals;
      const parts: string[] = [
        `You have ${ledger.customers.length} customer(s).`,
        `Total sales: ${formatMoney(total.totalSales)} (${total.totalInvoices} invoice(s)).`,
        `Total outstanding: ${formatMoney(total.totalOutstanding)}${total.totalOverdue > 0 ? `, of which ${formatMoney(total.totalOverdue)} is overdue` : ""}.`,
      ];
      if (total.customersOwing > 0) parts.push(`${total.customersOwing} customer(s) owe money.`);
      const blocked = ledger.customers.filter((entry) => entry.isBlocked).length;
      if (blocked > 0) parts.push(`${blocked} customer(s) are blocked from credit.`);
      return { ok: true, queryType, message: parts.join(" ") };
    }
  }
}
