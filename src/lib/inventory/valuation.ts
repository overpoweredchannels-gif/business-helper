// Inventory valuation — the ONE cost basis for stock value (M1 decision 1,
// UMAIR-approved 2026-10-22).
//
// Headline stock value = Σ over products of max(stock, 0) × cost, where cost
// is the product's last purchase price when known (> 0). A product with
// stock on hand but no known cost contributes 0 to the headline — it is
// NEVER silently valued at its selling price (the old Dashboard rule, which
// overstated the figure: production read Rs 8,429,691.56 on the Dashboard
// vs Rs 6,717,241.56 in Business Intelligence). Unknown-cost stock is
// surfaced separately as a flagged set: product count, units, and an
// explicitly-labelled selling-price ESTIMATE. Negative stock clamps at 0
// (the old Dashboard rule subtracted it; BI already clamped).
//
// Both the Dashboard (page.tsx inventoryValue) and Business Intelligence
// (inventoryStockValue) consume this module over the full product list, so
// the two figures are identical by construction. Do not fork the logic.

import { safeNumber } from "@/lib/tradeos/validators";

export interface InventoryValuationProductInput {
  productId: string | number;
  productName?: string | null;
  currentStock?: number | string | null;
  lastPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
}

export interface UnknownCostStockItem {
  productId: string;
  productName: string;
  units: number;
  /** Stock × selling price — an ESTIMATE for flagging, never part of the headline value. */
  sellingPriceEstimate: number;
}

export interface InventoryValuation {
  /** Headline cost-basis stock value (known-cost stock only, negatives clamped). */
  totalValue: number;
  unknownCostProductCount: number;
  unknownCostUnits: number;
  /** Selling-price estimate of the unknown-cost stock — display only, always labelled an estimate. */
  unknownCostSellingEstimate: number;
  unknownCostProducts: UnknownCostStockItem[];
}

export function computeInventoryValuation(
  products: readonly InventoryValuationProductInput[]
): InventoryValuation {
  let totalValue = 0;
  let unknownCostUnits = 0;
  let unknownCostSellingEstimate = 0;
  const unknownCostProducts: UnknownCostStockItem[] = [];

  for (const product of products) {
    const stock = safeNumber(product.currentStock);
    const cost = safeNumber(product.lastPurchasePrice);
    if (cost > 0) {
      totalValue += Math.max(0, stock) * cost;
      continue;
    }
    if (stock > 0) {
      const sellingPrice = Math.max(0, safeNumber(product.defaultSellingPrice));
      const estimate = stock * sellingPrice;
      unknownCostUnits += stock;
      unknownCostSellingEstimate += estimate;
      unknownCostProducts.push({
        productId: String(product.productId),
        productName: product.productName ?? "",
        units: stock,
        sellingPriceEstimate: estimate,
      });
    }
  }

  return {
    totalValue,
    unknownCostProductCount: unknownCostProducts.length,
    unknownCostUnits,
    unknownCostSellingEstimate,
    unknownCostProducts,
  };
}
