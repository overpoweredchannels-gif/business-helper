// TradeOS ERP — Entity Import/Export Registry
//
// Central registry of all entity import/export configurations. Each entity
// registers its config here, and the generic wizard components look up the
// config by entityKey.
//
// Add new entities by importing their config and adding to the registry.

import type { EntityImportConfig, EntityExportConfig, ImportFieldDef, ColumnMapping, ImportPreviewResult, ImportRunResult, ParsedRow } from "./types";

// Import entity configs (will create these next)
import { productsImportConfig } from "./entities/products";
import { customersImportConfig } from "./entities/customers";
import { brandsImportConfig } from "./entities/brands";
import { categoriesImportConfig } from "./entities/categories";
import { salesInvoicesImportConfig } from "./entities/sales-invoices";
import { employeesImportConfig } from "./entities/employees";
import { staffImportConfig } from "./entities/staff";
import { territoriesImportConfig } from "./entities/territories";
import { routesImportConfig } from "./entities/routes";
import { purchasesImportConfig } from "./entities/purchases";
import { customerPaymentsImportConfig } from "./entities/customer-payments";
import { supplierPaymentsImportConfig } from "./entities/supplier-payments";
import { customerCreditImportConfig } from "./entities/customer-credit";

export const ENTITY_REGISTRY: Record<string, EntityImportConfig> = {
  products: productsImportConfig,
  customers: customersImportConfig,
  brands: brandsImportConfig,
  categories: categoriesImportConfig,
  sales_invoices: salesInvoicesImportConfig,
  employees: employeesImportConfig,
  staff: staffImportConfig,
  territories: territoriesImportConfig,
  routes: routesImportConfig,
  purchases: purchasesImportConfig,
  customer_payments: customerPaymentsImportConfig,
  supplier_payments: supplierPaymentsImportConfig,
  customer_credit: customerCreditImportConfig,
};

// Re-export types for consumers
export type { EntityImportConfig, EntityExportConfig, ImportFieldDef, ColumnMapping, ImportPreviewResult, ImportRunResult, ParsedRow };

export function getEntityConfig(entityKey: string): EntityImportConfig | null {
  return ENTITY_REGISTRY[entityKey] ?? null;
}

export function getAllEntityKeys(): string[] {
  return Object.keys(ENTITY_REGISTRY);
}

export function getEntityExportConfig(entityKey: string): EntityExportConfig | null {
  const config = ENTITY_REGISTRY[entityKey];
  return config?.export ?? null;
}