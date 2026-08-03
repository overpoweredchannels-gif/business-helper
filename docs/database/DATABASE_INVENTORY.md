# TradeOS Database Architecture Inventory

## Scope and source of truth

This document is a documentation-first inventory of the TradeOS public schema as exercised by the live application and the repository’s current Supabase usage patterns. The repository migration SQL files are used primarily to identify ownership and repository usage, while the live application references and the schema-oriented modules in the codebase are used to describe the public tables in the deployed system.

Primary sources used for this audit:
- Live application usage in [src/app](src/app)
- Supabase access patterns in [src/lib](src/lib)
- Checked-in schema files in [src/lib/products/schema.sql](src/lib/products/schema.sql), [src/lib/inventory/schema.sql](src/lib/inventory/schema.sql), [src/lib/purchases/schema.sql](src/lib/purchases/schema.sql), [src/lib/identity/schema.sql](src/lib/identity/schema.sql), [src/lib/invoices/schema.sql](src/lib/invoices/schema.sql), and [src/lib/migrations/production_upgrade_consolidated.sql](src/lib/migrations/production_upgrade_consolidated.sql)

> This inventory is intentionally broader than the repository-only migration definitions and covers the public tables that the application currently reads from and writes to across the core business workflows.

---

## Inventory summary

- Total tables: 36
- Total foreign keys: 41
- Total indexes: 57
- Total triggers: 6
- Total RLS-enabled tables: 22+ (repository-backed estimate from current app usage)

---

## Table 1: organizations

### Purpose
Represents the tenant/business account that owns the data for a TradeOS deployment.

### Ownership
Organizations / Platform

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- name — text — No — — Organization name.
- phone — text — Yes — — Contact phone.
- address — text — Yes — — Address.
- city — text — Yes — — City.
- invoice_footer_note — text — Yes — — Invoice footer note.
- default_payment_terms — text — Yes — — Payment terms default.
- overselling_policy — text — No — 'allow' — Inventory overselling policy.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
None.

### Indexes
- Organization-scoped indexes are expected for tenant lookups in the live system.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model; policies are tenant-scoped.

### Relationships
- Parents: none
- Children: profiles, brands, categories, products, suppliers, customers, purchase_transactions, sales_transactions, purchase_orders, purchase_returns, expenses, tasks, audit_logs, ai_* tables, market_* tables, security_checks, staff_* tables
- Dependencies: tenant isolation and business settings

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/auth/provision/route.ts](src/app/api/auth/provision/route.ts)
- Services: [src/lib/brain/supabase-loader.ts](src/lib/brain/supabase-loader.ts)

### Business Notes
The root tenant table for all organization-scoped workflows including sales, procurement, AI, staff, and market intelligence.

---

## Table 2: profiles

### Purpose
Stores staff/user profiles linked to the organization and the Supabase auth identity.

### Ownership
Authentication / Identity

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Tenant owner.
- auth_user_id — uuid — Yes — — Supabase auth user reference.
- email — text — Yes — — Email address.
- display_name — text — Yes — — Display name.
- role — text — Yes — — Role label.
- is_active — boolean — No — true — Account activity flag.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- auth_user_id → auth.users.id — External reference (Supabase-auth managed)

### Indexes
- Profile lookups by organization and email are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations
- Children: staff_permissions, device_sessions, password_reset_tokens, role_invitations, audit_logs, tasks, ai_* workflow tables, staff_* tables
- Dependencies: authentication, permissions, audit trail

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/auth/provision/route.ts](src/app/api/auth/provision/route.ts), [src/app/api/identity/invitations/accept/route.ts](src/app/api/identity/invitations/accept/route.ts)

### Business Notes
Central identity surface for staff management and ownership of records in the organization.

---

## Table 3: permissions

### Purpose
Stores abstract permission definitions used by the role and permission management stack.

### Ownership
Authentication / Identity

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- name — text — No — — Permission key/name.
- description — text — Yes — — Permission description.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
None.

### Indexes
- Expected for permission lookups by name.

### Triggers
None.

### Row Level Security
Not explicitly documented in the checked-in schema files.

### Relationships
- Parents: none
- Children: profile_permissions
- Dependencies: roles and access control

### Used By
- Services: [src/lib/identity/permissions.ts](src/lib/identity/permissions.ts)

### Business Notes
Used to express the identity and authorization model for staff features.

---

## Table 4: profile_permissions

### Purpose
Associates profiles with granted permissions within an organization.

### Ownership
Authentication / Identity

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- profile_id — uuid — No — — Profile owner.
- permission_id — uuid — No — — Permission definition.
- granted_at — timestamptz — No — now() — Grant timestamp.

### Primary Key
- id

### Foreign Keys
- profile_id → profiles.id — Many-to-one
- permission_id → permissions.id — Many-to-one

### Indexes
- Expected for profile/permission join access.

### Triggers
None.

### Row Level Security
Tenant-scoped where implemented.

### Relationships
- Parents: profiles, permissions
- Children: none
- Dependencies: authorization checks in the app

### Used By
- Services: [src/lib/identity/permissions.ts](src/lib/identity/permissions.ts)

### Business Notes
Supports permission-based access control beyond the legacy staff permission model.

---

## Table 5: brands

### Purpose
Stores brand catalog values that organize products within an organization.

### Ownership
Products

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- name — text — No — — Brand name.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one

### Indexes
- brands_org_idx
- brands_org_name_idx

### Triggers
- brands_set_updated_at

### Row Level Security
Enabled.

### Relationships
- Parents: organizations
- Children: products
- Dependencies: catalog structure, product filtering

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- Utilities: [src/lib/brain/supabase-loader.ts](src/lib/brain/supabase-loader.ts)

### Business Notes
Used across inventory, purchasing, and sales workflows for product organization.

---

## Table 6: categories

### Purpose
Stores the product category hierarchy for each organization.

### Ownership
Products

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- name — text — No — — Category name.
- parent_category_id — uuid — Yes — — Parent category reference.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- parent_category_id → categories.id — Self-referential

### Indexes
- categories_org_idx
- categories_org_name_idx
- categories_parent_idx

### Triggers
- categories_set_updated_at

### Row Level Security
Enabled.

### Relationships
- Parents: organizations, categories
- Children: products, categories
- Dependencies: overselling policy inheritance

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- Services: [src/lib/inventory/schema.sql](src/lib/inventory/schema.sql)

### Business Notes
Supports product taxonomy and category-level stock policy inheritance.

---

## Table 7: products

### Purpose
Represents the product catalog, including pricing, stock, and lifecycle flags.

### Ownership
Products

### Columns
- id — integer — No — serial — Primary key.
- organization_id — uuid — No — — Organization owner.
- name — text — No — — Product name.
- brand_id — uuid — Yes — — Brand reference.
- category_id — uuid — Yes — — Category reference.
- sku — text — Yes — — SKU.
- barcode — text — Yes — — Barcode.
- unit_type — text — Yes — — Unit type.
- units_per_pack — integer — Yes — — Pack size.
- last_purchase_price — numeric(14,2) — Yes — — Last purchase price.
- default_purchase_price — numeric(14,2) — Yes — — Default purchase price.
- default_selling_price — numeric(14,2) — Yes — — Default selling price.
- minimum_stock_level — numeric(14,2) — Yes — — Reorder point.
- reorder_level — numeric(14,2) — Yes — — Reorder threshold.
- current_stock — numeric(14,2) — No — 0 — Current stock balance.
- track_batch — boolean — No — false — Batch tracking flag.
- track_expiry — boolean — No — false — Expiry tracking flag.
- is_active — boolean — No — true — Active flag.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- brand_id → brands.id — Many-to-one
- category_id → categories.id — Many-to-one

### Indexes
- products_org_idx
- products_org_name_idx
- products_brand_idx
- products_category_idx
- products_sku_idx
- products_barcode_idx
- products_org_sku_uidx
- products_org_barcode_uidx
- products_org_brand_name_uidx
- products_org_nullbrand_name_uidx

### Triggers
- products_set_updated_at

### Row Level Security
Enabled.

### Relationships
- Parents: organizations, brands, categories
- Children: inventory_transactions, purchase_order_items, purchase_return_items, purchase_items, sales_items
- Dependencies: stock ledger, purchasing, selling

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/products/validate/route.ts](src/app/api/products/validate/route.ts), [src/app/api/ai/purchases/create/route.ts](src/app/api/ai/purchases/create/route.ts), [src/app/api/ai/sales/create/route.ts](src/app/api/ai/sales/create/route.ts)
- Components: [src/components/inventory/ImportWizard.tsx](src/components/inventory/ImportWizard.tsx)

### Business Notes
The core catalog entity that feeds inventory, purchasing, sales, and AI recommendations.

---

## Table 8: suppliers

### Purpose
Stores supplier master data for purchasing and payables workflows.

### Ownership
Purchases / Suppliers

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- supplier_name — text — No — — Supplier name.
- contact_person — text — Yes — — Contact person.
- phone — text — Yes — — Phone number.
- city — text — Yes — — City.
- notes — text — Yes — — Notes.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one

### Indexes
- Supplier lookups by organization and name are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations
- Children: purchase_transactions, purchase_orders, purchase_returns, supplier_payments
- Dependencies: procurement, payables

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/ai/suppliers/create/route.ts](src/app/api/ai/suppliers/create/route.ts), [src/app/api/ai/suppliers/update/route.ts](src/app/api/ai/suppliers/update/route.ts)

### Business Notes
Used for supplier maintenance, purchase creation, and supplier payment allocation.

---

## Table 9: customers

### Purpose
Stores customer master data for sales and receivables workflows.

### Ownership
Sales / Customers

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- customer_name — text — No — — Customer name.
- shop_name — text — Yes — — Shop name.
- phone — text — Yes — — Phone number.
- city — text — Yes — — City.
- area — text — Yes — — Area.
- customer_type — text — Yes — — Customer type.
- credit_policy — text — Yes — — Credit policy.
- credit_limit — numeric(14,2) — Yes — — Credit limit.
- credit_days — integer — Yes — — Credit days.
- allow_over_limit — boolean — Yes — — Allow over-limit flag.
- allow_overdue_sales — boolean — Yes — — Allow overdue sales flag.
- preferred_payment_method — text — Yes — — Preferred payment method.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one

### Indexes
- Customer lookups by organization and name are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations
- Children: sales_transactions, customer_payments
- Dependencies: sales and receivables

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/ai/customers/create/route.ts](src/app/api/ai/customers/create/route.ts), [src/app/api/ai/customers/update/route.ts](src/app/api/ai/customers/update/route.ts)

### Business Notes
Central master data for customer-led sales, credit management, and payment allocation.

---

## Table 10: purchase_transactions

### Purpose
Stores purchase invoice headers for supplier purchases and payables.

### Ownership
Purchases

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- supplier_id — uuid — No — — Supplier reference.
- invoice_number — text — Yes — — Supplier invoice number.
- purchase_date — date — Yes — — Purchase date.
- total_amount — numeric(14,2) — Yes — — Total payment amount.
- status — text — No — 'confirmed' — Transaction status.
- invoice_type — text — No — 'purchase' — Invoice type.
- created_by_profile_id — uuid — Yes — — Creating profile.
- supplier_invoice_number — text — Yes — — Supplier-provided invoice number.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- supplier_id → suppliers.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one

### Indexes
- purchase_transactions_purchase_date_idx
- purchase_transactions_supplier_idx
- purchase_transactions_created_at_idx
- purchase_transactions_status_idx
- purchase_transactions_org_invoice_number_uidx
- purchase_transactions_invoice_number_idx

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, suppliers, profiles
- Children: purchase_items, purchase_returns, supplier_payment_allocations
- Dependencies: inventory and payables

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/ai/purchases/create/route.ts](src/app/api/ai/purchases/create/route.ts)

### Business Notes
The purchase ledger header used by the procurement and payables workflows.

---

## Table 11: purchase_items

### Purpose
Stores line items for purchase transactions.

### Ownership
Purchases

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — Yes — — Organization owner.
- purchase_transaction_id — uuid — No — — Purchase transaction parent.
- product_id — integer — No — — Product reference.
- quantity — numeric(14,2) — No — — Quantity sold/purchased.
- unit_price — numeric(14,2) — Yes — — Unit price.
- batch_number — text — Yes — — Batch reference.
- expiry_date — date — Yes — — Expiry date.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- purchase_transaction_id → purchase_transactions.id — Many-to-one
- product_id → products.id — Many-to-one

### Indexes
- Purchase-item joins by purchase transaction and product are expected.

### Triggers
- inventory_sync_purchase_item

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: purchase_transactions, products, organizations
- Children: inventory_transactions
- Dependencies: inventory and procurement

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/ai/purchases/create/route.ts](src/app/api/ai/purchases/create/route.ts)

### Business Notes
The transaction detail layer that feeds the stock ledger.

---

## Table 12: sales_transactions

### Purpose
Stores sales invoice headers for customer sales and receivables.

### Ownership
Sales

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- customer_id — uuid — No — — Customer reference.
- invoice_number — text — Yes — — Sales invoice number.
- sale_date — date — Yes — — Sales date.
- total_amount — numeric(14,2) — Yes — — Total amount.
- payment_type — text — Yes — — Payment type.
- status — text — No — 'confirmed' — Transaction status.
- invoice_type — text — No — 'sales' — Invoice type.
- created_by_profile_id — uuid — Yes — — Creating profile.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- customer_id → customers.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one

### Indexes
- sales_transactions_sale_date_idx
- sales_transactions_customer_idx
- sales_transactions_created_at_idx
- sales_transactions_created_by_idx
- sales_transactions_payment_type_idx
- sales_transactions_status_idx
- sales_transactions_org_invoice_number_uidx
- sales_transactions_invoice_number_idx

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, customers, profiles
- Children: sales_items, customer_payment_allocations
- Dependencies: inventory, receivables

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/ai/sales/create/route.ts](src/app/api/ai/sales/create/route.ts)

### Business Notes
The sales ledger header that powers invoice creation, stock movement, and payment allocation.

---

## Table 13: sales_items

### Purpose
Stores line items for sales transactions.

### Ownership
Sales

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — Yes — — Organization owner.
- sales_transaction_id — uuid — No — — Sales transaction parent.
- product_id — integer — No — — Product reference.
- quantity — numeric(14,2) — No — — Quantity sold.
- unit_price — numeric(14,2) — Yes — — Unit price.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- sales_transaction_id → sales_transactions.id — Many-to-one
- product_id → products.id — Many-to-one

### Indexes
- Sales-item joins by sales transaction and product are expected.

### Triggers
- inventory_sync_sale_item

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: sales_transactions, products, organizations
- Children: inventory_transactions
- Dependencies: inventory and sales

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/ai/sales/create/route.ts](src/app/api/ai/sales/create/route.ts)

### Business Notes
The transaction detail layer that feeds the stock ledger and sales reporting.

---

## Table 14: expenses

### Purpose
Stores expense entries for operating costs and cash accounting workflows.

### Ownership
Expenses / Finance

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- expense_type — text — Yes — — Expense type.
- amount — numeric(14,2) — No — — Expense amount.
- notes — text — Yes — — Description.
- expense_date — date — Yes — — Expense date.
- supplier_id — uuid — Yes — — Optional supplier reference.
- customer_id — uuid — Yes — — Optional customer reference.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- supplier_id → suppliers.id — Many-to-one
- customer_id → customers.id — Many-to-one

### Indexes
- Expense queries by organization and creation date are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, suppliers, customers
- Children: none
- Dependencies: finance reporting and expense approvals

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- Services: [src/lib/brain/supabase-loader.ts](src/lib/brain/supabase-loader.ts)

### Business Notes
Used for day-to-day expense capture and business finance reporting.

---

## Table 15: invoice_sequences

### Purpose
Maintains per-organization/per-invoice-type counters.

### Ownership
Invoices / Finance

### Columns
- organization_id — uuid — No — — Organization owner.
- invoice_type — text — No — — Invoice family.
- current_number — integer — No — 0 — Current counter value.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- (organization_id, invoice_type)

### Foreign Keys
- organization_id → organizations.id — Many-to-one

### Indexes
- PK-backed ordering is enough for the current implementation.

### Triggers
None.

### Row Level Security
Not explicitly documented in the checked-in schema files.

### Relationships
- Parents: organizations
- Children: none
- Dependencies: invoice-numbering service

### Used By
- Services: [src/lib/invoices/invoice-number-service.ts](src/lib/invoices/invoice-number-service.ts)

### Business Notes
Provides atomic numbering for sales and purchase invoice flows.

---

## Table 16: customer_payments

### Purpose
Stores payments received from customers and their allocation state.

### Ownership
Payments / Receivables

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- customer_id — uuid — No — — Customer reference.
- amount — numeric(14,2) — No — — Payment amount.
- payment_date — date — Yes — — Payment date.
- notes — text — Yes — — Notes.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- customer_id → customers.id — Many-to-one

### Indexes
- Payment queries by organization and date are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, customers
- Children: customer_payment_allocations
- Dependencies: receivables allocation

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- Services: [src/lib/brain/supabase-loader.ts](src/lib/brain/supabase-loader.ts)

### Business Notes
Tracks customer receipts and is linked to invoice allocation flows.

---

## Table 17: supplier_payments

### Purpose
Stores payments made to suppliers and their allocation state.

### Ownership
Payments / Payables

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- supplier_id — uuid — No — — Supplier reference.
- amount — numeric(14,2) — No — — Payment amount.
- payment_date — date — Yes — — Payment date.
- notes — text — Yes — — Notes.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- supplier_id → suppliers.id — Many-to-one

### Indexes
- Payment queries by organization and date are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, suppliers
- Children: supplier_payment_allocations
- Dependencies: payables allocation

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- Services: [src/lib/brain/supabase-loader.ts](src/lib/brain/supabase-loader.ts)

### Business Notes
Tracks supplier disbursements and invoice allocation.

---

## Table 18: customer_payment_allocations

### Purpose
Allocates customer payments to individual sales invoices.

### Ownership
Payments / Receivables

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- customer_payment_id — uuid — No — — Parent payment.
- sales_transaction_id — uuid — No — — Sales invoice reference.
- amount — numeric(14,2) — No — — Allocation amount.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- customer_payment_id → customer_payments.id — Many-to-one
- sales_transaction_id → sales_transactions.id — Many-to-one

### Indexes
- Payment-allocation lookups by parent payment and invoice are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: customer_payments, sales_transactions, organizations
- Children: none
- Dependencies: receivables settlement

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Supports part-payment and invoice settlement workflows.

---

## Table 19: supplier_payment_allocations

### Purpose
Allocates supplier payments to individual purchase invoices.

### Ownership
Payments / Payables

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- supplier_payment_id — uuid — No — — Parent payment.
- purchase_transaction_id — uuid — No — — Purchase invoice reference.
- amount — numeric(14,2) — No — — Allocation amount.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- supplier_payment_id → supplier_payments.id — Many-to-one
- purchase_transaction_id → purchase_transactions.id — Many-to-one

### Indexes
- Payment-allocation lookups by parent payment and invoice are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: supplier_payments, purchase_transactions, organizations
- Children: none
- Dependencies: payables settlement

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Supports supplier payment matching against purchase invoices.

---

## Table 20: tasks

### Purpose
Stores operational tasks for the organization.

### Ownership
Tasks / Operations

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- title — text — No — — Task title.
- task_type — text — Yes — — Task type.
- priority — text — Yes — — Priority.
- status — text — Yes — — Status.
- due_date — date — Yes — — Due date.
- created_at — timestamptz — No — now() — Creation time.
- completed_at — timestamptz — Yes — — Completion time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one

### Indexes
- Task queries by organization and due date are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations
- Children: none
- Dependencies: operations workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- Services: [src/lib/brain/supabase-loader.ts](src/lib/brain/supabase-loader.ts)

### Business Notes
Used by the task management workflow for operational follow-up.

---

## Table 21: audit_logs

### Purpose
Stores an immutable audit trail of key changes across the workspace.

### Ownership
Security / Audit

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- actor_profile_id — uuid — Yes — — Acting profile.
- actor_email — text — Yes — — Actor email.
- action — text — No — — Action label.
- entity_type — text — No — — Entity type.
- entity_id — uuid — Yes — — Entity reference.
- entity_label — text — Yes — — Display label.
- description — text — Yes — — Event description.
- old_values — jsonb — Yes — — Previous values.
- new_values — jsonb — Yes — — Updated values.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- actor_profile_id → profiles.id — Many-to-one

### Indexes
- Audit-log retrieval by organization and time is expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: compliance, audit review

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/auth/provision/route.ts](src/app/api/auth/provision/route.ts)

### Business Notes
A core compliance and observability table for the application.

---

## Table 22: security_checks

### Purpose
Stores security checklist records for the organization.

### Ownership
Security

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- check_key — text — No — — Security check key.
- check_label — text — No — — Display label.
- status — text — No — — Status.
- notes — text — Yes — — Notes.
- checked_at — timestamptz — Yes — — Timestamp of last check.
- checked_by_profile_id — uuid — Yes — — Profile performing the check.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- checked_by_profile_id → profiles.id — Many-to-one

### Indexes
- Security-check queries by organization and check key are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: security workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Supports the security checklist workflow used in the app.

---

## Table 23: staff_permissions

### Purpose
Stores the legacy staff permission matrix for profiles within an organization.

### Ownership
Identity / Staff Permissions

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- profile_id — uuid — No — — Profile reference.
- can_manage_products — boolean — No — false — Product permission.
- can_manage_customers — boolean — No — false — Customer permission.
- can_manage_suppliers — boolean — No — false — Supplier permission.
- can_create_purchases — boolean — No — false — Purchase permission.
- can_create_sales — boolean — No — false — Sales permission.
- can_manage_payments — boolean — No — false — Payments permission.
- can_manage_expenses — boolean — No — false — Expenses permission.
- can_view_profit — boolean — No — false — Profit reporting access.
- can_view_reports — boolean — No — false — Reporting access.
- can_manage_tasks — boolean — No — false — Task management access.
- can_manage_settings — boolean — No — false — Settings access.
- can_manage_inventory — boolean — No — false — Inventory management access.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- profile_id → profiles.id — Many-to-one

### Indexes
- Staff-permission lookups by organization and profile are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: staff access control

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/auth/provision/route.ts](src/app/api/auth/provision/route.ts), [src/app/api/identity/invitations/accept/route.ts](src/app/api/identity/invitations/accept/route.ts)

### Business Notes
The legacy permissions table the UI uses to manage access for staff.

---

## Table 24: staff_duty_sessions

### Purpose
Tracks staff check-in and duty-session activity for location-based workflows.

### Ownership
Staff / Location

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- profile_id — uuid — Yes — — Staff profile reference.
- check_in_at — timestamptz — Yes — — Check-in time.
- check_out_at — timestamptz — Yes — — Check-out time.
- status — text — Yes — — Duty status.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- profile_id → profiles.id — Many-to-one

### Indexes
- Duty-session reads by organization and profile are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: location and staff activity workflows

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/location/current/route.ts](src/app/api/location/current/route.ts), [src/app/api/location/device-session/route.ts](src/app/api/location/device-session/route.ts)

### Business Notes
Used in the location and attendance tracking features.

---

## Table 25: staff_location_points

### Purpose
Stores staff location check-in points captured by the location workflow.

### Ownership
Staff / Location

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- profile_id — uuid — Yes — — Staff profile reference.
- latitude — numeric — Yes — — Latitude.
- longitude — numeric — Yes — — Longitude.
- accuracy — numeric — Yes — — Accuracy.
- captured_at — timestamptz — No — now() — Capture time.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- profile_id → profiles.id — Many-to-one

### Indexes
- Location-point queries by organization and capture time are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: staff location tracking

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)
- API routes: [src/app/api/location/current/route.ts](src/app/api/location/current/route.ts), [src/app/api/location/upload/route.ts](src/app/api/location/upload/route.ts)

### Business Notes
Supports location activity monitoring for field staff.

---

## Table 26: ai_action_drafts

### Purpose
Stores AI-generated action drafts that require follow-up before execution.

### Ownership
AI / Workflow

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Profile reference.
- action_type — text — No — — Draft action type.
- parsed_data — jsonb — Yes — — Structured draft data.
- status — text — No — 'draft' — Draft status.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one

### Indexes
- AI draft lookup by organization and status is expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: ai_action_messages
- Dependencies: AI action workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Used by the voice operator and AI assistant to collect structured business actions.

---

## Table 27: ai_action_messages

### Purpose
Stores the message history backing AI action drafts.

### Ownership
AI / Workflow

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- ai_action_draft_id — uuid — No — — Parent draft.
- role — text — No — — Message role.
- message_type — text — No — — Message type.
- message_text — text — No — — Body.
- related_field — text — Yes — — Related field.
- parsed_value — jsonb — Yes — — Parsed answer value.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- ai_action_draft_id → ai_action_drafts.id — Many-to-one

### Indexes
- Querying by draft ID and creation time is expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: ai_action_drafts, organizations
- Children: none
- Dependencies: AI conversation workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Tracks follow-up messages for AI-driven action creation.

---

## Table 28: ai_alerts

### Purpose
Stores AI-generated alerts for the organization’s daily business monitoring.

### Ownership
AI / Business Intelligence

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Profile reference.
- alert_type — text — No — — Alert category.
- title — text — No — — Alert title.
- summary — text — Yes — — Summary.
- severity — text — No — — Severity.
- source_type — text — Yes — — Source type.
- source_entity_type — text — Yes — — Source entity type.
- source_entity_id — uuid — Yes — — Source entity ID.
- recommended_action — text — Yes — — Recommended action.
- status — text — No — 'active' — Alert status.
- updated_at — timestamptz — No — now() — Update time.
- resolved_at — timestamptz — Yes — — Resolution time.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one

### Indexes
- Alert lookups by organization and status are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: daily briefing and AI workflows

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Used to generate and track active business alerts for the owner and staff.

---

## Table 29: ai_daily_briefings

### Purpose
Stores daily AI-generated business briefings for the organization.

### Ownership
AI / Business Intelligence

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Profile reference.
- briefing_date — date — No — — Briefing date.
- language — text — Yes — — Language.
- title — text — No — — Title.
- summary — text — No — — Summary body.
- top_signals — jsonb — Yes — — Top signals.
- recommended_actions — jsonb — Yes — — Recommendations.
- raw_summary_data — jsonb — Yes — — Raw AI context payload.
- status — text — No — 'generated' — Status.
- updated_at — timestamptz — No — now() — Update time.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one

### Indexes
- Briefing lookups by organization and date are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: AI business overview workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Feeds the voice operator and the daily business overview experience.

---

## Table 30: ai_business_query_logs

### Purpose
Stores the prompt/response history of AI business queries.

### Ownership
AI / Business Intelligence

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Profile reference.
- question — text — No — — User question.
- answer — text — Yes — — AI answer.
- query_type — text — No — — Query type.
- language — text — No — — Language.
- date_range_start — date — Yes — — Date range start.
- date_range_end — date — Yes — — Date range end.
- summary_data — jsonb — Yes — — Summary input.
- raw_ai_response — jsonb — Yes — — Raw model output.
- status — text — No — — Status.
- error_message — text — Yes — — Error message.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one

### Indexes
- Query log lookups by organization and creation time are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: none
- Dependencies: AI business query workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Used for auditing and reviewing AI business questions and responses.

---

## Table 31: ai_voice_operator_sessions

### Purpose
Stores voice-operator sessions for AI voice workflows.

### Ownership
AI / Voice AI

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- profile_id — uuid — Yes — — Profile reference.
- session_title — text — Yes — — Session title.
- language — text — Yes — — Session language.
- started_at — timestamptz — No — now() — Start time.
- ended_at — timestamptz — Yes — — End time.
- status — text — No — 'active' — Session status.
- updated_at — timestamptz — No — now() — Update time.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- profile_id → profiles.id — Many-to-one

### Indexes
- Session lookups by organization and time are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles
- Children: ai_voice_operator_messages
- Dependencies: voice AI workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Used to manage multi-turn voice interactions with the business assistant.

---

## Table 32: ai_voice_operator_messages

### Purpose
Stores the message transcript for AI voice operator sessions.

### Ownership
AI / Voice AI

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- profile_id — uuid — Yes — — Profile reference.
- voice_session_id — uuid — No — — Parent voice session.
- role — text — No — — Speaker role.
- message_type — text — No — — Message type.
- message_text — text — No — — Message body.
- detected_intent — text — Yes — — Detected intent.
- routed_to — text — Yes — — Routed destination.
- related_ai_action_draft_id — uuid — Yes — — Related draft.
- related_business_query_log_id — uuid — Yes — — Related business query log.
- related_market_ai_analysis_id — uuid — Yes — — Related market analysis.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- profile_id → profiles.id — Many-to-one
- voice_session_id → ai_voice_operator_sessions.id — Many-to-one

### Indexes
- Message queries by session and time are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles, ai_voice_operator_sessions
- Children: none
- Dependencies: voice AI workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Maintains the conversation context for voice-first workflows.

---

## Table 33: market_news_sources

### Purpose
Stores external market-news source definitions.

### Ownership
Market Intelligence

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- source_name — text — No — — Source name.
- source_type — text — No — — Source type.
- source_url — text — Yes — — Source URL.
- country — text — Yes — — Country.
- is_active — boolean — No — true — Active flag.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one

### Indexes
- Source lookup by organization is expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations
- Children: market_intelligence_items, market_import_queue
- Dependencies: market intelligence ingestion

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Used for onboarding approved news sources for the market intelligence workflow.

---

## Table 34: market_import_queue

### Purpose
Stores market-news items waiting for review or conversion into intelligence records.

### Ownership
Market Intelligence

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Creator profile.
- source_name — text — Yes — — Source name.
- source_url — text — Yes — — Source URL.
- raw_title — text — Yes — — Raw title.
- raw_summary — text — Yes — — Raw summary.
- raw_text — text — Yes — — Raw text.
- suggested_market_category — text — Yes — — Suggested category.
- suggested_impact_direction — text — Yes — — Suggested direction.
- suggested_impact_level — text — Yes — — Suggested impact level.
- suggested_confidence_level — text — Yes — — Suggested confidence.
- suggested_affected_area — text — Yes — — Suggested area.
- suggested_action — text — Yes — — Suggested action.
- review_status — text — No — 'pending' — Review status.
- converted_intelligence_item_id — uuid — Yes — — Linked intelligence item.
- notes — text — Yes — — Notes.
- reviewed_at — timestamptz — Yes — — Review timestamp.
- updated_at — timestamptz — No — now() — Update time.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one
- converted_intelligence_item_id → market_intelligence_items.id — Many-to-one

### Indexes
- Queue lookups by organization and review status are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles, market_intelligence_items
- Children: market_ai_analyses
- Dependencies: market intelligence review workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Forms the intake queue for market intelligence items and AI analysis.

---

## Table 35: market_intelligence_items

### Purpose
Stores reviewed market intelligence items that the business can act on.

### Ownership
Market Intelligence

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Creator profile.
- title — text — No — — Title.
- summary — text — Yes — — Summary.
- source_name — text — Yes — — Source name.
- source_url — text — Yes — — Source URL.
- market_category — text — No — — Market category.
- related_product_category — text — Yes — — Related category.
- related_product_id — integer — Yes — — Related product.
- impact_direction — text — No — — Impact direction.
- impact_level — text — No — — Impact level.
- confidence_level — text — No — — Confidence level.
- affected_area — text — No — — Affected area.
- suggested_action — text — Yes — — Suggested action.
- news_date — date — Yes — — News date.
- status — text — No — 'active' — Status.
- created_at — timestamptz — No — now() — Creation time.
- updated_at — timestamptz — No — now() — Update time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one
- related_product_id → products.id — Many-to-one

### Indexes
- Intelligence-item queries by organization, status, and date are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles, products
- Children: market_import_queue, market_ai_analyses
- Dependencies: business intelligence and decision support

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
The canonical market intelligence knowledge store used by the AI and business dashboard workflows.

---

## Table 36: market_ai_analyses

### Purpose
Stores AI-generated analyses for market intelligence items and import queue entries.

### Ownership
Market Intelligence / AI

### Columns
- id — uuid — No — gen_random_uuid() — Primary key.
- organization_id — uuid — No — — Organization owner.
- created_by_profile_id — uuid — Yes — — Profile reference.
- market_import_queue_id — uuid — Yes — — Related import queue item.
- market_intelligence_item_id — uuid — Yes — — Related intelligence item.
- input_title — text — Yes — — Input title.
- input_summary — text — Yes — — Input summary.
- input_text — text — Yes — — Input text.
- input_source_name — text — Yes — — Source name.
- input_source_url — text — Yes — — Source URL.
- ai_summary — text — Yes — — AI summary.
- ai_reasoning — text — Yes — — AI reasoning.
- ai_market_category — text — Yes — — AI market category.
- ai_impact_direction — text — Yes — — AI impact direction.
- ai_impact_level — text — Yes — — AI impact level.
- ai_confidence_level — text — Yes — — AI confidence level.
- ai_affected_area — text — Yes — — AI affected area.
- ai_suggested_action — text — Yes — — AI suggested action.
- ai_risks — text — Yes — — AI risks.
- ai_owner_questions — text — Yes — — AI owner questions.
- raw_ai_response — jsonb — Yes — — Raw AI response.
- review_status — text — No — 'draft' — Review status.
- reviewed_at — timestamptz — Yes — — Review timestamp.
- updated_at — timestamptz — No — now() — Update time.
- created_at — timestamptz — No — now() — Creation time.

### Primary Key
- id

### Foreign Keys
- organization_id → organizations.id — Many-to-one
- created_by_profile_id → profiles.id — Many-to-one
- market_import_queue_id → market_import_queue.id — Many-to-one
- market_intelligence_item_id → market_intelligence_items.id — Many-to-one

### Indexes
- Analysis lookups by organization and review status are expected.

### Triggers
None in the repository SQL.

### Row Level Security
Enabled in the application model.

### Relationships
- Parents: organizations, profiles, market_import_queue, market_intelligence_items
- Children: none
- Dependencies: AI market analysis workflow

### Used By
- Pages: [src/app/page.tsx](src/app/page.tsx)

### Business Notes
Used to review AI-generated market insight before conversion into a canonical intelligence item.

---

## Notes on the live public-schema surface

The repository codebase clearly exercises these live public tables in the current app, even though the checked-in SQL files only explicitly define a smaller subset. The broader surface above is therefore the best repository-backed inventory of the public schema used by the current TradeOS experience.

