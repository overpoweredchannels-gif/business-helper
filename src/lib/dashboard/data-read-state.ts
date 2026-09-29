export const dashboardReadSources = [
  "sales-transactions",
  "sales-items",
  "products",
  "customers",
  "customer-payments",
  "customer-payment-allocations",
  "expenses",
  "suppliers",
  "purchase-transactions",
  "purchase-items",
  "supplier-payments",
  "supplier-payment-allocations",
  "tasks",
  "sales-orders",
] as const;

export type DashboardReadSource = typeof dashboardReadSources[number];
export type DashboardReadStatus = "not-loaded" | "loading" | "successful-empty" | "successful-populated" | "failed";

export interface DashboardSourceState {
  status: DashboardReadStatus;
  rowCount?: number;
  lastSuccessAt?: string;
}

export type DashboardSourceStates = Record<DashboardReadSource, DashboardSourceState>;

export const dashboardMetricDependencies = {
  "today-sales": ["sales-transactions", "sales-items"],
  "today-profit": ["sales-transactions", "sales-items", "products"],
  "inventory-value": ["products"],
  receivables: ["customers", "sales-transactions", "sales-items", "customer-payments", "customer-payment-allocations"],
  payables: ["suppliers", "purchase-transactions", "purchase-items", "supplier-payments", "supplier-payment-allocations"],
  "low-stock": ["products"],
  "pending-approvals": ["sales-orders"],
  "collection-tasks": ["tasks"],
  "unpaid-purchases": ["suppliers", "purchase-transactions", "purchase-items", "supplier-payments", "supplier-payment-allocations"],
  "urgent-reorders": ["products"],
  "customer-follow-ups": ["tasks"],
  "expiring-stock-checks": ["tasks"],
  "business-health": [
    // Score and profit margin: sales revenue/costs, collections, and expenses.
    "sales-transactions",
    "sales-items",
    "products",
    "customer-payments",
    "expenses",
    // Cash Flow: complete receivables and payables allocations.
    "customers",
    "customer-payment-allocations",
    "suppliers",
    "purchase-transactions",
    "purchase-items",
    "supplier-payments",
    "supplier-payment-allocations",
  ],
} as const satisfies Record<string, readonly DashboardReadSource[]>;

export type DashboardMetricKey = keyof typeof dashboardMetricDependencies;
export type DashboardMetricStates = Record<DashboardMetricKey, DashboardReadStatus>;

export function dashboardReadStatusLabel(status: DashboardReadStatus) {
  switch (status) {
    case "not-loaded": return "Not loaded";
    case "loading": return "Loading…";
    case "failed": return "Unavailable";
    default: return null;
  }
}

export function emptyDashboardSourceStates(): DashboardSourceStates {
  return Object.fromEntries(dashboardReadSources.map((source) => [source, { status: "not-loaded" }])) as DashboardSourceStates;
}

export function deriveDashboardMetricStates(sources: DashboardSourceStates): DashboardMetricStates {
  return Object.fromEntries(
    Object.entries(dashboardMetricDependencies).map(([metric, dependencies]) => {
      const states = dependencies.map((source) => sources[source].status);
      const status: DashboardReadStatus = states.includes("failed")
        ? "failed"
        : states.includes("not-loaded")
          ? "not-loaded"
          : states.includes("loading")
            ? "loading"
            : states.every((state) => state === "successful-empty")
              ? "successful-empty"
              : "successful-populated";
      return [metric, status];
    }),
  ) as DashboardMetricStates;
}

/**
 * If a metric has failed after previously succeeding, return a conservative
 * timestamp for its retained source data. The oldest source timestamp is used
 * because the metric is only as fresh as its oldest dependency.
 */
export function dashboardMetricLastSuccessAt(metric: DashboardMetricKey, sources: DashboardSourceStates) {
  const timestamps = dashboardMetricDependencies[metric].map((source) => sources[source].lastSuccessAt);
  if (timestamps.some((timestamp) => !timestamp)) return undefined;
  return timestamps.sort()[0];
}

export function deriveDashboardMetricLastSuccessAt(sources: DashboardSourceStates): Partial<Record<DashboardMetricKey, string>> {
  return Object.fromEntries(
    Object.keys(dashboardMetricDependencies).flatMap((metric) => {
      const timestamp = dashboardMetricLastSuccessAt(metric as DashboardMetricKey, sources);
      return timestamp ? [[metric, timestamp]] : [];
    }),
  ) as Partial<Record<DashboardMetricKey, string>>;
}

export interface DashboardReadRequest {
  source: DashboardReadSource;
  accountId: string;
  organizationId: string;
  requestId: number;
}

export type DashboardReadResult<T> =
  | { status: "success"; data: T[] }
  | { status: "failed"; error: unknown }
  | { status: "ignored" };

export class DashboardReadTracker {
  private scope: { accountId: string; organizationId: string } | null = null;
  private requestId = 0;
  private latestRequestBySource = new Map<DashboardReadSource, number>();
  private sourceStates = emptyDashboardSourceStates();

  constructor(private readonly publish: (states: DashboardSourceStates) => void) {}

  activate(accountId: string, organizationId: string) {
    this.scope = { accountId, organizationId };
    this.latestRequestBySource.clear();
    this.sourceStates = emptyDashboardSourceStates();
    this.publish(this.sourceStates);
  }

  invalidate() {
    this.scope = null;
    this.latestRequestBySource.clear();
    this.sourceStates = emptyDashboardSourceStates();
    this.publish(this.sourceStates);
  }

  begin(source: DashboardReadSource, accountId: string, organizationId: string): DashboardReadRequest | null {
    if (this.scope?.accountId !== accountId || this.scope.organizationId !== organizationId) return null;
    const requestId = ++this.requestId;
    this.latestRequestBySource.set(source, requestId);
    const previous = this.sourceStates[source];
    this.sourceStates = {
      ...this.sourceStates,
      [source]: { status: "loading", rowCount: previous.rowCount, lastSuccessAt: previous.lastSuccessAt },
    };
    this.publish(this.sourceStates);
    return { source, accountId, organizationId, requestId };
  }

  isCurrent(request: DashboardReadRequest) {
    return this.scope?.accountId === request.accountId &&
      this.scope.organizationId === request.organizationId &&
      this.latestRequestBySource.get(request.source) === request.requestId;
  }

  succeed<T>(request: DashboardReadRequest, data: T[], commit: (data: T[]) => void, now = new Date().toISOString()) {
    if (!this.isCurrent(request)) return false;
    commit(data);
    this.sourceStates = {
      ...this.sourceStates,
      [request.source]: {
        status: data.length === 0 ? "successful-empty" : "successful-populated",
        rowCount: data.length,
        lastSuccessAt: now,
      },
    };
    this.publish(this.sourceStates);
    return true;
  }

  fail(request: DashboardReadRequest) {
    if (!this.isCurrent(request)) return false;
    const previous = this.sourceStates[request.source];
    this.sourceStates = {
      ...this.sourceStates,
      [request.source]: { status: "failed", rowCount: previous.rowCount, lastSuccessAt: previous.lastSuccessAt },
    };
    this.publish(this.sourceStates);
    return true;
  }

  read<T>(
    source: DashboardReadSource,
    accountId: string,
    organizationId: string,
    load: () => Promise<T[]>,
    commit: (data: T[]) => void,
  ): Promise<DashboardReadResult<T>> {
    const request = this.begin(source, accountId, organizationId);
    if (!request) return Promise.resolve({ status: "ignored" });
    // Defer invocation so synchronous exceptions follow the same failed-read path.
    return Promise.resolve()
      .then(load)
      .then((data): DashboardReadResult<T> => this.succeed(request, data, commit) ? { status: "success", data } : { status: "ignored" })
      .catch((error: unknown): DashboardReadResult<T> => this.fail(request) ? { status: "failed", error } : { status: "ignored" });
  }
}

export async function runDashboardSourceRead<T>(
  tracker: DashboardReadTracker,
  source: DashboardReadSource,
  accountId: string,
  organizationId: string,
  load: () => Promise<T[]>,
  commit: (rows: T[]) => void,
  reportError: (error: unknown) => void,
) {
  const result = await tracker.read(source, accountId, organizationId, load, commit);
  if (result.status === "failed") reportError(result.error);
  return result;
}
