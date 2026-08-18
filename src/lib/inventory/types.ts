// Inventory Management (Phase 1) — shared types.
// Mirrors the database schema in src/lib/inventory/schema.sql.

export type InventoryMovementType =
  | "purchase_in"
  | "sale_out"
  | "return_out"
  | "return_in"
  | "adjustment_in"
  | "adjustment_out";

export interface InventoryTransaction {
  id: string;
  organization_id: string;
  product_id: number;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  reason: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InventoryAdjustmentInput {
  product_id: number;
  quantity_delta: number;
  reason: string;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export type InventoryStatus =
  | "out_of_stock"
  | "urgent_reorder"
  | "low_stock_soon"
  | "healthy"
  | "missing_reorder_level";

export interface InventorySnapshotItem {
  productId: string | number;
  productName: string;
  brandName: string;
  categoryName: string;
  unitType: string;
  currentStock: number;
  totalIn: number;
  totalOut: number;
  reorderLevel: number;
  suggestedReorderQuantity: number;
  status: InventoryStatus;
  missingReorderLevel: boolean;
  lastMovementAt: string | null;
}

export interface InventoryBatchBreakdown {
  batchNumber: string;
  expiryDate: string | null;
  received: number;
  issued: number;
  balance: number;
}

export interface LedgerRow extends InventoryTransaction {
  runningBalance: number;
}
