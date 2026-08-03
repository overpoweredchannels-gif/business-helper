# TradeOS Database Access Rules

## 1. Purpose

This document is the canonical database ownership specification for TradeOS.

Its purpose is to ensure that:
- database ownership remains centralized and explicit
- business rules never live in random UI components
- all writes pass through approved services
- future AI agents and contributors obey the same ownership model

TradeOS must treat the database as a governed enterprise asset. The application layer may request data, but the business meaning of that data belongs to approved services, not to ad hoc UI logic.

---

## 2. Database Ownership Layers

TradeOS uses a layered architecture so that ownership, responsibility, and enforcement remain clear.

### UI Layer
Responsibilities:
- collect user input
- render screens and components
- request actions from approved services
- display results

Rules:
- UI must not directly mutate database tables
- UI must not contain business rules beyond basic form validation
- UI must call services or repositories through approved application boundaries

### API Routes
Responsibilities:
- receive HTTP requests
- validate request shape and authentication context
- delegate to business services
- return normalized responses

Rules:
- API routes may orchestrate, but they must not own business logic for core domain behavior
- API routes must not write directly to sensitive tables unless the operation is explicitly approved and delegated through a service

### Business Services
Responsibilities:
- own business rules
- enforce tenant and domain invariants
- coordinate writes across tables
- decide whether an action is valid

Rules:
- Business services are the primary write owners for domain data
- Business services must own schema-level behavior and cross-table consistency
- UI and API layers must not bypass them for writes

### Domain Services
Responsibilities:
- encapsulate reusable rules within a specific business domain
- manage enrichment, validation, normalization, and workflow state
- support service composition

Rules:
- Domain services support business services, but do not replace them
- they help keep ownership central and consistent

### Repository Layer
Responsibilities:
- abstract persistence operations
- translate domain objects into database operations
- execute reads and writes against Supabase or the persistence engine

Rules:
- repositories may access persistence, but they must not contain business logic
- repositories must never invent business rules or decide tenant authorization independently
- they are execution detail, not policy owners

### Supabase Layer
Responsibilities:
- provide the persistence runtime
- enforce available database constraints and RLS behavior
- execute the actual queries

Rules:
- Supabase is the execution platform, not the policy owner
- database constraints are the final safety net
- direct client-side manipulation is forbidden by governance

### Database Layer
Responsibilities:
- enforce final integrity constraints
- preserve tenant isolation
- preserve referential integrity
- log and protect critical state transitions

Rules:
- database constraints are final protection
- the database is the last guardrail against invalid data
- application ownership must still remain centralized in services

---

## 3. Table Ownership Matrix

The following matrix defines the canonical read and write ownership model for the public tables captured in the TradeOS database inventory.

| Table | Read | Write | Owner | Notes |
| --- | --- | --- | --- | --- |
| organizations | Dashboard, Reports, AI, Admin screens | OrganizationService only | Platform Domain | Tenant root record. Never modified from UI. |
| profiles | Dashboard, Admin, Auth flows, AI | ProfileService only | Identity Domain | Staff identity and tenant membership. |
| permissions | Admin, Security services | PermissionService only | Identity Domain | Authorization metadata. |
| profile_permissions | Admin, Security services | PermissionService only | Identity Domain | Fine-grained permission assignment. |
| brands | Dashboard, Inventory views, Reports, AI | ProductService only | Inventory Domain | Catalog reference data. |
| categories | Dashboard, Inventory views, Reports, AI | ProductService only | Inventory Domain | Catalog hierarchy. |
| products | Dashboard, Inventory views, Reports, AI, Purchase/Sales flows | ProductService only | Inventory Domain | Core product catalog. |
| suppliers | Dashboard, Purchase workflows, Reports, AI | PurchaseService only | Procurement Domain | Supplier master data. |
| customers | Dashboard, Sales workflows, Reports, AI | SalesService only | Sales Domain | Customer master data. |
| purchase_transactions | Purchase workflows, Reports, AI | PurchaseService only | Procurement Domain | Purchase invoice header. |
| purchase_items | Purchase workflows, Reports, AI | PurchaseService only | Procurement Domain | Purchase transaction detail. |
| sales_transactions | Sales workflows, Reports, AI | SalesService only | Sales Domain | Sales invoice header. |
| sales_items | Sales workflows, Reports, AI | SalesService only | Sales Domain | Sales transaction detail. |
| expenses | Finance views, Reports, AI | FinanceService only | Finance Domain | Expense accounting data. |
| invoice_sequences | Admin, Billing services | InvoiceService only | Finance Domain | Controlled invoice numbering. |
| customer_payments | Finance views, Receivables flows, Reports, AI | FinanceService only | Finance Domain | Receivables payments. |
| supplier_payments | Finance views, Payables flows, Reports, AI | FinanceService only | Finance Domain | Payables payments. |
| customer_payment_allocations | Finance views, Receivables workflows | FinanceService only | Finance Domain | Payment-to-invoice allocation. |
| supplier_payment_allocations | Finance views, Payables workflows | FinanceService only | Finance Domain | Payment-to-invoice allocation. |
| tasks | Dashboard, Operations views, AI | TaskService only | Operations Domain | Operational task records. |
| audit_logs | Admin, Security, Compliance, Reports | AuditService only | Governance Domain | Immutable audit history. |
| security_checks | Admin, Security | SecurityService only | Security Domain | Security checklist state. |
| staff_permissions | Admin, Security, Staff management | StaffService only | Identity Domain | Legacy staff access matrix. |
| staff_duty_sessions | Staff views, Location workflows | StaffService only | Staff/Operations Domain | Duty session state. |
| staff_location_points | Staff views, Location workflows | StaffService only | Staff/Operations Domain | Staff location audit points. |
| ai_action_drafts | AI workflows, Voice AI | AIService only | AI Domain | AI action draft state. |
| ai_action_messages | AI workflows, Voice AI | AIService only | AI Domain | Conversation and prompt history. |
| ai_alerts | Dashboard, Daily Briefing, AI | AIService only | AI Domain | AI-generated alerts. |
| ai_daily_briefings | Dashboard, Voice AI, AI | AIService only | AI Domain | Daily briefing results. |
| ai_business_query_logs | AI, Compliance, Audit | AIService only | AI Domain | AI business question log. |
| ai_voice_operator_sessions | Voice AI, AI | AIService only | AI Domain | Voice session state. |
| ai_voice_operator_messages | Voice AI, AI | AIService only | AI Domain | Voice transcript records. |
| market_news_sources | Market intelligence views, AI | MarketService only | Market Intelligence Domain | External source definitions. |
| market_import_queue | Market intelligence views, AI | MarketService only | Market Intelligence Domain | Intake queue items. |
| market_intelligence_items | Dashboard, Reports, AI | MarketService only | Market Intelligence Domain | Canonical market signals. |
| market_ai_analyses | AI, Review workflows | MarketService only | Market Intelligence Domain | AI-generated market analyses. |

---

## 4. Forbidden Direct Access

The following tables must never be modified directly from UI components, page-level logic, or ad hoc client code.

### organizations
Why:
- tenant-level root configuration
- affects all other business data
- must be governed centrally

### profiles
Why:
- identity and tenant membership data
- affects security and authorization behavior
- must be changed through approved identity services

### staff_permissions
Why:
- governs role and permission state
- highly sensitive access control data
- must never be changed from UI without service governance

### audit_logs
Why:
- compliance and review history
- should be append-only and controlled
- must not be mutated casually by UI logic

### invoice_sequences
Why:
- controls document numbering integrity
- must not be modified outside the invoice numbering service

### security_checks
Why:
- security posture state
- should be managed through an explicit security workflow

### AI tables
Why:
- ai_action_drafts
- ai_action_messages
- ai_alerts
- ai_daily_briefings
- ai_business_query_logs
- ai_voice_operator_sessions
- ai_voice_operator_messages

These tables must be governed by AIService because they encode workflow state, safety behavior, and auditability.

### Market tables
Why:
- market_news_sources
- market_import_queue
- market_intelligence_items
- market_ai_analyses

These tables represent market intelligence and review workflow state and must be modified through MarketService.

---

## 5. Service Ownership

The following services own the corresponding tables.

### InventoryService
Owns:
- brands
- categories
- products

### PurchaseService
Owns:
- suppliers
- purchase_transactions
- purchase_items
- purchase_orders
- purchase_order_items
- purchase_returns
- purchase_return_items

### SalesService
Owns:
- customers
- sales_transactions
- sales_items

### FinanceService
Owns:
- expenses
- customer_payments
- supplier_payments
- customer_payment_allocations
- supplier_payment_allocations
- invoice_sequences

### IdentityService
Owns:
- profiles
- permissions
- profile_permissions
- staff_permissions

### StaffService
Owns:
- staff_duty_sessions
- staff_location_points

### SecurityService
Owns:
- security_checks

### AuditService
Owns:
- audit_logs

### AIService
Owns:
- ai_action_drafts
- ai_action_messages
- ai_alerts
- ai_daily_briefings
- ai_business_query_logs
- ai_voice_operator_sessions
- ai_voice_operator_messages

### MarketService
Owns:
- market_news_sources
- market_import_queue
- market_intelligence_items
- market_ai_analyses

### PlatformService
Owns:
- organizations

---

## 6. Read-only Tables

The following tables should normally be treated as read-only from the application perspective unless a dedicated service explicitly owns a mutation path:
- audit_logs
- invoice_sequences
- ai_business_query_logs
- ai_voice_operator_messages
- market_ai_analyses
- security_checks

These tables may be read broadly for reporting and compliance, but writes must remain controlled through their owning services.

---

## 7. Audit Requirements

Every mutation must:
- record a timestamp
- record the acting user or profile
- record the organization context
- create an audit entry where applicable

Minimum audit expectations:
- every create, update, delete, and status transition must be traceable
- important financial, security, identity, and AI changes must be persisted in audit logs
- audit entries must preserve the old and new state where feasible

---

## 8. Tenant Rules

All data access must obey tenant isolation.

Rules:
- every query must include organization_id
- no cross-tenant reads are permitted
- no cross-tenant writes are permitted
- tenant context must be enforced at the service boundary and in database access rules

If an operation cannot provide organization context, it must be rejected.

---

## 9. Future Modules

The following domains must reserve ownership patterns for future extension:

### CRM
- customer-facing relationship records
- opportunity and contact workflows

### HR
- employee records
- leave and attendance workflows

### Payroll
- payroll journals
- payslip and payroll approvals

### Warehouse
- warehouse locations
- receiving and dispatch flows

### Accounting
- general ledger
- chart of accounts
- journal entries

### POS
- point-of-sale transactions
- cash drawer state

### Voice AI
- voice workflow orchestration
- AI conversation memory and policy state

### Analytics
- reporting cubes
- cached metrics
- operational summaries

### Forecasting
- forecasts
- planning assumptions
- scenario models

All future modules must follow the same governance rule: services own the logic and the database access path.

---

## 10. Architecture Rules

These rules are permanent.

- No component talks directly to Supabase for domain writes.
- Repositories never contain business logic.
- Business services own all rules.
- UI only requests actions.
- AI never bypasses business services.
- Database constraints are the final protection.
- Ownership must remain centralized.
- Domain logic must not be duplicated across UI, API, and service layers.

---

## 11. Summary

TradeOS must govern its database like a controlled business platform.

The core philosophy is simple:
- services own the rules
- repositories execute persistence
- UI requests actions
- the database enforces the final boundaries
- tenant isolation and auditability are non-negotiable

This document is the permanent governance standard for table ownership, service ownership, access control, and future module expansion.
