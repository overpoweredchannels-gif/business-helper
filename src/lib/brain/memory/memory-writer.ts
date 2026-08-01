import { MemoryStore } from "./business-memory";
import {
  MemoryWriterRawData,
  ProductMemory,
  CustomerMemory,
  SupplierMemory,
  StaffMemory,
  KpiItem,
  HealthScoreResult,
} from "../contracts/memory";
import { PreferenceStore } from "../learning/preference-store";

export class MemoryWriter {
  private store: MemoryStore;
  private prefs: PreferenceStore;

  constructor(store: MemoryStore, prefs: PreferenceStore) {
    this.store = store;
    this.prefs = prefs;
  }

  // ─── Write Raw Data (called from page.tsx) ───

  writeRaw(data: MemoryWriterRawData): void {
    this.writeProducts(data.products);
    this.writeCustomers(data.customers);
    this.writeSuppliers(data.suppliers);
    this.writeStaff(data.staff);
    this.writeSalesTransactions(data.salesTransactions, data.salesItems);
    this.writePurchaseTransactions(data.purchaseTransactions, data.purchaseItems);
    this.writeExpenses(data.expenses);
    this.writeTasks(data.tasks);
    this.writeAlerts(data.alerts);
    this.writeMeta(data.organizationId, data.organizationName, data.ownerName, data.timezone);
    this.writePayments(data.customerPayments, data.supplierPayments);

    this.computeInventory();
    this.computeAnalytics();
    this.store.entityIndex.buildIndex(
      this.store.sections.products,
      this.store.sections.customers,
      this.store.sections.suppliers,
      this.store.sections.staff
    );
  }

  private computeInventory(): void {
    const products = this.store.sections.products;
    const inv = this.store.sections.inventory;
    let totalStockValue = 0;
    let totalStockCost = 0;
    let activeCount = 0;
    let outOfStock = 0;
    let lowStock = 0;
    let healthy = 0;
    let overstocked = 0;
    let urgentReorder = 0;
    for (const p of products.values()) {
      totalStockValue += p.currentStock * p.defaultSellingPrice;
      totalStockCost += p.currentStock * p.defaultCostPrice;
      if (p.isActive) activeCount++;
      if (p.stockStatus === "out_of_stock") outOfStock++;
      else if (p.stockStatus === "urgent") { lowStock++; urgentReorder++; }
      else if (p.stockStatus === "low_soon") lowStock++;
      else if (p.stockStatus === "healthy") healthy++;
      else if (p.stockStatus === "overstocked") overstocked++;
      if (p.needsReorder) urgentReorder++;
    }
    inv.totalProducts = products.size;
    inv.totalStockValue = totalStockValue;
    inv.totalStockCost = totalStockCost;
    inv.activeProductCount = activeCount;
    inv.outOfStockCount = outOfStock;
    inv.lowStockCount = lowStock;
    inv.healthyCount = healthy;
    inv.overstockedCount = overstocked;
    inv.urgentReorderCount = urgentReorder;
  }

  // ─── Entity Writers ───

  writeProducts(products: MemoryWriterRawData["products"]): void {
    const map = this.store.sections.products;
    for (const p of products) {
      const id = String(p.id);
      const item: ProductMemory = {
        id,
        name: p.name,
        brand: p.brand_name ?? p.brand_id ?? null,
        category: p.category_name ?? p.category_id ?? null,
        sku: null,
        barcode: null,
        defaultSellingPrice: p.default_selling_price ?? 0,
        lastPurchasePrice: p.last_purchase_price ?? 0,
        defaultCostPrice: p.last_purchase_price ?? 0,
        currentStock: 0,
        reorderLevel: p.reorder_level ?? 0,
        minimumStockLevel: p.minimum_stock_level ?? 0,
        stockStatus: "healthy",
        estimatedDaysLeft: null,
        totalSold30d: 0,
        totalPurchased30d: 0,
        dailySalesVelocity: 0,
        revenue30d: 0,
        profit30d: 0,
        profitMargin30d: null,
        averageSellingPrice30d: 0,
        lastSaleDate: null,
        lastPurchaseDate: null,
        createdAt: "",
        updatedAt: "",
        trackBatch: p.track_batch ?? false,
        trackExpiry: p.track_expiry ?? false,
        isActive: true,
        isFastMoving: false,
        isSlowMoving: false,
        needsReorder: false,
      };
      map.set(id, item);
    }
  }

  writeCustomers(customers: MemoryWriterRawData["customers"]): void {
    const map = this.store.sections.customers;
    for (const c of customers) {
      const item: CustomerMemory = {
        id: c.id,
        name: c.customer_name,
        shopName: c.shop_name ?? null,
        phone: c.phone ?? null,
        address: null,
        totalSales30d: 0,
        invoiceCount30d: 0,
        lastSaleDate: null,
        averageSaleValue30d: 0,
        creditLimit: c.credit_limit ?? null,
        creditPolicy: c.credit_policy ?? null,
        creditDays: c.credit_days ?? null,
        allowOverLimit: c.allow_over_limit ?? false,
        allowOverdueSales: c.allow_overdue_sales ?? false,
        outstandingBalance: 0,
        overdueAmount: 0,
        overdueDays: null,
        creditUtilizationPct: null,
        onTimePaymentRate: null,
        averagePaymentDays: null,
        lastPaymentDate: null,
        isActive30d: false,
        isNew30d: false,
        isHighValue: false,
        isAtRisk: false,
        createdAt: c.created_at ?? "",
        updatedAt: c.updated_at ?? "",
      };
      map.set(c.id, item);
    }
  }

  writeSuppliers(suppliers: MemoryWriterRawData["suppliers"]): void {
    const map = this.store.sections.suppliers;
    for (const s of suppliers) {
      const item: SupplierMemory = {
        id: s.id,
        name: s.supplier_name,
        phone: s.phone ?? null,
        contactPerson: s.contact_person ?? null,
        address: null,
        totalPurchases30d: 0,
        invoiceCount30d: 0,
        lastPurchaseDate: null,
        payableAmount: 0,
        overdueAmount: 0,
        averagePaymentDays: null,
        averageLeadTime: null,
        onTimeDeliveryRate: null,
        preferredPaymentTerms: null,
        isActive30d: false,
        isPreferred: false,
        createdAt: s.created_at ?? "",
        updatedAt: s.updated_at ?? "",
      };
      map.set(s.id, item);
    }
  }

  writeStaff(staff: MemoryWriterRawData["staff"]): void {
    const map = this.store.sections.staff;
    for (const s of staff) {
      const item: StaffMemory = {
        id: s.id,
        name: s.display_name,
        role: s.role ?? "staff",
        phone: s.phone ?? null,
        isActiveDuty: false,
        lastDutyStart: null,
        onDutySince: null,
        dutyDurationHours: null,
        lastLocation: null,
        salesCountToday: 0,
        salesAmountToday: 0,
        salesAmount30d: 0,
        invoiceCount30d: 0,
        averageSaleValue30d: 0,
        createdAt: s.created_at ?? "",
        updatedAt: s.updated_at ?? "",
      };
      map.set(s.id, item);
    }
  }

  // ─── Transactional Writers ───

  writeSalesTransactions(
    transactions: MemoryWriterRawData["salesTransactions"],
    items: MemoryWriterRawData["salesItems"]
  ): void {
    const sales = this.store.sections.sales;
    if (transactions.length === 0) return;

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    // Compute per-sale totals
    const saleTotals: Record<string, { revenue: number; profit: number; invoiceCount: number }> = {};
    for (const t of transactions) {
      saleTotals[t.id] = { revenue: 0, profit: 0, invoiceCount: 1 };
    }
    for (const item of items) {
      const tid = item.sales_transaction_id;
      const qty = item.quantity || 0;
      const sp = item.selling_price || 0;
      const pp = item.purchase_price_snapshot ?? null;
      if (saleTotals[tid]) {
        saleTotals[tid].revenue += sp * qty;
        if (pp !== null) saleTotals[tid].profit += (sp - pp) * qty;
      }
    }

    // Aggregate by period
    const periods = ["today", "thisWeek", "thisMonth", "last30Days", "lastMonth", "allTime"] as const;
    const periodData: Record<string, { revenue: number; profit: number; profitCount: number; invoices: Set<string>; byPaymentType: Record<string, number>; byStaff: Record<string, number>; productRevenue: Record<string, { revenue: number; qty: number }> }> = {};
    for (const p of periods) {
      periodData[p] = { revenue: 0, profit: 0, profitCount: 0, invoices: new Set(), byPaymentType: {}, byStaff: {}, productRevenue: {} };
    }

    const isInPeriod = (dateStr: string, period: string): boolean => {
      const d = new Date(dateStr);
      switch (period) {
        case "today": return dateStr.split("T")[0] === todayStr;
        case "thisWeek": { const sw = new Date(now); sw.setDate(now.getDate() - now.getDay()); return d >= sw; }
        case "thisMonth": return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        case "lastMonth": { const lm = new Date(now); lm.setMonth(lm.getMonth() - 1); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); }
        case "last30Days": { const td = new Date(now); td.setDate(td.getDate() - 30); return d >= td; }
        case "allTime": return true;
        default: return false;
      }
    };

    for (const t of transactions) {
      for (const p of periods) {
        if (!isInPeriod(t.created_at, p)) continue;
        const pd = periodData[p];
        const totals = saleTotals[t.id] || { revenue: 0, profit: 0, invoiceCount: 0 };
        pd.revenue += totals.revenue;
        if (totals.profit > 0 || totals.revenue > 0) {
          pd.profit += totals.profit;
          pd.profitCount++;
        }
        pd.invoices.add(t.id);
        const pt = t.payment_type || "cash";
        pd.byPaymentType[pt] = (pd.byPaymentType[pt] || 0) + totals.revenue;
      }
    }

    // Also aggregate product-level from items
    for (const item of items) {
      const t = transactions.find((tr) => tr.id === item.sales_transaction_id);
      if (!t) continue;
      const pid = String(item.product_id);
      const qty = item.quantity || 0;
      const rev = (item.selling_price || 0) * qty;
      for (const p of periods) {
        if (!isInPeriod(t.created_at, p)) continue;
        if (!periodData[p].productRevenue[pid]) periodData[p].productRevenue[pid] = { revenue: 0, qty: 0 };
        periodData[p].productRevenue[pid].revenue += rev;
        periodData[p].productRevenue[pid].qty += qty;
      }
    }

    const buildPeriodSummary = (p: string) => {
      const pd = periodData[p];
      const invoiceCount = pd.invoices.size;
      const avg = invoiceCount > 0 ? pd.revenue / invoiceCount : 0;
      const rev = pd.revenue;
      const profit = pd.profit;
      const margin = rev > 0 ? (profit / rev) * 100 : null;
      const topEntry = Object.entries(pd.productRevenue).sort(([, a], [, b]) => b.revenue - a.revenue)[0];
      return {
        revenue: rev,
        profit,
        profitMargin: margin,
        invoiceCount,
        averageSaleValue: avg,
        byPaymentType: pd.byPaymentType,
        byStaff: {},
        topProductId: topEntry ? topEntry[0] : null,
        topProductRevenue: topEntry ? topEntry[1].revenue : 0,
        topProductQuantity: topEntry ? topEntry[1].qty : 0,
      };
    };

    sales.today = buildPeriodSummary("today");
    sales.thisWeek = buildPeriodSummary("thisWeek");
    sales.thisMonth = buildPeriodSummary("thisMonth");
    sales.last30Days = buildPeriodSummary("last30Days");
    sales.lastMonth = buildPeriodSummary("lastMonth");
    sales.allTime = buildPeriodSummary("allTime");

    // Build daily
    const dailyMap: Record<string, { revenue: number; profit: number; invoiceCount: number; date: string }> = {};
    for (const t of transactions) {
      const day = t.created_at.split("T")[0];
      if (!dailyMap[day]) dailyMap[day] = { revenue: 0, profit: 0, invoiceCount: 0, date: day };
      dailyMap[day].invoiceCount++;
      dailyMap[day].revenue += saleTotals[t.id]?.revenue || 0;
      dailyMap[day].profit += saleTotals[t.id]?.profit || 0;
    }
    sales.daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Build monthly
    const monthlyMap: Record<string, { month: string; revenue: number; profit: number; invoiceCount: number }> = {};
    for (const t of transactions) {
      const month = t.created_at.slice(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { month, revenue: 0, profit: 0, invoiceCount: 0 };
      monthlyMap[month].invoiceCount++;
      monthlyMap[month].revenue += saleTotals[t.id]?.revenue || 0;
      monthlyMap[month].profit += saleTotals[t.id]?.profit || 0;
    }
    sales.monthly = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));

    sales.lastTransactionDate = transactions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.created_at ?? "";
    sales.transactionCount = transactions.length;
    sales.hasProfitData = items.some((i) => i.purchase_price_snapshot != null);
    sales.profitConfidence = items.some((i) => i.purchase_price_snapshot != null) ? "high" : "low";

    // Update product-level data from sales
    const productMap = this.store.sections.products;
    for (const item of items) {
      const pid = String(item.product_id);
      const p = productMap.get(pid);
      if (!p) continue;
      const t = transactions.find((tr) => tr.id === item.sales_transaction_id);
      const qty = item.quantity || 0;
      const rev = (item.selling_price || 0) * qty;
      const pp = item.purchase_price_snapshot ?? 0;
      const profit = (item.selling_price || 0) - pp;
      p.totalSold30d += qty;
      p.revenue30d += rev;
      p.profit30d += profit * qty;
      if (p.totalSold30d > 0) {
        p.averageSellingPrice30d = p.revenue30d / p.totalSold30d;
        p.profitMargin30d = (p.profit30d / p.revenue30d) * 100;
      }
      p.dailySalesVelocity = p.totalSold30d / 30;
      if (t && (!p.lastSaleDate || t.created_at > p.lastSaleDate)) {
        p.lastSaleDate = t.created_at;
      }
      p.isFastMoving = p.dailySalesVelocity > 0;
      p.isSlowMoving = !p.isFastMoving && p.totalSold30d > 0;
    }
  }

  writePurchaseTransactions(
    transactions: MemoryWriterRawData["purchaseTransactions"],
    items: MemoryWriterRawData["purchaseItems"]
  ): void {
    const purchases = this.store.sections.purchases;
    if (transactions.length === 0) return;

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    const transTotals: Record<string, number> = {};
    for (const t of transactions) {
      transTotals[t.id] = 0;
    }
    for (const item of items) {
      const tid = item.purchase_transaction_id;
      transTotals[tid] = (transTotals[tid] || 0) + (item.purchase_price || 0) * (item.quantity || 0);
    }

    const periods = ["today", "thisWeek", "thisMonth", "last30Days", "allTime"] as const;
    const periodData: Record<string, { total: number; invoices: Set<string>; bySupplier: Record<string, number> }> = {};
    for (const p of periods) {
      periodData[p] = { total: 0, invoices: new Set(), bySupplier: {} };
    }

    const isInPeriod = (dateStr: string, period: string): boolean => {
      const d = new Date(dateStr);
      switch (period) {
        case "today": return dateStr.split("T")[0] === todayStr;
        case "thisWeek": { const sw = new Date(now); sw.setDate(now.getDate() - now.getDay()); return d >= sw; }
        case "thisMonth": return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        case "last30Days": { const td = new Date(now); td.setDate(td.getDate() - 30); return d >= td; }
        case "allTime": return true;
        default: return false;
      }
    };

    for (const t of transactions) {
      for (const p of periods) {
        if (!isInPeriod(t.created_at, p)) continue;
        const pd = periodData[p];
        pd.total += transTotals[t.id] || 0;
        pd.invoices.add(t.id);
        pd.bySupplier[t.supplier_id] = (pd.bySupplier[t.supplier_id] || 0) + (transTotals[t.id] || 0);
      }
    }

    const buildPurchasePeriod = (p: string) => ({
      totalAmount: periodData[p].total,
      invoiceCount: periodData[p].invoices.size,
      bySupplier: periodData[p].bySupplier,
      byPaymentType: { cash: periodData[p].total },
    });

    purchases.today = buildPurchasePeriod("today");
    purchases.thisWeek = buildPurchasePeriod("thisWeek");
    purchases.thisMonth = buildPurchasePeriod("thisMonth");
    purchases.last30Days = buildPurchasePeriod("last30Days");
    purchases.allTime = buildPurchasePeriod("allTime");

    purchases.lastTransactionDate = transactions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.created_at ?? "";
    purchases.transactionCount = transactions.length;

    // Update product-level purchase data
    const productMap = this.store.sections.products;
    for (const item of items) {
      const pid = String(item.product_id);
      const p = productMap.get(pid);
      if (!p) continue;
      const qty = item.quantity || 0;
      const pp = item.purchase_price || 0;
      p.totalPurchased30d += qty;
      p.currentStock += qty;
      p.lastPurchasePrice = pp;
      p.defaultCostPrice = pp;
      const t = transactions.find((tr) => tr.id === item.purchase_transaction_id);
      if (t && (!p.lastPurchaseDate || t.created_at > p.lastPurchaseDate)) {
        p.lastPurchaseDate = t.created_at;
        p.updatedAt = t.created_at;
      }
      p.stockStatus = p.currentStock <= 0 ? "out_of_stock"
        : p.currentStock <= p.reorderLevel * 0.5 ? "urgent"
        : p.currentStock <= p.reorderLevel ? "low_soon"
        : p.currentStock > p.reorderLevel * 3 ? "overstocked"
        : "healthy";
      p.needsReorder = p.currentStock <= p.reorderLevel;
      p.estimatedDaysLeft = p.dailySalesVelocity > 0 ? Math.floor(p.currentStock / p.dailySalesVelocity) : null;
    }
  }

  writeExpenses(expenses: MemoryWriterRawData["expenses"]): void {
    const expenseMem = this.store.sections.expenses;
    if (expenses.length === 0) return;

    const now = new Date();
    const isThisMonth = (s: string) => { const d = new Date(s); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); };
    const isLastMonth = (s: string) => { const d = new Date(s); const lm = new Date(now); lm.setMonth(lm.getMonth() - 1); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); };
    const isLast30Days = (s: string) => { const d = new Date(s); const td = new Date(now); td.setDate(td.getDate() - 30); return d >= td; };

    const filterE = (pred: (s: string) => boolean) => {
      const filtered = expenses.filter((e) => pred(e.expense_date || e.created_at || ""));
      const totalAmount = filtered.reduce((s, e) => s + (e.amount || 0), 0);
      const count = filtered.length;
      const byCategory: Record<string, number> = {};
      for (const e of filtered) {
        const cat = e.expense_type || "Other";
        byCategory[cat] = (byCategory[cat] || 0) + (e.amount || 0);
      }
      return { totalAmount, count, byCategory };
    };

    const allCat: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.expense_type || "Other";
      allCat[cat] = (allCat[cat] || 0) + (e.amount || 0);
    }
    const totalExp = Object.values(allCat).reduce((s, v) => s + v, 0);
    const topEntry = Object.entries(allCat).sort(([, a], [, b]) => b - a)[0];
    const topCat = topEntry ? topEntry[0] : null;
    const topPct = topEntry && totalExp > 0 ? (topEntry[1] / totalExp) * 100 : null;

    // Build daily 30d
    const dailyMap: Record<string, { total: number; count: number; date: string; byCategory: Record<string, number> }> = {};
    for (const e of expenses) {
      const ds = (e.expense_date || e.created_at || "").split("T")[0];
      if (ds && isLast30Days(e.expense_date || e.created_at || "")) {
        if (!dailyMap[ds]) dailyMap[ds] = { total: 0, count: 0, date: ds, byCategory: {} };
        dailyMap[ds].total += e.amount || 0;
        dailyMap[ds].count++;
        const cat = e.expense_type || "Other";
        dailyMap[ds].byCategory[cat] = (dailyMap[ds].byCategory[cat] || 0) + (e.amount || 0);
      }
    }

    expenseMem.thisMonth = filterE(isThisMonth);
    expenseMem.last30Days = filterE(isLast30Days);
    expenseMem.lastMonth = filterE(isLastMonth);
    expenseMem.allTime = filterE(() => true);
    expenseMem.byCategory = allCat;
    expenseMem.daily30d = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    expenseMem.totalExpenses = totalExp;
    expenseMem.expenseCount = expenses.length;
    expenseMem.averageExpenseValue = expenses.length > 0 ? totalExp / expenses.length : 0;
    expenseMem.topCategory = topCat;
    expenseMem.topCategoryPct = topPct !== null ? Math.round(topPct * 100) / 100 : null;
    expenseMem.hasCategoryData = Object.keys(allCat).length > 0;

    // Anomalies
    expenseMem.anomalies = [];
    const amounts30d = expenseMem.daily30d.map((d) => d.total);
    if (amounts30d.length > 3) {
      const mean = amounts30d.reduce((s, v) => s + v, 0) / amounts30d.length;
      const std = Math.sqrt(amounts30d.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts30d.length);
      if (std > 0) {
        for (const d of expenseMem.daily30d) {
          const z = (d.total - mean) / std;
          if (Math.abs(z) > 2) {
            expenseMem.anomalies.push({
              category: "all",
              month: d.date,
              amount: d.total,
              averageAmount: Math.round(mean),
              deviationPct: Math.round(z * 100) / 100,
              severity: Math.abs(z) > 3 ? "high" : "medium",
            });
          }
        }
      }
    }
  }

  writeTasks(tasks: MemoryWriterRawData["tasks"]): void {
    const mem = this.store.sections.tasks;
    mem.pending = tasks.filter((t) => t.status === "pending").length;
    mem.overdue = tasks.filter((t) => t.status === "overdue" || (t.status === "pending" && t.due_date && new Date(t.due_date) < new Date())).length;
    mem.completed = tasks.filter((t) => t.status === "completed").length;
    const byPriority: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const t of tasks) {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byType[t.task_type] = (byType[t.task_type] || 0) + 1;
    }
    mem.byPriority = byPriority;
    mem.byType = byType;
  }

  writeAlerts(alerts: MemoryWriterRawData["alerts"]): void {
    const mem = this.store.sections.alerts;
    mem.active = alerts.filter((a) => a.status === "active").length;
    mem.critical = alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;
    const byType: Record<string, number> = {};
    for (const a of alerts) {
      byType[a.alert_type] = (byType[a.alert_type] || 0) + 1;
    }
    mem.byType = byType;
    mem.recent = alerts.slice(0, 20).map((a) => ({
      id: a.id, type: a.alert_type, title: a.title, severity: a.severity, createdAt: a.created_at,
    }));
  }

  writePayments(customerPayments?: MemoryWriterRawData["customerPayments"], supplierPayments?: MemoryWriterRawData["supplierPayments"]): void {
    const customers = this.store.sections.customers;
    if (customerPayments) {
      const totals: Record<string, number> = {};
      for (const cp of customerPayments) {
        totals[cp.customer_id] = (totals[cp.customer_id] || 0) + (cp.amount || 0);
      }
      for (const [cid, paid] of Object.entries(totals)) {
        const c = customers.get(cid);
        if (c) {
          const txTotal = this.store.sections.sales.allTime.revenue;
          c.outstandingBalance = Math.max(0, txTotal - paid);
          c.overdueAmount = c.outstandingBalance > 0 ? c.outstandingBalance : 0;
        }
      }
    }

    const suppliers = this.store.sections.suppliers;
    if (supplierPayments) {
      const totals: Record<string, number> = {};
      for (const sp of supplierPayments) {
        totals[sp.supplier_id] = (totals[sp.supplier_id] || 0) + (sp.amount || 0);
      }
      for (const [sid, paid] of Object.entries(totals)) {
        const s = suppliers.get(sid);
        if (s) {
          const txTotal = this.store.sections.purchases.allTime.totalAmount;
          s.payableAmount = Math.max(0, txTotal - paid);
          s.overdueAmount = s.payableAmount > 0 ? s.payableAmount : 0;
        }
      }
    }
  }

  writeMeta(orgId: string, orgName: string, ownerName: string, tz: string): void {
    const meta = this.store.sections.meta;
    meta.organizationId = orgId;
    meta.organizationName = orgName;
    meta.ownerName = ownerName;
    meta.currentDate = new Date().toISOString().split("T")[0];
    meta.currentTime = new Date().toTimeString().slice(0, 8);
    meta.timezone = tz || "Asia/Karachi";
    meta.lastFullRefresh = new Date().toISOString();
  }

  writeConversationMessage(role: "user" | "assistant", text: string): void {
    const conv = this.store.sections.conversations;
    conv.recentMessages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      type: "text",
      text,
      createdAt: new Date().toISOString(),
    });
    if (conv.recentMessages.length > 100) {
      conv.recentMessages = conv.recentMessages.slice(-100);
    }
  }

  private computeAnalytics(): void {
    const sales = this.store.sections.sales;
    const expenses = this.store.sections.expenses;
    const inv = this.store.sections.inventory;
    const products = this.store.sections.products;
    const analytics = this.store.sections.analytics;

    const totalRevenue = sales.allTime.revenue;
    const totalProfit = sales.allTime.profit;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const expenseRatio = sales.thisMonth.revenue > 0 ? (expenses.thisMonth.totalAmount / sales.thisMonth.revenue) * 100 : 0;
    const avgSaleValue = sales.allTime.invoiceCount > 0 ? totalRevenue / sales.allTime.invoiceCount : 0;
    const overstockedRatio = inv.totalProducts > 0 ? (inv.overstockedCount / inv.totalProducts) * 100 : 0;

    // Health score
    const scoreComponents: Record<string, number> = {
      revenueHealth: Math.min(100, (sales.last30Days.revenue / (sales.allTime.revenue || 1)) * 100),
      profitMarginHealth: Math.max(0, Math.min(100, profitMargin)),
      expenseHealth: Math.max(0, Math.min(100, 100 - expenseRatio)),
      inventoryHealth: Math.max(0, Math.min(100, 100 - overstockedRatio)),
      customerHealth: products.size > 0 ? Math.min(100, (inv.activeProductCount / products.size) * 100) : 100,
    };
    const avgScore = Object.values(scoreComponents).reduce((s, v) => s + v, 0) / Object.keys(scoreComponents).length;
    const overallScore = Math.round(avgScore);
    const label: HealthScoreResult["label"] =
      overallScore >= 80 ? "Excellent" : overallScore >= 60 ? "Good" : overallScore >= 40 ? "Average" : overallScore >= 20 ? "Needs Attention" : "Critical";
    const contributingFactors: Array<{ factor: string; impact: "positive" | "negative"; weight: number; detail: string }> = [];
    for (const [key, val] of Object.entries(scoreComponents)) {
      if (val >= 60) contributingFactors.push({ factor: key, impact: "positive", weight: Math.round(val / 10), detail: `${Math.round(val)}% health` });
      else contributingFactors.push({ factor: key, impact: "negative", weight: Math.round((100 - val) / 10), detail: `${Math.round(val)}% health` });
    }

    analytics.healthScore = {
      score: overallScore,
      label,
      breakdown: scoreComponents,
      reasons: [],
      contributingFactors,
      trend: "stable",
      trendEvidence: "",
      lastCalculated: new Date().toISOString(),
    };

    // KPIs
    const kpis: KpiItem[] = [
      { key: "monthly_revenue", label: "Monthly Revenue", category: "revenue", value: sales.thisMonth.revenue, unit: "currency", formatted: `PKR ${sales.thisMonth.revenue.toLocaleString("en-PK")}`, change: null, changeLabel: "flat", isPercentage: false, comparisonPeriod: "last30Days", confidence: "high" },
      { key: "monthly_profit", label: "Monthly Profit", category: "profitability", value: sales.thisMonth.profit, unit: "currency", formatted: `PKR ${sales.thisMonth.profit.toLocaleString("en-PK")}`, change: null, changeLabel: "flat", isPercentage: false, comparisonPeriod: "last30Days", confidence: sales.hasProfitData ? "high" : "low" },
      { key: "profit_margin", label: "Profit Margin", category: "profitability", value: Math.round(profitMargin * 100) / 100, unit: "percentage", formatted: `${Math.round(profitMargin * 100) / 100}%`, change: null, changeLabel: "flat", isPercentage: true, comparisonPeriod: "last30Days", confidence: sales.hasProfitData ? "high" : "low" },
      { key: "total_revenue", label: "Total Revenue (All Time)", category: "revenue", value: totalRevenue, unit: "currency", formatted: `PKR ${totalRevenue.toLocaleString("en-PK")}`, change: null, changeLabel: "flat", isPercentage: false, comparisonPeriod: "allTime", confidence: "high" },
      { key: "avg_sale_value", label: "Average Sale Value", category: "efficiency", value: Math.round(avgSaleValue * 100) / 100, unit: "currency", formatted: `PKR ${Math.round(avgSaleValue * 100) / 100}`, change: null, changeLabel: "flat", isPercentage: false, comparisonPeriod: "allTime", confidence: "high" },
    ];
    analytics.kpis = kpis;

    // Trends
    analytics.trends = {
      revenue: sales.monthly.map((m) => ({ date: m.month, value: m.revenue, label: m.month })),
      profit: sales.monthly.map((m) => ({ date: m.month, value: m.profit, label: m.month })),
      expenses: expenses.monthly12m.map((m) => ({ date: m.month, value: m.total, label: m.month })),
    };
  }

  refreshAnalytics(): void {
    this.computeInventory();
    this.computeAnalytics();
  }

  clear(): void {
    const fresh = this.store["createEmptySections"]();
    this.store["_sections"] = fresh;
    this.store["_lastRefreshedAt"] = 0;
  }
}
