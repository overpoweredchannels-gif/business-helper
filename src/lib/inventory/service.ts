// Inventory Management (Phase 1) — pure ledger/snapshot logic.
//
// No database access here: everything is derived from the list of
// inventory_transactions rows fetched by the client. These functions are the
// display + decision layer for the Inventory Dashboard, Stock Ledger and
// Stock Adjustment screens. The database schema lives in
// src/lib/inventory/schema.sql; the fetch/write calls live in
// src/app/page.tsx and src/app/api/inventory/adjust/route.ts.

import type {
  InventoryBatchBreakdown,
  InventoryMovementType,
  InventorySnapshotItem,
  InventoryStatus,
  InventoryTransaction,
  LedgerRow,
} from "./types";

export const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  purchase_in: "Purchase Receipt",
  sale_out: "Sales Issue",
  return_out: "Purchase Return",
  return_in: "Sales Return",
  adjustment_in: "Adjustment In",
  adjustment_out: "Adjustment Out",
};

export const movementLabel = (type: string): string =>
  MOVEMENT_LABELS[type as InventoryMovementType] ?? type;

export const isAdjustmentType = (type: string): boolean =>
  type === "adjustment_in" || type === "adjustment_out";

// ─── Running balances ───────────────────────────────────────────────────────

// Normalizes a product id for map keys. product_id may be an integer (dev) or
// a uuid string (production), so map keys are always strings.
const productKey = (id: string | number | null | undefined): string =>
  id === null || id === undefined ? "" : String(id);

// Adds a cumulative running balance per product (assumes the input is
// already sorted chronologically).
export const withRunningBalances = (transactions: InventoryTransaction[]): LedgerRow[] => {
  const balances = new Map<string, number>();
  return transactions.map((transaction) => {
    const productId = productKey(transaction.product_id);
    const previous = balances.get(productId) ?? 0;
    const runningBalance = previous + Number(transaction.quantity_delta);
    balances.set(productId, runningBalance);
    return { ...transaction, runningBalance };
  });
};

export const totalDeltaForProduct = (
  transactions: InventoryTransaction[],
  productId: number | string
): number => {
  const key = productKey(productId);
  return transactions
    .filter((transaction) => productKey(transaction.product_id) === key)
    .reduce((sum, transaction) => sum + Number(transaction.quantity_delta), 0);
};

// ─── Snapshots / statuses ───────────────────────────────────────────────────

export interface SnapshotProduct {
  id: number | string;
  name: string;
  brandName?: string;
  categoryName?: string;
  unitType?: string | null;
  reorderLevel?: number | null;
}

export const stockStatusFor = (
  currentStock: number,
  reorderLevel: number | null | undefined
): { status: InventoryStatus; missingReorderLevel: boolean } => {
  const level = Number(reorderLevel || 0);
  if (currentStock <= 0) return { status: "out_of_stock", missingReorderLevel: level <= 0 };
  if (level <= 0) return { status: "missing_reorder_level", missingReorderLevel: true };
  if (currentStock <= level) return { status: "urgent_reorder", missingReorderLevel: false };
  return { status: "healthy", missingReorderLevel: false };
};

export const suggestedReorderFor = (
  currentStock: number,
  reorderLevel: number | null | undefined
): number => {
  const level = Number(reorderLevel || 0);
  return level > 0 ? Math.max(level * 2 - currentStock, 0) : 0;
};

export const buildInventorySnapshots = (
  products: SnapshotProduct[],
  transactions: InventoryTransaction[]
): InventorySnapshotItem[] => {
  const byProduct = new Map<string, InventoryTransaction[]>();
  for (const transaction of transactions) {
    const productId = productKey(transaction.product_id);
    const list = byProduct.get(productId) ?? [];
    list.push(transaction);
    byProduct.set(productId, list);
  }

  return products.map((product) => {
    const productId = productKey(product.id);
    const productTransactions = byProduct.get(productId) ?? [];
    const totalIn = productTransactions
      .filter((transaction) => Number(transaction.quantity_delta) > 0)
      .reduce((sum, transaction) => sum + Number(transaction.quantity_delta), 0);
    const totalOut = productTransactions
      .filter((transaction) => Number(transaction.quantity_delta) < 0)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.quantity_delta)), 0);
    const currentStock = totalIn - totalOut;
    const { status, missingReorderLevel } = stockStatusFor(currentStock, product.reorderLevel);
    const lastMovementAt =
      productTransactions.length > 0
        ? productTransactions[productTransactions.length - 1].created_at
        : null;

    return {
      productId,
      productName: product.name,
      brandName: product.brandName ?? "",
      categoryName: product.categoryName ?? "",
      unitType: product.unitType ?? "units",
      currentStock,
      totalIn,
      totalOut,
      reorderLevel: Number(product.reorderLevel || 0),
      suggestedReorderQuantity: suggestedReorderFor(currentStock, product.reorderLevel),
      status,
      missingReorderLevel,
      lastMovementAt,
    };
  });
};

// ─── Ledger querying ────────────────────────────────────────────────────────

export interface LedgerQuery {
  movementType: string | null;
  productId: number | null;
  searchText: string;
  productNames: Map<string, string>;
}

// Returns chronological ledger rows (with running balances) filtered by
// movement type / product / free-text search, plus the opening balance per
// product (stock before the first visible row of that product).
export const queryLedger = (
  transactions: InventoryTransaction[],
  query: LedgerQuery
): { rows: LedgerRow[]; openingBalances: Map<string, number> } => {
  const all = withRunningBalances(transactions);
  const searchTerm = query.searchText.trim().toLowerCase();
  const rows: LedgerRow[] = [];
  const openingBalances = new Map<string, number>();
  const seenProducts = new Set<string>();

  for (const transaction of all) {
    const productId = productKey(transaction.product_id);
    const productName = query.productNames.get(productId) ?? "";

    if (query.movementType && transaction.movement_type !== query.movementType) continue;
    if (query.productId !== null && productKey(query.productId) !== productId) continue;
    if (
      searchTerm &&
      !productName.toLowerCase().includes(searchTerm) &&
      !(transaction.batch_number ?? "").toLowerCase().includes(searchTerm)
    ) {
      continue;
    }

    if (!seenProducts.has(productId)) {
      openingBalances.set(productId, transaction.runningBalance - Number(transaction.quantity_delta));
      seenProducts.add(productId);
    }
    rows.push(transaction);
  }

  return { rows, openingBalances };
};

// ─── Batch support / FIFO preparation ───────────────────────────────────────

// Per-batch balance for a product (received / issued / remaining). Purchases
// carry batch_number + expiry_date, so this is the structure a future FIFO
// costing pass will consume — no costing is computed yet (Phase 1).
export const getBatchBreakdown = (
  transactions: InventoryTransaction[],
  productId: number | string
): InventoryBatchBreakdown[] => {
  const byBatch = new Map<string, InventoryBatchBreakdown>();
  const targetKey = productKey(productId);

  for (const transaction of transactions) {
    if (productKey(transaction.product_id) !== targetKey) continue;
    const batchNumber = transaction.batch_number ?? "(no batch)";
    const entry = byBatch.get(batchNumber) ?? {
      batchNumber,
      expiryDate: null,
      received: 0,
      issued: 0,
      balance: 0,
    };
    if (transaction.expiry_date) entry.expiryDate = transaction.expiry_date;
    if (Number(transaction.quantity_delta) > 0) {
      entry.received += Number(transaction.quantity_delta);
    } else {
      entry.issued += Math.abs(Number(transaction.quantity_delta));
    }
    entry.balance = entry.received - entry.issued;
    byBatch.set(batchNumber, entry);
  }

  return Array.from(byBatch.values()).sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return a.batchNumber.localeCompare(b.batchNumber);
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.localeCompare(b.expiryDate);
  });
};

export const formatMovementChange = (delta: number): string =>
  `${delta > 0 ? "+" : ""}${Number(delta.toFixed(2))}`;
