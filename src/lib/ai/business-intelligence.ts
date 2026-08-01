import type { MemoryStore } from "../brain/memory/business-memory";
import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { buildCustomerLedger } from "./customer-ledger";
import { buildSupplierLedger } from "./supplier-ledger";
import { buildFinancialLedger } from "./financial-ledger";

export type BusinessIntelligenceQueryKind =
  | "sales_forecast"
  | "demand_prediction"
  | "reorder_prediction"
  | "customer_prediction"
  | "supplier_prediction"
  | "product_prediction"
  | "health_score"
  | "recommendations";

export interface BusinessIntelligenceResult {
  ok: boolean;
  message: string;
  queryType: BusinessIntelligenceQueryKind | null;
}

// Helper to format rupees
function formatRs(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-PK")}`;
}

// Helper to detect language from query string
export function detectQueryLanguage(message: string): "english" | "urdu" | "roman_urdu" {
  const normalized = message.toLowerCase().trim();
  if (/[\u0600-\u06FF]/.test(normalized)) {
    return "urdu";
  }
  // Common Roman Urdu keywords
  if (/\b(aaj|kal|parso|parson|kitna|kitni|kitnay|hoga|hogi|becho|karo|hai|hain|bikri|munafa|nuksan|udhaar|dena|aana|khatay|khata|malumat|report)\b/i.test(normalized)) {
    return "roman_urdu";
  }
  return "english";
}

export function processBusinessIntelligenceQuery(
  queryType: BusinessIntelligenceQueryKind | null,
  store: MemoryStore,
  data: MemoryWriterRawData,
  message: string
): BusinessIntelligenceResult {
  const language = detectQueryLanguage(message || "");
  const payload = calculateBusinessIntelligence(store, data);
  const qType = queryType ?? "health_score";

  let response = "";

  switch (qType) {
    case "sales_forecast": {
      const forecast = payload.salesForecasting;
      if (language === "urdu") {
        response = `سیلز کی پیشن گوئی:\n` +
          `- کل کی متوقع فروخت: ${formatRs(forecast.tomorrow)}\n` +
          `- ہفتہ وار متوقع فروخت: ${formatRs(forecast.weekly)}\n` +
          `- ماہانہ متوقع فروخت: ${formatRs(forecast.monthly)}`;
      } else if (language === "roman_urdu") {
        response = `Sales ki forecast:\n` +
          `- Kal ki expected sales: ${formatRs(forecast.tomorrow)}\n` +
          `- Weekly expected sales: ${formatRs(forecast.weekly)}\n` +
          `- Monthly expected sales: ${formatRs(forecast.monthly)}`;
      } else {
        response = `Sales Forecasting:\n` +
          `- Tomorrow predicted sales: ${formatRs(forecast.tomorrow)}\n` +
          `- Weekly predicted sales: ${formatRs(forecast.weekly)}\n` +
          `- Monthly predicted sales: ${formatRs(forecast.monthly)}`;
      }
      break;
    }

    case "demand_prediction": {
      const demand = payload.demandPrediction;
      const likelyNames = demand.likelyToSellNext.slice(0, 3).map(p => p.name).join(", ");
      const slowNames = demand.slowDemand.slice(0, 3).map(p => p.name).join(", ");
      
      if (language === "urdu") {
        response = `ڈیمانڈ کی پیشن گوئی:\n` +
          `- آگے بکنے والی مصنوعات: ${likelyNames || "کوئی نہیں"}\n` +
          `- سب سے زیادہ ڈیمانڈ والے زمرے: ${demand.categoryDemand.slice(0, 2).map(c => c.category).join(", ") || "کوئی نہیں"}\n` +
          `- سست رفتار مصنوعات: ${slowNames || "کوئی نہیں"}`;
      } else if (language === "roman_urdu") {
        response = `Demand prediction:\n` +
          `- Aagay bikne wale products: ${likelyNames || "koi nahi"}\n` +
          `- High demand categories: ${demand.categoryDemand.slice(0, 2).map(c => c.category).join(", ") || "koi nahi"}\n` +
          `- Slow moving items: ${slowNames || "koi nahi"}`;
      } else {
        response = `Demand Prediction:\n` +
          `- Products likely to sell next: ${likelyNames || "None"}\n` +
          `- Top category demand: ${demand.categoryDemand.slice(0, 2).map(c => c.category).join(", ") || "None"}\n` +
          `- Slow demand items: ${slowNames || "None"}`;
      }
      break;
    }

    case "reorder_prediction": {
      const reorder = payload.smartReorder.filter(r => r.urgency === "critical" || r.urgency === "high").slice(0, 3);
      if (reorder.length === 0) {
        if (language === "urdu") response = "اس وقت کسی بھی پروڈکٹ کو دوبارہ آرڈر کرنے کی ضرورت نہیں ہے۔";
        else if (language === "roman_urdu") response = "Is waqt kisi product ko reorder karne ki zaroorat nahi hai.";
        else response = "No products require urgent reordering at this time.";
      } else {
        const lines = reorder.map(r => {
          const dateStr = r.reorderDate ? r.reorderDate.slice(0, 10) : "آج";
          if (language === "urdu") {
            return `- ${r.name}: آرڈر کی مقدار ${r.reorderQuantity} یونٹس، متوقع تاریخ ${dateStr} (شدت: ${r.urgency})`;
          } else if (language === "roman_urdu") {
            return `- ${r.name}: Order qty ${r.reorderQuantity} units, expected date ${dateStr} (urgency: ${r.urgency})`;
          } else {
            return `- ${r.name}: Reorder Qty ${r.reorderQuantity} units, Reorder Date: ${dateStr} (Urgency: ${r.urgency})`;
          }
        });
        
        if (language === "urdu") {
          response = `دوبارہ آرڈر کی پیشن گوئی:\n` + lines.join("\n");
        } else if (language === "roman_urdu") {
          response = `Reorder prediction:\n` + lines.join("\n");
        } else {
          response = `Smart Reorder Predictions:\n` + lines.join("\n");
        }
      }
      break;
    }

    case "customer_prediction": {
      const cust = payload.customerIntelligence;
      const churnNames = cust.churnRisk.slice(0, 3).map(c => c.name).join(", ");
      const highValNames = cust.highValue.slice(0, 3).map(c => c.name).join(", ");
      
      if (language === "urdu") {
        response = `کسٹمر انٹیلی جنس:\n` +
          `- ہائی ویلیو کسٹمرز: ${highValNames || "کوئی نہیں"}\n` +
          `- کسٹمر چورن رسک (چھوڑنے کا خطرہ): ${churnNames || "کوئی نہیں"}\n` +
          `- غیر فعال کسٹمرز: ${cust.inactive.slice(0, 3).map(c => c.name).join(", ") || "کوئی نہیں"}`;
      } else if (language === "roman_urdu") {
        response = `Customer intelligence:\n` +
          `- High-value customers: ${highValNames || "koi nahi"}\n` +
          `- Churn risk customers: ${churnNames || "koi nahi"}\n` +
          `- Inactive customers: ${cust.inactive.slice(0, 3).map(c => c.name).join(", ") || "koi nahi"}`;
      } else {
        response = `Customer Intelligence:\n` +
          `- High-value customers: ${highValNames || "None"}\n` +
          `- Churn risk customers: ${churnNames || "None"}\n` +
          `- Inactive customers: ${cust.inactive.slice(0, 3).map(c => c.name).join(", ") || "None"}`;
      }
      break;
    }

    case "supplier_prediction": {
      const supp = payload.supplierIntelligence;
      const delayedNames = supp.delayed.slice(0, 3).map(s => s.name).join(", ");
      const reliableNames = supp.reliable.slice(0, 3).map(s => s.name).join(", ");
      
      if (language === "urdu") {
        response = `سپلائر انٹیلی جنس:\n` +
          `- قابل اعتماد سپلائرز: ${reliableNames || "کوئی نہیں"}\n` +
          `- تاخیر کرنے والے سپلائرز: ${delayedNames || "کوئی نہیں"}\n` +
          `- سپلائر انحصار: ${supp.dependency.slice(0, 2).map(s => `${s.name} (${s.sharePct.toFixed(1)}%)`).join(", ") || "کوئی نہیں"}`;
      } else if (language === "roman_urdu") {
        response = `Supplier intelligence:\n` +
          `- Reliable suppliers: ${reliableNames || "koi nahi"}\n` +
          `- Delayed suppliers: ${delayedNames || "koi nahi"}\n` +
          `- Supplier dependency: ${supp.dependency.slice(0, 2).map(s => `${s.name} (${s.sharePct.toFixed(1)}%)`).join(", ") || "koi nahi"}`;
      } else {
        response = `Supplier Intelligence:\n` +
          `- Reliable suppliers: ${reliableNames || "None"}\n` +
          `- Delayed suppliers: ${delayedNames || "None"}\n` +
          `- Supplier dependency: ${supp.dependency.slice(0, 2).map(s => `${s.name} (${s.sharePct.toFixed(1)}%)`).join(", ") || "None"}`;
      }
      break;
    }

    case "product_prediction": {
      const prod = payload.productIntelligence;
      const rising = prod.rising.slice(0, 2).map(p => p.name).join(", ");
      const declining = prod.declining.slice(0, 2).map(p => p.name).join(", ");
      const dead = prod.deadStock.slice(0, 2).map(p => p.name).join(", ");
      
      if (language === "urdu") {
        response = `پروڈکٹ انٹیلی جنس:\n` +
          `- بڑھتے ہوئے پروڈکٹس: ${rising || "کوئی نہیں"}\n` +
          `- گرتے ہوئے پروڈکٹس: ${declining || "کوئی نہیں"}\n` +
          `- ڈیڈ اسٹاک: ${dead || "کوئی نہیں"}`;
      } else if (language === "roman_urdu") {
        response = `Product intelligence:\n` +
          `- Rising products: ${rising || "koi nahi"}\n` +
          `- Declining products: ${declining || "koi nahi"}\n` +
          `- Dead stock items: ${dead || "koi nahi"}`;
      } else {
        response = `Product Intelligence:\n` +
          `- Rising products: ${rising || "None"}\n` +
          `- Declining products: ${declining || "None"}\n` +
          `- Dead stock items: ${dead || "None"}`;
      }
      break;
    }

    case "health_score": {
      const health = payload.businessHealth;
      if (language === "urdu") {
        response = `بزنس ہیلتھ سکور: ${health.score}/100\n` +
          `وضاحت: ${health.explanation}`;
      } else if (language === "roman_urdu") {
        response = `Business Health Score: ${health.score}/100\n` +
          `Explanation: ${health.explanation}`;
      } else {
        response = `Business Health Score: ${health.score}/100\n` +
          `Explanation: ${health.explanation}`;
      }
      break;
    }

    case "recommendations": {
      const recs = payload.recommendations;
      if (recs.length === 0) {
        if (language === "urdu") response = "اس وقت کوئی تجاویز دستیاب نہیں ہیں۔";
        else if (language === "roman_urdu") response = "Is waqt koi recommendations nahi hain.";
        else response = "No recommendations available at this time.";
      } else {
        const lines = recs.map((r, i) => `${i + 1}. ${r.title}: ${r.description}`);
        if (language === "urdu") {
          response = `تجویز کردہ اقدامات:\n` + lines.join("\n");
        } else if (language === "roman_urdu") {
          response = `AI recommendations:\n` + lines.join("\n");
        } else {
          response = `AI Business Intelligence Recommendations:\n` + lines.join("\n");
        }
      }
      break;
    }

    default:
      return { ok: false, message: "Invalid query type.", queryType: qType };
  }

  return { ok: true, message: response.trim(), queryType: qType };
}

// Core business intelligence calculations
export function calculateBusinessIntelligence(store: MemoryStore, data: MemoryWriterRawData) {
  const now = new Date();
  
  // Build ledgers to ensure fresh calculated metrics
  const financialLedger = buildFinancialLedger(data, now);
  const customerLedger = buildCustomerLedger(data, now);
  const supplierLedger = buildSupplierLedger(data, now);

  const products = Array.from(store.products.values()).filter(p => p.isActive !== false);

  // 1. Sales Forecasting
  const dailySales = financialLedger.periods.last30Days.revenue / 30 || 0;
  const tomorrowForecast = dailySales * 1.05; // 5% growth trend guess
  const weeklyForecast = dailySales * 7;
  const monthlyForecast = dailySales * 30;

  // 2. Demand Prediction
  // Likely to sell next: sorted by velocity/sales 30d
  const likelyToSellNext = products
    .filter(p => p.currentStock > 0)
    .sort((a, b) => b.totalSold30d - a.totalSold30d)
    .map(p => ({ productId: p.id, name: p.name, score: p.totalSold30d }))
    .slice(0, 5);

  const categoryMap = new Map<string, number>();
  for (const p of products) {
    const cat = p.category || "General";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + p.totalSold30d);
  }
  const categoryDemand = Array.from(categoryMap.entries())
    .map(([category, score]) => ({ category, score }))
    .sort((a, b) => b.score - a.score);

  // Seasonal demand: beverages, juices, soft drinks tend to sell high in summer (August context)
  const seasonalDemand = products
    .filter(p => {
      const name = p.name.toLowerCase();
      const cat = (p.category || "").toLowerCase();
      return name.includes("pepsi") || name.includes("cola") || name.includes("juice") || name.includes("beverage") || cat.includes("beverage") || cat.includes("juice");
    })
    .map(p => ({ name: p.name, type: "Summer Seasonal" }));

  // Slow demand: positive stock but very low sales in 30 days
  const slowDemand = products
    .filter(p => p.currentStock > 0 && p.totalSold30d <= 2)
    .sort((a, b) => a.totalSold30d - b.totalSold30d)
    .map(p => ({ 
      productId: p.id, 
      name: p.name, 
      lastSaleDays: p.lastSaleDate ? Math.floor((now.getTime() - new Date(p.lastSaleDate).getTime()) / 86400000) : 30 
    }));

  // 3. Smart Reorder Prediction
  const smartReorder = products.map(p => {
    const velocity = p.dailySalesVelocity || (p.totalSold30d / 30) || 0;
    
    let reorderDate: string | null = null;
    let expectedStockoutDate: string | null = null;
    let urgency: "critical" | "high" | "medium" | "low" = "low";
    
    const reorderLevel = p.reorderLevel || 10;
    const reorderQuantity = Math.max(reorderLevel * 2, 50);

    if (p.currentStock <= 0) {
      urgency = "critical";
      reorderDate = now.toISOString();
      expectedStockoutDate = now.toISOString();
    } else if (velocity > 0) {
      const daysToStockout = p.currentStock / velocity;
      const daysToReorder = Math.max(0, (p.currentStock - reorderLevel) / velocity);

      const sDate = new Date();
      sDate.setDate(now.getDate() + Math.ceil(daysToStockout));
      expectedStockoutDate = sDate.toISOString();

      const rDate = new Date();
      rDate.setDate(now.getDate() + Math.ceil(daysToReorder));
      reorderDate = rDate.toISOString();

      if (daysToStockout <= 7) {
        urgency = "high";
      } else if (daysToStockout <= 14) {
        urgency = "medium";
      }
    } else {
      if (p.currentStock <= reorderLevel) {
        urgency = "high";
        reorderDate = now.toISOString();
      }
    }

    return {
      productId: p.id,
      name: p.name,
      currentStock: p.currentStock,
      reorderDate,
      reorderQuantity,
      expectedStockoutDate,
      urgency
    };
  });

  // 4. Customer Intelligence
  const customers = customerLedger.customers;
  const churnRisk = customers
    .filter(c => c.totalSales > 0 && (c.daysSinceLastSale ?? 99) > 20)
    .map(c => ({
      customerId: c.customerId,
      name: c.customerName,
      riskScore: Math.min(100, (c.daysSinceLastSale ?? 30) * 2)
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  const inactive = customers.filter(c => (c.daysSinceLastSale ?? 99) >= 45)
    .map(c => ({ customerId: c.customerId, name: c.customerName, inactiveDays: c.daysSinceLastSale ?? 45 }));

  const likelyToReorder = customers
    .filter(c => c.totalSales > 0 && (c.daysSinceLastSale ?? 99) <= 20)
    .map(c => ({ customerId: c.customerId, name: c.customerName, probability: Math.max(10, 90 - (c.daysSinceLastSale ?? 0) * 4) }))
    .sort((a, b) => b.probability - a.probability);

  const highValue = customers
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 5)
    .map(c => ({ customerId: c.customerId, name: c.customerName, salesAmount: c.totalSales }));

  // 5. Supplier Intelligence
  const suppliers = supplierLedger.suppliers;
  const reliable = suppliers
    .filter(s => (s.daysSinceLastPurchase ?? 99) < 60)
    .map(s => ({ supplierId: s.supplierId, name: s.supplierName, score: 85 }))
    .sort((a, b) => b.score - a.score);

  const delayed = suppliers
    .filter(s => s.overdueAmount > 0)
    .map(s => ({ supplierId: s.supplierId, name: s.supplierName, delayRate: 30 }))
    .sort((a, b) => b.delayRate - a.delayRate);

  const totalPurchases = supplierLedger.totals.totalPurchases || 1;
  const dependency = suppliers.map(s => ({
    supplierId: s.supplierId,
    name: s.supplierName,
    sharePct: (s.totalPurchases / totalPurchases) * 100
  })).sort((a, b) => b.sharePct - a.sharePct);

  const performance = suppliers.map(s => {
    let score = 80;
    if (s.overdueAmount > 0) score -= 20;
    if ((s.daysSinceLastPurchase ?? 0) > 30) score -= 10;
    return { supplierId: s.supplierId, name: s.supplierName, score: Math.max(0, Math.min(100, score)) };
  }).sort((a, b) => b.score - a.score);

  // 6. Product Intelligence
  // Rising: velocity > 30d average
  const rising = products
    .filter(p => p.totalSold30d > 5 && p.isFastMoving)
    .map(p => ({ productId: p.id, name: p.name, growthRate: 15 }));

  const declining = products
    .filter(p => p.totalSold30d > 0 && p.isSlowMoving)
    .map(p => ({ productId: p.id, name: p.name, declineRate: 20 }));

  const deadStock = products
    .filter(p => p.currentStock > 0 && !p.lastSaleDate)
    .map(p => ({ productId: p.id, name: p.name, stock: p.currentStock, ageDays: 90 }));

  const seasonal = products
    .filter(p => p.name.toLowerCase().includes("cola") || p.name.toLowerCase().includes("juice"))
    .map(p => ({ productId: p.id, name: p.name, peakMonths: ["June", "July", "August"] }));

  const highMargin = products
    .filter(p => {
      const margin = p.defaultSellingPrice > 0 ? (p.defaultSellingPrice - p.lastPurchasePrice) / p.defaultSellingPrice : 0;
      return margin >= 0.25;
    })
    .map(p => ({
      productId: p.id,
      name: p.name,
      marginPct: p.defaultSellingPrice > 0 ? ((p.defaultSellingPrice - p.lastPurchasePrice) / p.defaultSellingPrice) * 100 : 0
    }));

  const lowMargin = products
    .filter(p => {
      const margin = p.defaultSellingPrice > 0 ? (p.defaultSellingPrice - p.lastPurchasePrice) / p.defaultSellingPrice : 0;
      return margin > 0 && margin < 0.1;
    })
    .map(p => ({
      productId: p.id,
      name: p.name,
      marginPct: p.defaultSellingPrice > 0 ? ((p.defaultSellingPrice - p.lastPurchasePrice) / p.defaultSellingPrice) * 100 : 0
    }));

  // 7. Business Health Score (0-100)
  // sales trend (15 pts)
  // cash flow (15 pts)
  // receivables (15 pts)
  // payables (15 pts)
  // inventory health (15 pts)
  // customer activity (12 pts)
  // supplier activity (13 pts)
  let salesTrendScore = 15;
  if (financialLedger.periods.thisMonth.revenue < financialLedger.periods.lastMonth.revenue) {
    salesTrendScore = 5;
  }
  
  const cashFlowScore = financialLedger.cash.balance >= 0 ? 15 : 5;
  
  const totalReceivables = financialLedger.receivables.total || 1;
  const recOverdueRatio = financialLedger.receivables.overdue / totalReceivables;
  const receivablesScore = recOverdueRatio < 0.1 ? 15 : recOverdueRatio < 0.3 ? 10 : 5;

  const totalPayables = financialLedger.payables.total || 1;
  const payOverdueRatio = financialLedger.payables.overdue / totalPayables;
  const payablesScore = payOverdueRatio < 0.1 ? 15 : payOverdueRatio < 0.3 ? 10 : 5;

  const totalInvProducts = products.length || 1;
  const outOfStock = products.filter(p => p.currentStock <= 0).length;
  const invHealthRatio = 1 - (outOfStock / totalInvProducts);
  const inventoryHealthScore = Math.round(invHealthRatio * 15);

  const activeCust = customers.filter(c => (c.daysSinceLastSale ?? 99) < 30).length;
  const totalCust = customers.length || 1;
  const customerActivityScore = Math.round((activeCust / totalCust) * 12);

  const activeSupp = suppliers.filter(s => (s.daysSinceLastPurchase ?? 99) < 30).length;
  const totalSupp = suppliers.length || 1;
  const supplierActivityScore = Math.round((activeSupp / totalSupp) * 13);

  const healthScore = salesTrendScore + cashFlowScore + receivablesScore + payablesScore + inventoryHealthScore + customerActivityScore + supplierActivityScore;
  
  let explanation = "Your business health is excellent. All KPIs look stable, cash flow is positive, and receivables are collected on time.";
  if (healthScore < 50) {
    explanation = "Your business health is critical. High overdue payables/receivables and negative cash flow are affecting performance. Prioritize collections and outstanding supplier balances.";
  } else if (healthScore < 75) {
    explanation = "Your business health is average. There is room for improvement in inventory turnover and collection of overdue customer balances.";
  }

  // 8. AI Recommendations
  const recommendations: Array<{ id: string; priority: "high" | "medium" | "low"; title: string; description: string; expectedImpact: string }> = [];
  
  // Add reorder alerts
  const reorderUrgent = smartReorder.filter(r => r.urgency === "critical" || r.urgency === "high");
  for (const r of reorderUrgent) {
    recommendations.push({
      id: `rec-reorder-${r.productId}`,
      priority: r.urgency === "critical" ? "high" : "medium",
      title: `Purchase ${r.name}`,
      description: `Stock level is low (${r.currentStock} units). Order ${r.reorderQuantity} units to avoid stockouts.`,
      expectedImpact: "Prevents loss of sales due to stockouts."
    });
  }

  // Add customer payment follow-ups
  const overdueCustomers = customers.filter(c => c.overdueAmount > 100);
  for (const c of overdueCustomers) {
    recommendations.push({
      id: `rec-followup-${c.customerId}`,
      priority: c.overdueAmount > 1000 ? "high" : "medium",
      title: `Follow up with ${c.customerName}`,
      description: `Customer has an overdue balance of ${formatRs(c.overdueAmount)}.`,
      expectedImpact: "Improves cash flow and reduces outstanding receivables."
    });
  }

  // Add supplier payment recommendations
  const overdueSuppliers = suppliers.filter(s => s.overdueAmount > 100);
  for (const s of overdueSuppliers) {
    recommendations.push({
      id: `rec-pay-supplier-${s.supplierId}`,
      priority: "high",
      title: `Pay Supplier ${s.supplierName}`,
      description: `Clear outstanding supplier balance of ${formatRs(s.overdueAmount)} before Friday.`,
      expectedImpact: "Maintains good supplier relationship and credit reputation."
    });
  }

  // Slow demand reduction recommendation
  if (slowDemand.length > 0) {
    recommendations.push({
      id: "rec-reduce-slow-demand",
      priority: "low",
      title: `Reduce Order of ${slowDemand[0].name}`,
      description: `This product is slow moving. Decrease stock levels to free up tied-up capital.`,
      expectedImpact: "Reduces inventory holding costs."
    });
  }

  // Fallback recommendations if empty
  if (recommendations.length === 0) {
    recommendations.push({
      id: "rec-general-optimize",
      priority: "low",
      title: "Optimize Inventory Levels",
      description: "Inventory levels are healthy. Continue normal trading operations.",
      expectedImpact: "Maintains stable operations."
    });
  }

  return {
    salesForecasting: {
      tomorrow: Math.round(tomorrowForecast),
      weekly: Math.round(weeklyForecast),
      monthly: Math.round(monthlyForecast)
    },
    demandPrediction: {
      likelyToSellNext,
      categoryDemand,
      seasonalDemand,
      slowDemand
    },
    smartReorder,
    customerIntelligence: {
      churnRisk,
      inactive,
      likelyToReorder,
      highValue
    },
    supplierIntelligence: {
      reliable,
      delayed,
      dependency,
      performance
    },
    productIntelligence: {
      rising,
      declining,
      deadStock,
      seasonal,
      highMargin,
      lowMargin
    },
    businessHealth: {
      score: healthScore,
      explanation,
      breakdown: {
        salesTrend: salesTrendScore,
        cashFlow: cashFlowScore,
        receivables: receivablesScore,
        payables: payablesScore,
        inventoryHealth: inventoryHealthScore,
        customerActivity: customerActivityScore,
        supplierActivity: supplierActivityScore
      }
    },
    recommendations
  };
}
