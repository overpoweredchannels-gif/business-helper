// Stored-balance reconciliation audit — READ-ONLY.
//
// Lists every customer in every organization whose stored
// outstanding_balance differs from the balance derived from the ledger
// (Single Source of Truth formula: Credit Sales − Confirmed Returns −
// Non-Voided Payments). Exits non-zero when any drift is found.
//
// READ-ONLY BY CONSTRUCTION: this script issues SELECTs only. It never
// inserts, updates, deletes, or calls a write RPC. Do not add a write
// path here — corrections go through
// correct_outstanding_balance_atomic / recompute_customer_outstanding_balance
// (audit-logged, per-party, owner-approved) or the correction SQL file.
//
// Run:
//   NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/audit-stored-balances.ts
// The service-role key is required: an anon key only sees the caller's own
// organization (RLS), while this audit must cover ALL organizations.
// Never commit a key; pass it via the environment only.
//
// The comparison reuses deriveCustomerOutstanding / reconcileCustomerBalance
// (src/lib/accounting/customer-balance.ts) — the same formula the database
// enforces (customer_derived_outstanding). A customer is flagged when
// |stored − derived| exceeds 0.01 (one cent; sub-cent JS float noise is not
// drift).

import { createClient } from "@supabase/supabase-js";
import {
  deriveCustomerOutstanding,
  reconcileCustomerBalance,
  type BalanceAllocationRow,
  type BalanceInvoiceRow,
  type BalancePaymentRow,
  type CustomerBalanceLedgerInput,
} from "../src/lib/accounting/customer-balance";

const PAGE_SIZE = 1000;

interface CustomerRow {
  id: string;
  organization_id: string;
  customer_name: string | null;
  outstanding_balance: number | null;
}

async function fetchAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing environment: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role is required to read ALL organizations)."
    );
    return 1;
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Organizations first, then one org at a time (bounded memory per org).
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("id, name");
  if (orgError) throw new Error(`organizations: ${orgError.message}`);
  const orgList = (orgs ?? []) as { id: string; name: string | null }[];
  console.log(`Auditing ${orgList.length} organization(s)…`);

  let checked = 0;
  let drifted = 0;
  const driftRows: {
    orgId: string;
    orgName: string | null;
    customerId: string;
    customerName: string | null;
    stored: number;
    derived: number;
    drift: number;
  }[] = [];

  for (const org of orgList) {
    const orgId = org.id;
    const customers = await fetchAll<CustomerRow>((from, to) =>
      supabase
        .from("customers")
        .select("id, organization_id, customer_name, outstanding_balance")
        .eq("organization_id", orgId)
        .range(from, to)
    );
    if (customers.length === 0) continue;

    const customerIds = customers.map((c) => c.id);
    const transactions = await fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("sales_transactions")
        .select("id, customer_id, total_amount, payment_type, status, sale_date, created_at")
        .eq("organization_id", orgId)
        .in("customer_id", customerIds)
        .range(from, to)
    );
    const payments = await fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("customer_payments")
        .select("id, customer_id, amount, voided_at")
        .eq("organization_id", orgId)
        .in("customer_id", customerIds)
        .range(from, to)
    );
    const txIds = transactions.map((t) => String(t.id));
    const allocations =
      txIds.length === 0
        ? []
        : await fetchAll<Record<string, unknown>>((from, to) =>
            supabase
              .from("customer_payment_allocations")
              .select("sales_transaction_id, amount, customer_payment_id")
              .eq("organization_id", orgId)
              .in("sales_transaction_id", txIds)
              .range(from, to)
          );
    const returns = await fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("sales_returns")
        .select("id, sales_transaction_id, status")
        .eq("organization_id", orgId)
        .in("sales_transaction_id", txIds.length === 0 ? ["00000000-0000-0000-0000-000000000000"] : txIds)
        .range(from, to)
    );
    const returnIds = returns.map((r) => String(r.id));
    const returnItems =
      returnIds.length === 0
        ? []
        : await fetchAll<Record<string, unknown>>((from, to) =>
            supabase
              .from("sales_return_items")
              .select("sales_return_id, quantity, unit_price, discount")
              .in("sales_return_id", returnIds)
              .range(from, to)
          );

    const invoices: BalanceInvoiceRow[] = transactions.map((t) => ({
      id: String(t.id),
      customerId: String(t.customer_id),
      invoiceTotal: Number(t.total_amount ?? 0),
      paymentType: (t.payment_type as string | null) ?? null,
      status: (t.status as string | null) ?? null,
      sortDate: String((t.sale_date as string | null) ?? (t.created_at as string | null) ?? "").slice(0, 10),
      createdAt: String(t.created_at ?? ""),
    }));
    const paymentRows: BalancePaymentRow[] = payments.map((p) => ({
      id: p.id == null ? null : String(p.id),
      customerId: p.customer_id == null ? null : String(p.customer_id),
      amount: Number(p.amount ?? 0),
      voidedAt: (p.voided_at as string | null) ?? null,
    }));
    const allocationRows: BalanceAllocationRow[] = allocations.map((a) => ({
      salesTransactionId: String(a.sales_transaction_id),
      amount: Number(a.amount ?? 0),
      customerPaymentId: a.customer_payment_id == null ? null : String(a.customer_payment_id),
    }));

    for (const customer of customers) {
      checked += 1;
      const input: CustomerBalanceLedgerInput = {
        transactions: invoices.filter((t) => t.customerId === customer.id),
        payments: paymentRows.filter((p) => p.customerId === customer.id),
        allocations: allocationRows.filter((a) =>
          invoices.some((t) => t.id === a.salesTransactionId && t.customerId === customer.id)
        ),
        returns: returns
          .filter((r) =>
            invoices.some((t) => t.id === String(r.sales_transaction_id) && t.customerId === customer.id)
          )
          .map((r) => ({
            id: String(r.id),
            sales_transaction_id: r.sales_transaction_id as string | number | null,
            status: (r.status as string | null) ?? null,
          })),
        returnItems: returnItems
          .filter((i) =>
            returns.some(
              (r) =>
                String(r.id) === String(i.sales_return_id) &&
                invoices.some((t) => t.id === String(r.sales_transaction_id) && t.customerId === customer.id)
            )
          )
          .map((i) => ({
            sales_return_id: String(i.sales_return_id),
            quantity: Number(i.quantity ?? 0),
            unit_price: Number(i.unit_price ?? 0),
            discount: Number(i.discount ?? 0),
          })),
      };
      const derived = deriveCustomerOutstanding(input).outstanding;
      const check = reconcileCustomerBalance(customer.outstanding_balance, derived);
      if (!check.inSync) {
        drifted += 1;
        driftRows.push({
          orgId,
          orgName: org.name,
          customerId: customer.id,
          customerName: customer.customer_name,
          stored: check.stored,
          derived: check.derived,
          drift: check.drift,
        });
      }
    }
  }

  console.log(`Checked ${checked} customer(s) across ${orgList.length} organization(s).`);
  if (driftRows.length === 0) {
    console.log("No drift found: every stored balance matches its derived balance.");
    return 0;
  }
  console.log(`DRIFT FOUND in ${drifted} customer(s):`);
  for (const row of driftRows) {
    console.log(
      `  org=${row.orgName ?? row.orgId} customer=${row.customerName ?? row.customerId} ` +
        `stored=${row.stored.toFixed(2)} derived=${row.derived.toFixed(2)} drift=${row.drift.toFixed(2)}`
    );
  }
  console.log(
    "Correct one party at a time with recompute_customer_outstanding_balance (audit-logged) — never by a bulk UPDATE."
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`Audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
