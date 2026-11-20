/**
 * AI alert thresholds — relative rule (P1 Area J follow-up).
 *
 * Defect: the alert generator (`generateAiBusinessAlerts` in page.tsx)
 * compared books-currency amounts against hardcoded PKR-era constants
 * (`payable >= 100000`, expense day total `>= 25000`). Amounts are
 * denominated in the org's books currency, so in a EUR org — where a
 * supplier payable is in the hundreds — the supplier_ledger alert could
 * essentially never fire, and the expense alert needed a €25,000 day.
 * The stale Rs204,000 alert was the only reason the card ever showed a
 * supplier alert at all.
 *
 * Fix — a RELATIVE rule: each threshold is a share of the org's own live
 * figures, computed from the data the generator already holds. No
 * exchange rate, no currency constant, no new settings surface:
 *
 * - Supplier payable: 5% of total outstanding payables (all suppliers).
 *   "Pressure" means one supplier holding a material share of everything
 *   the org owes. Live check: total payables €9,475.86 → threshold
 *   €473.79, so NATURA HARVERST at ~€660 qualifies; a €300 payable
 *   does not. The top-10 cap still bounds the list.
 * - Supplier high severity: 12.5% of total outstanding payables
 *   (2.5x the base — the old 250,000 / 100,000 ratio, preserved).
 * - Expense day: 10% of trailing-30-day expenses. One day at a tenth
 *   of the month's spending is ~3x the daily average — an unusual day.
 * - Expense high severity: 30% of trailing-30-day expenses
 *   (3x the base — the old 75,000 / 25,000 ratio, preserved).
 * - Customer overdue high severity: 10% of total outstanding
 *   receivables. (The customer alert itself fires for any overdue > 0;
 *   this only sets the severity boundary.)
 *
 * Why relative, and why not the other options (UMAIR, 2026-11-20 17:25):
 * - Stored exchange rate: RULED OUT by the user. The first version of
 *   this slice scaled the PKR baselines at the stored PKR-per-unit rate
 *   (100,000 / 312 = €320.51); it was discarded, not shipped. If the
 *   stored rate goes stale, the threshold silently goes wrong with it
 *   — a threshold must never depend on a number nobody re-checks.
 * - Per-org configurable threshold: needs a settings surface + storage
 *   for a value the org's own figures already determine. The relative
 *   rule tracks the business as it grows with no new UI; a per-org
 *   override remains a possible later addition, not a prerequisite.
 *
 * Zero-baseline guard: when a denominator is zero, negative or not a
 * finite number, that threshold is +Infinity — the alert type does not
 * fire. With no baseline there is nothing to judge materiality against;
 * firing every payable would be noise, and falling back to the old PKR
 * constants would reintroduce the currency-blind defect. (In practice
 * a zero denominator means the org has no payables / expenses /
 * receivables at all in the window, so there is nothing to alert on.)
 *
 * The ratios below are dimensionless percentages, not currency amounts:
 * they carry no PKR, EUR or any other currency figure.
 */
export const AI_ALERT_THRESHOLD_RATIOS = {
  /** Share of total outstanding payables that flags supplier pressure. */
  supplierPayable: 0.05,
  /** Share of total outstanding payables that flags it at "high" severity. */
  supplierPayableHigh: 0.125,
  /** Share of trailing-30-day expenses that flags an expense day. */
  expenseDay: 0.1,
  /** Share of trailing-30-day expenses that flags it at "high" severity. */
  expenseDayHigh: 0.3,
  /** Share of total outstanding receivables that flags an overdue at "high" severity. */
  customerOverdueHigh: 0.1,
} as const;

export interface AiAlertThresholdInputs {
  /** Sum of remaining payable across all suppliers, books currency. */
  totalOutstandingPayables: number;
  /** Sum of expenses dated in the trailing 30 days, books currency. */
  trailing30DayExpenses: number;
  /** Sum of overdue amounts across all customers, books currency. */
  totalOutstandingReceivables: number;
}

export interface AiAlertThresholds {
  supplierPayable: number;
  supplierPayableHigh: number;
  expenseDay: number;
  expenseDayHigh: number;
  customerOverdueHigh: number;
}

/**
 * Scale the dimensionless ratios into books-currency thresholds from
 * the org's own live figures. A missing baseline (zero, negative or
 * non-finite) yields +Infinity for that threshold — the alert type
 * does not fire — never a guessed number and never the old PKR
 * constants.
 */
export function aiAlertThresholdsRelative(inputs: AiAlertThresholdInputs): AiAlertThresholds {
  const scale = (base: number, ratio: number): number =>
    typeof base === "number" && Number.isFinite(base) && base > 0 ? base * ratio : Number.POSITIVE_INFINITY;
  return {
    supplierPayable: scale(inputs.totalOutstandingPayables, AI_ALERT_THRESHOLD_RATIOS.supplierPayable),
    supplierPayableHigh: scale(inputs.totalOutstandingPayables, AI_ALERT_THRESHOLD_RATIOS.supplierPayableHigh),
    expenseDay: scale(inputs.trailing30DayExpenses, AI_ALERT_THRESHOLD_RATIOS.expenseDay),
    expenseDayHigh: scale(inputs.trailing30DayExpenses, AI_ALERT_THRESHOLD_RATIOS.expenseDayHigh),
    customerOverdueHigh: scale(inputs.totalOutstandingReceivables, AI_ALERT_THRESHOLD_RATIOS.customerOverdueHigh),
  };
}
