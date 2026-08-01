import type { MemoryStore } from "../brain/memory/business-memory";
import type { ProductMemory } from "../brain/contracts/memory";

export type InventoryQueryIntent =
  | "quantity_lookup"
  | "low_stock"
  | "reorder"
  | "below_reorder"
  | "out_of_stock"
  | "overstocked"
  | "inventory_value"
  | "category_summary"
  | "brand_summary"
  | "fast_moving"
  | "slow_moving";

export interface InventoryQueryResult {
  ok: boolean;
  message: string;
  error?: string;
  queryType: InventoryQueryIntent | null;
}

export function processInventoryQuery(
  queryType: InventoryQueryIntent | null,
  productName: string | null,
  store: MemoryStore
): InventoryQueryResult {
  const allProducts = Array.from(store.products.values()).filter((p) => p.isActive !== false);
  const inventory = store.inventory;
  const product = productName ? resolveProduct(productName, store) : null;

  switch (queryType) {
    case "quantity_lookup":
      return handleQuantityLookup(product, productName);
    case "low_stock":
      return handleLowStock(allProducts, inventory);
    case "reorder":
      return handleReorder(allProducts);
    case "below_reorder":
      return handleBelowReorder(allProducts);
    case "out_of_stock":
      return handleOutOfStock(allProducts, inventory);
    case "overstocked":
      return handleOverstocked(allProducts, inventory);
    case "inventory_value":
      return handleInventoryValue(allProducts, inventory);
    case "category_summary":
      return handleCategorySummary(allProducts);
    case "brand_summary":
      return handleBrandSummary(allProducts);
    case "fast_moving":
      return handleFastMoving(allProducts);
    case "slow_moving":
      return handleSlowMoving(allProducts);
    default:
      return fallbackInventoryResponse(allProducts, inventory);
  }
}

function resolveProduct(name: string, store: MemoryStore): ProductMemory | null {
  const results = store.searchProducts(name, 0.4, 1);
  if (results.length > 0 && results[0].score >= 0.5) {
    return results[0].item;
  }
  const exact = store.findExactProduct(name);
  if (exact) return exact;
  for (const [id, p] of store.products.entries()) {
    if (p.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}

function handleQuantityLookup(product: ProductMemory | null, productName: string | null): InventoryQueryResult {
  if (!product || !productName) {
    const msg = productName
      ? `I could not find a product called ${productName}. Please check the name and try again.`
      : "Please tell me which product you want to check the stock for.";
    return { ok: false, message: msg, error: "PRODUCT_NOT_FOUND", queryType: "quantity_lookup" };
  }
  return {
    ok: true,
    message: formatQuantityResponse(product),
    queryType: "quantity_lookup",
  };
}

function handleLowStock(allProducts: ProductMemory[], inventory: { lowStockCount: number }): InventoryQueryResult {
  const lowStock = allProducts.filter(
    (p) => p.stockStatus === "urgent" || p.stockStatus === "low_soon" || (p.reorderLevel > 0 && p.currentStock <= p.reorderLevel)
  );
  if (lowStock.length === 0) {
    return { ok: true, message: "No products are currently low in stock.", queryType: "low_stock" };
  }
  const top = lowStock.slice(0, 5);
  const items = top.map((p) => `${p.name}: ${p.currentStock} units remaining${p.estimatedDaysLeft !== null ? `, estimated ${p.estimatedDaysLeft} days left` : ""}`);
  const extra = lowStock.length > 5 ? ` And ${lowStock.length - 5} more products.` : "";
  return {
    ok: true,
    message: `Low stock products: ${items.join(". ")}.${extra}`,
    queryType: "low_stock",
  };
}

function handleReorder(allProducts: ProductMemory[]): InventoryQueryResult {
  const reorder = allProducts.filter((p) => p.needsReorder);
  if (reorder.length === 0) {
    return { ok: true, message: "No products need reordering at this time.", queryType: "reorder" };
  }
  const top = reorder.slice(0, 5);
  const items = top.map((p) => `${p.name}: stock ${p.currentStock}, reorder level ${p.reorderLevel}`);
  const extra = reorder.length > 5 ? ` And ${reorder.length - 5} more products need reordering.` : "";
  return {
    ok: true,
    message: `Products that should be reordered: ${items.join(". ")}.${extra}`,
    queryType: "reorder",
  };
}

function handleBelowReorder(allProducts: ProductMemory[]): InventoryQueryResult {
  const below = allProducts.filter((p) => p.reorderLevel > 0 && p.currentStock < p.reorderLevel);
  if (below.length === 0) {
    return { ok: true, message: "All products are above their reorder levels.", queryType: "below_reorder" };
  }
  const top = below.slice(0, 5);
  const items = top.map((p) => `${p.name}: ${p.currentStock} units, reorder level is ${p.reorderLevel}`);
  const extra = below.length > 5 ? ` And ${below.length - 5} more products are below reorder level.` : "";
  return {
    ok: true,
    message: `Products below reorder level: ${items.join(". ")}.${extra}`,
    queryType: "below_reorder",
  };
}

function handleOutOfStock(allProducts: ProductMemory[], inventory: { outOfStockCount: number }): InventoryQueryResult {
  const outOfStock = allProducts.filter((p) => p.stockStatus === "out_of_stock" || p.currentStock <= 0);
  if (outOfStock.length === 0) {
    return { ok: true, message: "No products are out of stock.", queryType: "out_of_stock" };
  }
  const top = outOfStock.slice(0, 5);
  const items = top.map((p) => p.name);
  const extra = outOfStock.length > 5 ? ` And ${outOfStock.length - 5} more products are out of stock.` : "";
  return {
    ok: true,
    message: `Out of stock products: ${items.join(", ")}.${extra}`,
    queryType: "out_of_stock",
  };
}

function handleOverstocked(allProducts: ProductMemory[], inventory: { overstockedCount: number }): InventoryQueryResult {
  const overstocked = allProducts.filter((p) => p.stockStatus === "overstocked");
  if (overstocked.length === 0) {
    return { ok: true, message: "No products are overstocked.", queryType: "overstocked" };
  }
  const top = overstocked.slice(0, 5);
  const items = top.map((p) => `${p.name}: ${p.currentStock} units`);
  const extra = overstocked.length > 5 ? ` And ${overstocked.length - 5} more products are overstocked.` : "";
  return {
    ok: true,
    message: `Overstocked products: ${items.join(". ")}.${extra}`,
    queryType: "overstocked",
  };
}

function handleInventoryValue(allProducts: ProductMemory[], inventory: { totalStockValue: number; totalStockCost: number }): InventoryQueryResult {
  const value = inventory.totalStockValue;
  const cost = inventory.totalStockCost;
  const unique = allProducts.length;
  const totalUnits = allProducts.reduce((sum, p) => sum + p.currentStock, 0);
  const parts: string[] = [`Your total inventory value is Rs ${value.toLocaleString("en-PK")}.`];
  if (cost > 0) {
    parts.push(`Cost basis: Rs ${cost.toLocaleString("en-PK")}.`);
  }
  parts.push(`${unique} unique products in stock.`);
  parts.push(`Total units in stock: ${totalUnits}.`);
  return {
    ok: true,
    message: parts.join(" "),
    queryType: "inventory_value",
  };
}

function handleCategorySummary(allProducts: ProductMemory[]): InventoryQueryResult {
  const categories = new Map<string, { count: number; stock: number; value: number }>();
  for (const p of allProducts) {
    const cat = p.category || "Uncategorized";
    const existing = categories.get(cat) || { count: 0, stock: 0, value: 0 };
    existing.count++;
    existing.stock += p.currentStock;
    existing.value += p.currentStock * p.defaultSellingPrice;
    categories.set(cat, existing);
  }
  if (categories.size === 0) {
    return { ok: true, message: "No products found in inventory.", queryType: "category_summary" };
  }
  const items = Array.from(categories.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([cat, data]) => `${cat}: ${data.count} products, ${data.stock} units`);
  return {
    ok: true,
    message: `Products by category: ${items.join(". ")}.`,
    queryType: "category_summary",
  };
}

function handleBrandSummary(allProducts: ProductMemory[]): InventoryQueryResult {
  const brands = new Map<string, { count: number; stock: number }>();
  for (const p of allProducts) {
    const brand = p.brand || "Unbranded";
    const existing = brands.get(brand) || { count: 0, stock: 0 };
    existing.count++;
    existing.stock += p.currentStock;
    brands.set(brand, existing);
  }
  if (brands.size === 0) {
    return { ok: true, message: "No products found in inventory.", queryType: "brand_summary" };
  }
  const items = Array.from(brands.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([brand, data]) => `${brand}: ${data.count} products, ${data.stock} units`);
  return {
    ok: true,
    message: `Products by brand: ${items.join(". ")}.`,
    queryType: "brand_summary",
  };
}

function handleFastMoving(allProducts: ProductMemory[]): InventoryQueryResult {
  const fast = allProducts.filter((p) => p.isFastMoving);
  if (fast.length === 0) {
    return { ok: true, message: "No fast-moving products found.", queryType: "fast_moving" };
  }
  const top = fast.sort((a, b) => b.totalSold30d - a.totalSold30d).slice(0, 5);
  const items = top.map((p) => `${p.name}: ${p.totalSold30d} units sold in 30 days`);
  return {
    ok: true,
    message: `Fast-moving products: ${items.join(". ")}.`,
    queryType: "fast_moving",
  };
}

function handleSlowMoving(allProducts: ProductMemory[]): InventoryQueryResult {
  const slow = allProducts.filter((p) => p.isSlowMoving);
  if (slow.length === 0) {
    return { ok: true, message: "No slow-moving products found.", queryType: "slow_moving" };
  }
  const top = slow.sort((a, b) => a.totalSold30d - b.totalSold30d).slice(0, 5);
  const items = top.map((p) => `${p.name}: ${p.totalSold30d} units sold in 30 days`);
  return {
    ok: true,
    message: `Slow-moving products: ${items.join(". ")}.`,
    queryType: "slow_moving",
  };
}

function fallbackInventoryResponse(allProducts: ProductMemory[], inventory: { totalProducts: number; outOfStockCount: number; lowStockCount: number; urgentReorderCount: number }): InventoryQueryResult {
  const total = inventory.totalProducts || allProducts.length;
  const outOfStock = inventory.outOfStockCount || allProducts.filter((p) => p.currentStock <= 0).length;
  const lowStock = inventory.lowStockCount || allProducts.filter((p) => p.reorderLevel > 0 && p.currentStock <= p.reorderLevel).length;
  const parts: string[] = [
    `Inventory summary: ${total} total products.`,
    `${outOfStock} out of stock.`,
    `${lowStock} low in stock.`,
  ];
  return {
    ok: true,
    message: parts.join(" "),
    queryType: null,
  };
}

function formatQuantityResponse(product: ProductMemory): string {
  const parts: string[] = [`${product.name}: ${product.currentStock} units available.`];
  if (product.stockStatus === "out_of_stock") {
    parts.push("This product is out of stock.");
  } else if (product.stockStatus === "urgent") {
    parts.push("Stock is critically low.");
  } else if (product.stockStatus === "overstocked") {
    parts.push("Stock is higher than usual.");
  }
  if (product.estimatedDaysLeft !== null && product.estimatedDaysLeft <= 30) {
    parts.push(`Estimated ${product.estimatedDaysLeft} days of stock remaining.`);
  }
  if (product.needsReorder) {
    parts.push("This product needs reordering.");
  }
  return parts.join(" ");
}
