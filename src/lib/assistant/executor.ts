import type { MemoryStore } from "../brain/memory/business-memory";
import type { MemoryWriterRawData } from "../brain/contracts/memory";
import { processInventoryQuery } from "../ai/inventory-intelligence";
import { processStaffQuery } from "../ai/staff-intelligence";
import { processLocationQuery } from "../ai/location-intelligence";
import { processCustomerQuery } from "../ai/customer-intelligence";
import { buildCustomerLedger } from "../ai/customer-ledger";
import { processSupplierQuery } from "../ai/supplier-intelligence";
import { buildSupplierLedger } from "../ai/supplier-ledger";
import { buildFinancialLedger } from "../ai/financial-ledger";
import { processFinancialQuery, FinancialQueryKind } from "../ai/financial-intelligence";
import { processBusinessIntelligenceQuery } from "../ai/business-intelligence";
import type { BusinessIntelligenceQueryKind } from "../ai/business-intelligence";
import { extractCustomerNameFragment, extractSupplierNameFragment } from "./intent-router";
import { getStaffAssignments, assignEmployee, reassignEmployee, removeEmployee } from "../ai/staff-executor";
import { executeSaleDraft } from "../ai/sales-executor";
import { executePurchaseDraft } from "../ai/purchase-executor";
import type { CurrentLocationView } from "../location/types";
import type {
  AssistantIntent,
  ActionResult,
  UnifiedAssistantOptions,
  ResolvedEntities,
} from "./types";

export interface ExecutorContext {
  organizationId: string;
  locations: CurrentLocationView[];
  actionExecutor: UnifiedAssistantOptions["actionExecutor"];
  generalChatHandler: UnifiedAssistantOptions["generalChatHandler"];
  /** Raw data source for the customer ledger (in-memory mode) */
  data?: MemoryWriterRawData;
  /** Rebuilds the entity index after in-memory customer mutations */
  refreshIndex?: (data: MemoryWriterRawData) => void;
}

/**
 * Module executor. Reuses the existing Business Brain AI module functions
 * (inventory/staff/location intelligence, staff executors, sale/purchase
 * executors) without modifying them. Network-bound sale/purchase execution
 * goes through a pluggable executor (the default calls the real
 * executeSaleDraft/executePurchaseDraft workflows).
 */
export class ModuleExecutor {
  private context: ExecutorContext;

  constructor(options: {
    organizationId: string;
    locations?: CurrentLocationView[];
    actionExecutor?: UnifiedAssistantOptions["actionExecutor"];
    generalChatHandler?: UnifiedAssistantOptions["generalChatHandler"];
    data?: MemoryWriterRawData;
    refreshIndex?: (data: MemoryWriterRawData) => void;
  }) {
    this.context = {
      organizationId: options.organizationId,
      locations: options.locations ?? [],
      actionExecutor: options.actionExecutor,
      generalChatHandler: options.generalChatHandler,
      data: options.data,
      refreshIndex: options.refreshIndex,
    };
  }

  updateLocations(locations: CurrentLocationView[]): void {
    this.context.locations = locations;
  }

  async executeQuery(
    store: MemoryStore,
    intent: AssistantIntent,
    generalContext: string,
    recentMessages: string
  ): Promise<string> {
    const entities = intent.entities;
    switch (intent.module) {
      case "inventory": {
        const result = processInventoryQuery(
          (intent.queryType as Parameters<typeof processInventoryQuery>[0]) ?? "quantity_lookup",
          entities.product ? entities.product.name : null,
          store
        );
        return result.ok ? result.message : `I couldn't answer that: ${result.error ?? result.message}`;
      }
      case "staff": {
        const result = processStaffQuery(
          (intent.queryType as Parameters<typeof processStaffQuery>[0]) ?? null,
          entities.employee ? entities.employee.name : null,
          entities.role ?? null,
          entities.area ?? null,
          store,
          getStaffAssignments()
        );
        return result.ok ? result.message : `I couldn't answer that: ${result.error ?? result.message}`;
      }
      case "location": {
        const result = processLocationQuery(
          (intent.queryType as Parameters<typeof processLocationQuery>[0]) ?? null,
          entities.employee ? entities.employee.name : null,
          entities.area ?? null,
          this.context.locations
        );
        return result.ok ? result.message : `I couldn't answer that: ${result.error ?? result.message}`;
      }
      case "customers": {
        const data = this.context.data;
        if (!data) {
          return "Customer intelligence isn't available in this context.";
        }
        const ledger = buildCustomerLedger(data, new Date());
        const queryType = (intent.queryType as Parameters<typeof processCustomerQuery>[0]) ?? "summary";
        const listTypes: string[] = [
          "all_outstanding",
          "overdue",
          "near_limit",
          "blocked",
          "top",
          "inactive",
          "highest_outstanding",
          "profitable",
          "summary",
        ];
        const customerName =
          entities.customer?.name ?? (listTypes.includes(queryType) ? null : extractCustomerNameFragment(intent.raw));
        const result = processCustomerQuery(queryType, customerName, store, ledger, {
          productName: entities.product?.name ?? null,
          message: intent.raw,
        });
        return result.ok ? result.message : `I couldn't answer that: ${result.error ?? result.message}`;
      }
      case "suppliers": {
        const data = this.context.data;
        if (!data) {
          return "Supplier intelligence isn't available in this context.";
        }
        const ledger = buildSupplierLedger(data, new Date());
        const queryType = (intent.queryType as Parameters<typeof processSupplierQuery>[0]) ?? "summary";
        const listTypes: string[] = [
          "all_outstanding",
          "overdue",
          "near_limit",
          "blocked",
          "top",
          "inactive",
          "highest_outstanding",
          "profitable",
          "summary",
        ];
        const supplierName =
          entities.supplier?.name ?? (listTypes.includes(queryType) ? null : extractSupplierNameFragment(intent.raw));
        const result = processSupplierQuery(queryType, supplierName, store, ledger, {
          productName: entities.product?.name ?? null,
          message: intent.raw,
        });
        return result.ok ? result.message : `I couldn't answer that: ${result.error ?? result.message}`;
      }
      case "financial": {
        const data = this.context.data;
        if (!data) {
          return "Financial intelligence isn't available in this context.";
        }
        const ledger = buildFinancialLedger(data, new Date());
        const queryType = (intent.queryType as FinancialQueryKind) ?? "financial_summary";
        const result = processFinancialQuery(queryType, ledger, intent, intent.raw);
        return result.ok ? result.message : `I couldn't answer that: ${result.message}`;
      }
      case "business-intelligence": {
        const data = this.context.data;
        if (!data) {
          return "Business intelligence isn't available in this context.";
        }
        const biQueryType = (intent.queryType as BusinessIntelligenceQueryKind) ?? "health_score";
        const biResult = processBusinessIntelligenceQuery(biQueryType, store, data, intent.raw);
        return biResult.ok ? biResult.message : `I couldn't answer that: ${biResult.message}`;
      }
      case "sales":
      case "purchases": {
        return this.businessSummary(intent.module, store);
      }
      case "general": {
        const handler = this.context.generalChatHandler;
        if (handler) {
          return handler(intent.raw, generalContext, recentMessages);
        }
        try {
          const { getGateway } = await import("../conversation/gateway");
          const gateway = getGateway();
          const result = await gateway.chat({
            message: intent.raw,
            sessionId: `assistant-${Date.now().toString(36)}`,
            organizationId: this.context.organizationId,
            channel: "web",
          });
          return result.ok ? result.message : `I'm not sure how to help with that. (${result.error ?? "no response"})`;
        } catch {
          return "I'm here to help with sales, purchases, inventory, staff and location tracking.";
        }
      }
      default:
        return "I couldn't determine what you need. Try asking about sales, stock, staff or locations.";
    }
  }

  async executeAction(
    actionType: string,
    payload: Record<string, unknown>
  ): Promise<ActionResult> {
    switch (actionType) {
      case "create_sale":
        return this.createSale(payload);
      case "create_purchase":
        return this.createPurchase(payload);
      case "assign_staff":
        return this.assignStaff(payload);
      case "reassign_staff":
        return this.reassignStaff(payload);
      case "remove_staff":
        return this.removeStaff(payload);
      case "create_customer":
        return this.createCustomer(payload);
      case "update_customer":
        return this.updateCustomer(payload);
      case "delete_customer":
        return this.deleteCustomer(payload);
      case "create_supplier":
        return this.createSupplier(payload);
      case "update_supplier":
        return this.updateSupplier(payload);
      case "delete_supplier":
        return this.deleteSupplier(payload);
      default:
        return { ok: false, message: `Unsupported action: ${actionType}` };
    }
  }

  private async createSale(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.createSale) {
      return this.context.actionExecutor.createSale(payload, this.context.organizationId);
    }
    const result = await executeSaleDraft(payload, this.context.organizationId);
    return {
      ok: result.ok,
      message: result.message,
      id: result.saleId,
      referenceNumber: result.invoiceNumber,
      error: result.error,
    };
  }

  private async createPurchase(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.createPurchase) {
      return this.context.actionExecutor.createPurchase(payload, this.context.organizationId);
    }
    const result = await executePurchaseDraft(payload, this.context.organizationId);
    return {
      ok: result.ok,
      message: result.message,
      id: result.purchaseId,
      referenceNumber: result.invoiceNumber,
      error: result.error,
    };
  }

  private assignStaff(payload: Record<string, unknown>): ActionResult {
    if (this.context.actionExecutor?.assignStaff) {
      return this.context.actionExecutor.assignStaff(payload);
    }
    return assignEmployee({
      employee_id: String(payload.employee_id ?? ""),
      employee_name: payload.employee_name ? String(payload.employee_name) : undefined,
      area: String(payload.area ?? ""),
    });
  }

  private reassignStaff(payload: Record<string, unknown>): ActionResult {
    if (this.context.actionExecutor?.reassignStaff) {
      return this.context.actionExecutor.reassignStaff(payload);
    }
    return reassignEmployee({
      employee_id: String(payload.employee_id ?? ""),
      employee_name: payload.employee_name ? String(payload.employee_name) : undefined,
      area: String(payload.area ?? ""),
    });
  }

  private removeStaff(payload: Record<string, unknown>): ActionResult {
    if (this.context.actionExecutor?.removeStaff) {
      return this.context.actionExecutor.removeStaff(payload);
    }
    return removeEmployee({
      employee_id: String(payload.employee_id ?? ""),
      employee_name: payload.employee_name ? String(payload.employee_name) : undefined,
    });
  }

  private nextCustomerId(): string {
    return `cust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async createCustomer(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.createCustomer) {
      return this.context.actionExecutor.createCustomer(payload, this.context.organizationId);
    }
    const data = this.context.data;
    if (!data) {
      return { ok: false, message: "Customer persistence isn't available in this context.", error: "NO_DATA" };
    }
    const name = String(payload.customer_name ?? "").trim();
    if (!name) {
      return { ok: false, message: "Customer name is required.", error: "MISSING_NAME" };
    }
    const hasCredit =
      (payload.credit_limit !== undefined && payload.credit_limit !== null) ||
      (payload.credit_days !== undefined && payload.credit_days !== null);
    const now = new Date().toISOString();
    const customer = {
      id: this.nextCustomerId(),
      customer_name: name,
      shop_name: payload.shop_name ? String(payload.shop_name) : null,
      phone: payload.phone ? String(payload.phone) : null,
      whatsapp: payload.whatsapp ? String(payload.whatsapp) : null,
      city: payload.city ? String(payload.city) : null,
      area: payload.area ? String(payload.area) : null,
      customer_type: payload.customer_type ? String(payload.customer_type) : "Retail",
      credit_limit:
        payload.credit_limit !== undefined && payload.credit_limit !== null ? Number(payload.credit_limit) : null,
      credit_policy: hasCredit ? "unrestricted" : "cash_only",
      credit_days:
        payload.credit_days !== undefined && payload.credit_days !== null ? Number(payload.credit_days) : null,
      allow_over_limit: false,
      allow_overdue_sales: false,
      preferred_payment_method: null,
      created_at: now,
      updated_at: now,
    };
    data.customers.push(customer);
    this.context.refreshIndex?.(data);
    return { ok: true, message: `Customer ${name} has been added.`, id: customer.id };
  }

  private async updateCustomer(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.updateCustomer) {
      return this.context.actionExecutor.updateCustomer(payload, this.context.organizationId);
    }
    const data = this.context.data;
    if (!data) {
      return { ok: false, message: "Customer persistence isn't available in this context.", error: "NO_DATA" };
    }
    const id = String(payload.customer_id ?? "").trim();
    const customer = data.customers.find((c) => c.id === id);
    if (!customer) {
      return { ok: false, message: "Customer not found.", error: "CUSTOMER_NOT_FOUND" };
    }
    const textFields: Array<[string, keyof typeof customer]> = [
      ["customer_name", "customer_name"],
      ["shop_name", "shop_name"],
      ["phone", "phone"],
      ["whatsapp", "whatsapp"],
      ["city", "city"],
      ["area", "area"],
      ["customer_type", "customer_type"],
    ];
    for (const [payloadKey, rowKey] of textFields) {
      const value = payload[payloadKey];
      if (value !== undefined) {
        (customer as Record<string, unknown>)[rowKey] = value === null ? null : String(value);
      }
    }
    const numericFields: Array<[string, keyof typeof customer]> = [
      ["credit_limit", "credit_limit"],
      ["credit_days", "credit_days"],
    ];
    for (const [payloadKey, rowKey] of numericFields) {
      const value = payload[payloadKey];
      if (value !== undefined && value !== "") {
        if (value === null) {
          (customer as Record<string, unknown>)[rowKey] = null;
          continue;
        }
        const num = Number(value);
        if (Number.isFinite(num)) (customer as Record<string, unknown>)[rowKey] = num;
      }
    }
    if (payload.credit_limit !== undefined && payload.credit_limit !== null) {
      customer.credit_policy = "unrestricted";
    }
    customer.updated_at = new Date().toISOString();
    this.context.refreshIndex?.(data);
    return { ok: true, message: `Customer ${customer.customer_name} has been updated.` };
  }

  private async deleteCustomer(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.deleteCustomer) {
      return this.context.actionExecutor.deleteCustomer(payload, this.context.organizationId);
    }
    const data = this.context.data;
    if (!data) {
      return { ok: false, message: "Customer persistence isn't available in this context.", error: "NO_DATA" };
    }
    const id = String(payload.customer_id ?? "").trim();
    const index = data.customers.findIndex((c) => c.id === id);
    if (index === -1) {
      return { ok: false, message: "Customer not found.", error: "CUSTOMER_NOT_FOUND" };
    }
    const [customer] = data.customers.splice(index, 1);
    this.context.refreshIndex?.(data);
    return { ok: true, message: `Customer ${customer.customer_name} has been deleted.` };
  }

  private nextSupplierId(): string {
    return `sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async createSupplier(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.createSupplier) {
      return this.context.actionExecutor.createSupplier(payload, this.context.organizationId);
    }
    const data = this.context.data;
    if (!data) {
      return { ok: false, message: "Supplier persistence isn't available in this context.", error: "NO_DATA" };
    }
    const name = String(payload.supplier_name ?? "").trim();
    if (!name) {
      return { ok: false, message: "Supplier name is required.", error: "MISSING_NAME" };
    }
    const hasCredit =
      (payload.credit_limit !== undefined && payload.credit_limit !== null) ||
      (payload.credit_days !== undefined && payload.credit_days !== null);
    const now = new Date().toISOString();
    const supplier = {
      id: this.nextSupplierId(),
      supplier_name: name,
      contact_person: payload.contact_person ? String(payload.contact_person) : null,
      phone: payload.phone ? String(payload.phone) : null,
      whatsapp: payload.whatsapp ? String(payload.whatsapp) : null,
      city: payload.city ? String(payload.city) : null,
      area: payload.area ? String(payload.area) : null,
      notes: payload.notes ? String(payload.notes) : null,
      credit_limit:
        payload.credit_limit !== undefined && payload.credit_limit !== null ? Number(payload.credit_limit) : null,
      credit_policy: hasCredit ? "unrestricted" : "cash_only",
      credit_days:
        payload.credit_days !== undefined && payload.credit_days !== null ? Number(payload.credit_days) : null,
      allow_over_limit: false,
      allow_overdue_sales: false,
      preferred_payment_method: null,
      created_at: now,
      updated_at: now,
    };
    data.suppliers.push(supplier);
    this.context.refreshIndex?.(data);
    return { ok: true, message: `Supplier ${name} has been added.`, id: supplier.id };
  }

  private async updateSupplier(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.updateSupplier) {
      return this.context.actionExecutor.updateSupplier(payload, this.context.organizationId);
    }
    const data = this.context.data;
    if (!data) {
      return { ok: false, message: "Supplier persistence isn't available in this context.", error: "NO_DATA" };
    }
    const id = String(payload.supplier_id ?? "").trim();
    const supplier = data.suppliers.find((s) => s.id === id);
    if (!supplier) {
      return { ok: false, message: "Supplier not found.", error: "SUPPLIER_NOT_FOUND" };
    }
    const textFields: Array<[string, keyof typeof supplier]> = [
      ["supplier_name", "supplier_name"],
      ["contact_person", "contact_person"],
      ["phone", "phone"],
      ["whatsapp", "whatsapp"],
      ["city", "city"],
      ["area", "area"],
      ["notes", "notes"],
    ];
    for (const [payloadKey, rowKey] of textFields) {
      const value = payload[payloadKey];
      if (value !== undefined) {
        (supplier as Record<string, unknown>)[rowKey] = value === null ? null : String(value);
      }
    }
    const numericFields: Array<[string, keyof typeof supplier]> = [
      ["credit_limit", "credit_limit"],
      ["credit_days", "credit_days"],
    ];
    for (const [payloadKey, rowKey] of numericFields) {
      const value = payload[payloadKey];
      if (value !== undefined && value !== "") {
        if (value === null) {
          (supplier as Record<string, unknown>)[rowKey] = null;
          continue;
        }
        const num = Number(value);
        if (Number.isFinite(num)) (supplier as Record<string, unknown>)[rowKey] = num;
      }
    }
    if (payload.credit_limit !== undefined && payload.credit_limit !== null) {
      supplier.credit_policy = "unrestricted";
    }
    supplier.updated_at = new Date().toISOString();
    this.context.refreshIndex?.(data);
    return { ok: true, message: `Supplier ${supplier.supplier_name} has been updated.` };
  }

  private async deleteSupplier(payload: Record<string, unknown>): Promise<ActionResult> {
    if (this.context.actionExecutor?.deleteSupplier) {
      return this.context.actionExecutor.deleteSupplier(payload, this.context.organizationId);
    }
    const data = this.context.data;
    if (!data) {
      return { ok: false, message: "Supplier persistence isn't available in this context.", error: "NO_DATA" };
    }
    const id = String(payload.supplier_id ?? "").trim();
    const index = data.suppliers.findIndex((s) => s.id === id);
    if (index === -1) {
      return { ok: false, message: "Supplier not found.", error: "SUPPLIER_NOT_FOUND" };
    }
    const [supplier] = data.suppliers.splice(index, 1);
    this.context.refreshIndex?.(data);
    return { ok: true, message: `Supplier ${supplier.supplier_name} has been deleted.` };
  }

  private businessSummary(module: "sales" | "purchases", store: MemoryStore): string {
    if (module === "sales") {
      const today = store.sales.today;
      const month = store.sales.thisMonth;
      return (
        `Sales today: ${today.invoiceCount} invoice(s), revenue Rs ${today.revenue.toFixed(2)}, profit Rs ${today.profit.toFixed(2)}. ` +
        `This month: ${month.invoiceCount} invoice(s), revenue Rs ${month.revenue.toFixed(2)}, profit Rs ${month.profit.toFixed(2)}.`
      );
    }
    const today = store.purchases.today;
    const month = store.purchases.thisMonth;
    return (
      `Purchases today: ${today.invoiceCount} invoice(s), total Rs ${today.totalAmount.toFixed(2)}. ` +
      `This month: ${month.invoiceCount} invoice(s), total Rs ${month.totalAmount.toFixed(2)}.`
    );
  }
}

export function entityValue(entities: ResolvedEntities, field: string): unknown {
  switch (field) {
    case "customer_id": return entities.customer?.id ?? null;
    case "customer_name": return entities.customer?.name ?? null;
    case "supplier_id": return entities.supplier?.id ?? null;
    case "supplier_name": return entities.supplier?.name ?? null;
    case "product_id": return entities.product?.id ?? null;
    case "employee_id": return entities.employee?.id ?? null;
    case "quantity": return entities.quantity;
    case "selling_price": return entities.sellingPrice;
    case "purchase_price": return entities.purchasePrice;
    case "payment_type": return entities.paymentType;
    case "area": return entities.area;
    case "credit_days": return entities.creditDays;
    case "credit_limit": return entities.creditLimit;
    case "customer_type": return entities.customerType;
    case "phone": return entities.phone;
    case "notes": return entities.notes;
    default: return null;
  }
}
