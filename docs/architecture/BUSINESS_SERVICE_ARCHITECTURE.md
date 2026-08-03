# TradeOS Business Service Architecture

## 1. Business Layer Philosophy

TradeOS is designed around a domain-driven business layer where business rules live in approved services rather than in UI components, ad hoc helpers, or persistence code.

### Domain-driven architecture
TradeOS treats the business domain as a first-class architectural concern. The core domain includes inventory, purchasing, sales, finance, identity, staff operations, AI workflows, and market intelligence.

### Separation of concerns
The architecture separates:
- UI concerns: interaction and presentation
- API concerns: request handling and orchestration
- Business Service concerns: rules, workflows, validation, and coordination
- Repository concerns: persistence execution
- Database concerns: integrity enforcement and storage

### Why business rules belong only inside services
Business rules must be centralized because they define how the company operates. Rules such as stock policy, invoice numbering, payment allocation, tenant access, AI workflow state, and compliance behavior are not UI concerns. They are domain concerns and must be owned by services.

### Why repositories never contain business logic
Repositories exist to persist and retrieve data. They should not decide whether an action is valid, whether a payment is allowed, whether stock can be oversold, or whether an AI workflow is permitted. Those decisions belong to business services.

---

## 2. Service Responsibilities

The following services define the canonical business layer for TradeOS.

### OrganizationService
Purpose:
- manage organization-level configuration and lifecycle

Responsibilities:
- own tenant-level settings
- enforce organization-scoped rules
- manage organization-specific defaults

Owned tables:
- organizations

Depends on:
- Repository layer
- AuditService

Produces:
- organization state and policy information

Consumes:
- organization preferences and settings

Future extensions:
- multi-branch organization models
- regional policy management

### UserService
Purpose:
- manage user-facing identity and account behavior

Responsibilities:
- manage profile lifecycle
- coordinate profile activation and deactivation
- support account-related workflows

Owned tables:
- profiles

Depends on:
- PermissionService
- AuditService

Produces:
- user state and profile context

Consumes:
- authentication context and role metadata

Future extensions:
- user preferences
- approval workflows
- delegated administration

### PermissionService
Purpose:
- own authorization and access policy behavior

Responsibilities:
- evaluate access rights
- manage permission assignments
- enforce role expectations

Owned tables:
- permissions
- profile_permissions
- staff_permissions

Depends on:
- UserService
- AuditService

Produces:
- authorization decisions

Consumes:
- user identity and role context

Future extensions:
- dynamic permission policies
- feature flags
- policy inheritance models

### InventoryService
Purpose:
- own inventory business rules and stock movement workflows

Responsibilities:
- manage product stock state
- enforce stock policies
- coordinate inventory adjustments and stock movements

Owned tables:
- brands
- categories
- products
- inventory_transactions

Depends on:
- ProductService concepts
- PurchaseService
- SalesService
- FinanceService
- AuditService

Produces:
- stock state and inventory events

Consumes:
- purchase intake, sales outcomes, adjustments, and return events

Future extensions:
- batch tracking
- expiry management
- FIFO costing
- warehouse movement workflows

### BrandService
Purpose:
- manage brand domain rules and catalog behavior

Responsibilities:
- validate brand lifecycle
- coordinate catalog references

Owned tables:
- brands

Depends on:
- InventoryService
- AuditService

Produces:
- brand catalog state

Consumes:
- product and catalog context

Future extensions:
- brand-level pricing policy
- brand analytics

### CategoryService
Purpose:
- manage product taxonomy rules

Responsibilities:
- maintain category hierarchy
- validate category relationships
- coordinate category-based policies

Owned tables:
- categories

Depends on:
- InventoryService
- AuditService

Produces:
- category hierarchy state

Consumes:
- product catalog and inventory context

Future extensions:
- category inheritance rules
- merchandising rules

### SupplierService
Purpose:
- own supplier master-data and supplier workflows

Responsibilities:
- manage supplier lifecycle
- validate supplier information
- coordinate supplier-related purchase behavior

Owned tables:
- suppliers

Depends on:
- PurchaseService
- FinanceService
- AuditService

Produces:
- supplier state and supplier-related workflow context

Consumes:
- purchase and payment context

Future extensions:
- supplier scorecards
- onboarding workflows

### CustomerService
Purpose:
- own customer master data and customer policy behavior

Responsibilities:
- manage customer lifecycle
- coordinate credit and relationship rules
- support customer-facing reporting context

Owned tables:
- customers

Depends on:
- SalesService
- FinanceService
- AuditService

Produces:
- customer state and customer policy context

Consumes:
- sales and payment context

Future extensions:
- CRM lifecycle
- credit review workflows

### PurchaseService
Purpose:
- own procurement business rules and purchase workflows

Responsibilities:
- manage purchase document lifecycle
- validate purchase data
- coordinate procurement-related stock and payable effects

Owned tables:
- purchase_transactions
- purchase_items
- purchase_orders
- purchase_order_items
- purchase_returns
- purchase_return_items

Depends on:
- InventoryService
- FinanceService
- SupplierService
- AuditService

Produces:
- purchase documents and procurement state

Consumes:
- supplier data, product data, stock context, and payment context

Future extensions:
- purchase approvals
- receiving workflows
- electronic supplier documents

### SalesService
Purpose:
- own sales business rules and sales document workflows

Responsibilities:
- manage sales document lifecycle
- validate sales data
- coordinate stock effects and receivable state

Owned tables:
- sales_transactions
- sales_items

Depends on:
- InventoryService
- FinanceService
- CustomerService
- AuditService

Produces:
- sales documents and sales state

Consumes:
- customer data, product data, stock context, and payment context

Future extensions:
- POS integration
- credit approval automation
- delivery workflow coordination

### FinanceService
Purpose:
- own financial business rules and account-related workflows

Responsibilities:
- coordinate expenses and payments
- manage invoice numbering and finance lifecycle
- orchestrate payment allocation behavior

Owned tables:
- expenses
- invoice_sequences
- customer_payments
- supplier_payments
- customer_payment_allocations
- supplier_payment_allocations

Depends on:
- PurchaseService
- SalesService
- AuditService

Produces:
- payment state, expense state, and finance outcomes

Consumes:
- purchase and sales records, invoice context, and customer/supplier state

Future extensions:
- accounting journal integration
- general ledger support
- approval workflows

### PaymentService
Purpose:
- own payment-specific rules and allocation behavior

Responsibilities:
- validate payment amounts
- coordinate invoice allocation rules
- manage payment exceptions

Owned tables:
- customer_payments
- supplier_payments
- customer_payment_allocations
- supplier_payment_allocations

Depends on:
- FinanceService
- SalesService
- PurchaseService
- AuditService

Produces:
- payment allocation and settlement state

Consumes:
- invoices and financial context

Future extensions:
- bank reconciliation
- payment gateway integration

### InvoiceService
Purpose:
- own invoice document rules and numbering behavior

Responsibilities:
- generate invoice numbers
- coordinate invoice state and numbering integrity
- manage invoice lifecycle semantics

Owned tables:
- invoice_sequences

Depends on:
- PurchaseService
- SalesService
- FinanceService
- AuditService

Produces:
- invoice identifiers and invoice lifecycle state

Consumes:
- transaction context and document generation requests

Future extensions:
- invoice approval and posting
- document templates

### ExpenseService
Purpose:
- own expense capture and validation rules

Responsibilities:
- validate expense entries
- coordinate expense lifecycle and reporting context

Owned tables:
- expenses

Depends on:
- FinanceService
- AuditService

Produces:
- expense state

Consumes:
- supplier and customer context

Future extensions:
- approval routing
- reimbursement workflows

### TaskService
Purpose:
- own operational task business rules

Responsibilities:
- manage task state and task lifecycle
- track action ownership and follow-up

Owned tables:
- tasks

Depends on:
- AuditService

Produces:
- task state and assignment context

Consumes:
- operational context from business workflows

Future extensions:
- task automation
- assignment routing

### AuditService
Purpose:
- own audit and compliance event rules

Responsibilities:
- record business changes
- preserve audit history
- provide consistent audit metadata

Owned tables:
- audit_logs

Depends on:
- OrganizationService
- UserService

Produces:
- immutable event history

Consumes:
- mutation events from other services

Future extensions:
- event streaming
- compliance dashboards

### SecurityService
Purpose:
- own security and compliance workflow behavior

Responsibilities:
- manage security checklist state
- coordinate security workflow actions
- support compliance posture updates

Owned tables:
- security_checks

Depends on:
- AuditService
- PermissionService

Produces:
- security posture state

Consumes:
- security checklist and identity context

Future extensions:
- policy enforcement automation
- secure posture alerts

### StaffService
Purpose:
- own staff and duty management behavior

Responsibilities:
- manage staff profile actions
- coordinate staff permissions and duty state
- enforce staff workflow rules

Owned tables:
- staff_permissions
- staff_duty_sessions

Depends on:
- UserService
- PermissionService
- AuditService

Produces:
- staff state and staff workflow context

Consumes:
- staff identity and organization context

Future extensions:
- shift planning
- staffing analytics

### StaffLocationService
Purpose:
- own staff location monitoring behavior

Responsibilities:
- manage location checkpoint state
- support attendance and tracking workflows

Owned tables:
- staff_location_points

Depends on:
- StaffService
- AuditService

Produces:
- location tracking state

Consumes:
- staff identity and location events

Future extensions:
- geofencing
- rule-based location alerts

### AIActionService
Purpose:
- own AI action workflow business rules

Responsibilities:
- manage action draft state
- guide AI-assisted business actions
- validate drafts before execution

Owned tables:
- ai_action_drafts
- ai_action_messages

Depends on:
- AuditService
- PurchaseService
- SalesService
- FinanceService

Produces:
- AI action workflow state

Consumes:
- user prompts and business context

Future extensions:
- workflow execution automation
- action approval routing

### AIVoiceService
Purpose:
- own Voice AI conversation and session rules

Responsibilities:
- manage voice session lifecycle
- preserve conversation state
- route voice intents to approved services

Owned tables:
- ai_voice_operator_sessions
- ai_voice_operator_messages

Depends on:
- AIActionService
- AIBriefingService
- MarketAnalysisService
- AuditService

Produces:
- voice session and transcript state

Consumes:
- voice prompts and business context

Future extensions:
- voice runtime integration
- multi-language policy handling

### AIAlertService
Purpose:
- own AI alert generation and lifecycle rules

Responsibilities:
- manage alert state transitions
- coordinate alert severity and actionability

Owned tables:
- ai_alerts

Depends on:
- AuditService
- AnalyticsService

Produces:
- active alert state

Consumes:
- business signals and workflow context

Future extensions:
- alert escalation routing
- alert subscriptions

### AIBriefingService
Purpose:
- own daily briefing generation rules

Responsibilities:
- assemble business summary data
- orchestrate briefing generation and persistence
- manage briefing state

Owned tables:
- ai_daily_briefings

Depends on:
- AIAlertService
- AnalyticsService
- AuditService

Produces:
- daily briefing state

Consumes:
- business metrics, alerts, and recommendation context

Future extensions:
- executive summaries
- multilingual briefing variants

### MarketNewsService
Purpose:
- own market news ingestion and review rules

Responsibilities:
- manage news source lifecycle
- validate incoming news inputs
- coordinate review status

Owned tables:
- market_news_sources
- market_import_queue

Depends on:
- AuditService

Produces:
- queued market intelligence items

Consumes:
- external source inputs and review context

Future extensions:
- source-specific normalization
- ingestion automation

### MarketAnalysisService
Purpose:
- own market analysis workflow behavior

Responsibilities:
- generate and manage analysis records
- coordinate review and conversion into intelligence items

Owned tables:
- market_ai_analyses
- market_intelligence_items

Depends on:
- MarketNewsService
- AuditService

Produces:
- intelligence and analysis state

Consumes:
- market input and business context

Future extensions:
- forecasting signals
- scenario-driven analysis

### AnalyticsService
Purpose:
- own reporting and analytical business rules

Responsibilities:
- prepare business metrics
- coordinate derived reporting behavior
- support AI and dashboard intelligence

Owned tables:
- derived reporting and analytical aggregates where applicable

Depends on:
- InventoryService
- PurchaseService
- SalesService
- FinanceService
- AuditService

Produces:
- analytical summaries and reporting context

Consumes:
- transactional and business data

Future extensions:
- KPI dashboards
- forecasting models
- executive analytics

### NotificationService
Purpose:
- own notification and communication rules

Responsibilities:
- coordinate notifications for business events
- apply notification policy and audience rules
- support operational communication

Owned tables:
- future notification state tables

Depends on:
- AuditService
- AIAlertService
- FinanceService

Produces:
- notification workflow state

Consumes:
- business events and workflow events

Future extensions:
- email and SMS integration
- escalation workflows

---

## 3. Service Communication Rules

Services may call other services when doing so preserves domain ownership and responsibility.

### Allowed patterns
- UI calls API
- API calls Business Service
- Business Service calls other Business Services
- Business Service calls Repository
- Repository executes persistence

### Forbidden patterns
- Repositories never call services
- Repositories never call repositories
- UI never calls repositories directly
- AI never bypasses Business Services

### AI rule
Any AI-driven action must pass through a business service so that validation, authorization, and audit behavior remain centralized.

---

## 4. Service Dependencies

The direction of dependencies must remain consistent.

UI
↓
API
↓
Business Service
↓
Repository
↓
Supabase
↓
Database

No reverse dependencies are allowed for business logic.

In other words:
- UI must not reach into repositories
- services must not depend on UI behavior
- repositories must not own business rules
- the database must not dictate the application workflow

---

## 5. Transaction Ownership

Transactions are owned by business services because only services understand the business boundary of a workflow.

### Transaction rules
- the service that begins a workflow owns the transaction boundary
- the same service commits or rolls back the workflow transaction
- nested services may participate, but they must not independently redefine the business transaction boundary
- write operations that belong to the same business action should be coordinated inside one service transaction when applicable

### Typical ownership model
- PurchaseService owns purchase transaction boundaries
- SalesService owns sales transaction boundaries
- FinanceService owns payment and expense transaction boundaries
- InventoryService owns stock movement transaction boundaries
- AI services own AI workflow state boundaries

---

## 6. Validation Rules

Validation must happen in layers.

### UI validation
UI validation should catch obvious issues such as missing fields or malformed input.

### API validation
API validation should confirm the request shape, authentication, and tenant context.

### Business validation
Business validation belongs inside services. This is where rules such as invoice numbering, payment allocation, stock policy, staff permission checks, and workflow eligibility are enforced.

### Database constraints
Database constraints are the final protection. They enforce referential integrity, not business policy. Business logic still belongs in services.

---

## 7. Cross-Service Events

The architecture reserves future event contracts for cross-service communication.

Examples:
- InventoryUpdated
- SaleCompleted
- PurchaseCompleted
- PaymentReceived
- CustomerCreated
- SupplierCreated
- AIRecommendationCreated
- AlertGenerated
- BriefingCreated
- MarketInsightReviewed

These events should be documented and used only when they preserve clear ownership and decoupling.

---

## 8. Future Modules

The following future modules should reserve service ownership patterns that mirror the same architecture.

### CRM
- CustomerRelationshipService
- OpportunityService
- ContactService

### Accounting
- GeneralLedgerService
- JournalService
- ChartOfAccountsService

### Warehouse
- WarehouseService
- ReceivingService
- DispatchService

### POS
- PointOfSaleService
- CashDrawerService

### Payroll
- PayrollService
- PayslipService
- PayrollApprovalService

### HR
- HRService
- EmployeeService
- LeaveService

### Forecasting
- ForecastService
- ScenarioService

### Workflow Automation
- WorkflowEngineService
- ApprovalService

### Voice Runtime Integration
- VoiceRuntimeService
- IntentRoutingService

### MCP Integration
- MCPService
- ToolRegistryService

All future modules must follow the same rules: services own rules, repositories persist data, and UI never owns core business logic.

---

## 9. Service Design Principles

The following principles define the long-term service design for TradeOS.

- Single responsibility
- Idempotent operations where possible
- No business rules in repositories
- No business rules in UI
- Services own workflows
- Services own validation
- Services own transactions
- Services remain the authoritative source for domain behavior
- Repositories remain implementation detail for persistence

---

## 10. Summary

The Business Service Layer is the center of the TradeOS architecture.

It is where business meaning lives. It is where validation, workflow orchestration, cross-table coordination, tenant rules, and domain governance are centralized.

The architecture ensures that:
- rules remain in one place
- persistence remains separate
- UI remains thin and user-focused
- AI actions are governed by the same business layer
- future modules can grow without breaking the platform model

This document defines the intended service architecture for TradeOS and serves as the permanent blueprint for business-layer design.
