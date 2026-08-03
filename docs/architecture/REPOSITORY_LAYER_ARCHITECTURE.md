# TradeOS Repository Layer Architecture

## 1. Repository Philosophy

The Repository Layer is the persistence boundary of TradeOS.

Its purpose is to separate storage concerns from business behavior.

### Repository Pattern
The repository pattern provides a consistent abstraction over data access. It allows the application to work with domain concepts while keeping persistence details isolated.

### Separation of persistence from business logic
Repositories are responsible for reading and writing data. They are not responsible for deciding whether a business operation is valid, whether an action should be allowed, or whether an outcome should be accepted.

### Why repositories must stay thin
Thin repositories keep the system easier to reason about. A repository should perform persistence operations and map data between the database and the application model. It should not grow into a place where business policy accumulates.

---

## 2. Repository Responsibilities

Repositories may:
- read data
- insert data
- update data
- delete data
- execute transactions delegated by services
- perform pagination
- apply filtering
- map database models

Repositories must not:
- validate business rules
- check permissions
- calculate prices
- calculate stock
- calculate profit
- send notifications
- trigger workflows

A repository is an execution tool for persistence. It is not the authority for business behavior.

---

## 3. Repository List

### OrganizationRepository
Purpose:
- persist organization records

Owned tables:
- organizations

Typical operations:
- get by id
- update settings
- list organizations by scope

Called by:
- OrganizationService

Examples:
- findById
- updateProfile
- listByTenantScope

### ProfileRepository
Purpose:
- persist user and profile records

Owned tables:
- profiles

Typical operations:
- get profile by id
- list profiles by organization
- update profile state

Called by:
- UserService
- PermissionService
- StaffService

Examples:
- findById
- findByOrganization
- updateStatus

### PermissionRepository
Purpose:
- persist permission and access assignment data

Owned tables:
- permissions
- profile_permissions
- staff_permissions

Typical operations:
- load permissions by profile
- assign permissions
- update permission records

Called by:
- PermissionService
- StaffService

Examples:
- listByProfile
- upsertAssignments
- removeAssignments

### BrandRepository
Purpose:
- persist brand catalog data

Owned tables:
- brands

Typical operations:
- list brands by organization
- create brand
- update brand

Called by:
- BrandService
- InventoryService

Examples:
- findByOrganization
- createBrand
- updateBrand

### CategoryRepository
Purpose:
- persist category tree data

Owned tables:
- categories

Typical operations:
- list categories by organization
- create category
- update category
- fetch hierarchy

Called by:
- CategoryService
- InventoryService

Examples:
- findByOrganization
- findTree
- updateCategory

### ProductRepository
Purpose:
- persist product catalog data

Owned tables:
- products

Typical operations:
- find products by organization
- create or update products
- query by SKU or barcode

Called by:
- ProductService
- InventoryService
- PurchaseService
- SalesService

Examples:
- findByOrganization
- findBySku
- upsertProduct

### SupplierRepository
Purpose:
- persist supplier master data

Owned tables:
- suppliers

Typical operations:
- find suppliers by organization
- create or update suppliers
- search suppliers

Called by:
- SupplierService
- PurchaseService
- FinanceService

Examples:
- findByOrganization
- findByName
- saveSupplier

### CustomerRepository
Purpose:
- persist customer master data

Owned tables:
- customers

Typical operations:
- find customers by organization
- create or update customer records
- search by name or phone

Called by:
- CustomerService
- SalesService
- FinanceService

Examples:
- findByOrganization
- saveCustomer
- searchCustomers

### PurchaseRepository
Purpose:
- persist purchase document and line-item data

Owned tables:
- purchase_transactions
- purchase_items
- purchase_orders
- purchase_order_items
- purchase_returns
- purchase_return_items

Typical operations:
- create purchase headers
- create purchase lines
- list purchases by organization
- update purchase status

Called by:
- PurchaseService

Examples:
- createPurchaseTransaction
- createPurchaseItems
- listByOrganization

### SalesRepository
Purpose:
- persist sales document and line-item data

Owned tables:
- sales_transactions
- sales_items

Typical operations:
- create sales headers
- create sales lines
- list sales by organization
- update sales state

Called by:
- SalesService

Examples:
- createSalesTransaction
- createSalesItems
- listByOrganization

### ExpenseRepository
Purpose:
- persist expense records

Owned tables:
- expenses

Typical operations:
- create expense
- list expenses by organization
- update expense state

Called by:
- ExpenseService
- FinanceService

Examples:
- createExpense
- listByOrganization
- updateExpense

### PaymentRepository
Purpose:
- persist payment records and allocations

Owned tables:
- customer_payments
- supplier_payments
- customer_payment_allocations
- supplier_payment_allocations

Typical operations:
- create payments
- create allocations
- list payments by organization
- update payment state

Called by:
- PaymentService
- FinanceService

Examples:
- createCustomerPayment
- createSupplierPayment
- createAllocation

### InvoiceRepository
Purpose:
- persist invoice-related metadata and counters

Owned tables:
- invoice_sequences

Typical operations:
- fetch current sequence values
- update counters
- create invoice references

Called by:
- InvoiceService
- FinanceService

Examples:
- getSequence
- updateSequence

### TaskRepository
Purpose:
- persist task records

Owned tables:
- tasks

Typical operations:
- create task
- update task
- list tasks by organization

Called by:
- TaskService

Examples:
- createTask
- updateTask
- listOpenTasks

### AuditRepository
Purpose:
- persist audit records

Owned tables:
- audit_logs

Typical operations:
- append audit entry
- list audit entries by entity
- query audit history by organization

Called by:
- AuditService

Examples:
- appendEvent
- listByEntity
- listByOrganization

### StaffRepository
Purpose:
- persist staff-related records and staff permission state

Owned tables:
- staff_permissions
- staff_duty_sessions

Typical operations:
- create or update duty sessions
- update staff permission state
- list staff state by organization

Called by:
- StaffService

Examples:
- upsertStaffPermission
- createDutySession
- listDutySessions

### StaffLocationRepository
Purpose:
- persist staff location checkpoint data

Owned tables:
- staff_location_points

Typical operations:
- insert location points
- list location points by organization
- query recent checkpoints

Called by:
- StaffLocationService

Examples:
- insertLocationPoint
- listByProfile
- listByOrganization

### AIRepository
Purpose:
- persist AI workflow data

Owned tables:
- ai_action_drafts
- ai_action_messages
- ai_alerts
- ai_daily_briefings
- ai_business_query_logs
- ai_voice_operator_sessions
- ai_voice_operator_messages

Typical operations:
- create and update drafts
- insert messages and transcripts
- list AI workflow records

Called by:
- AIActionService
- AIVoiceService
- AIAlertService
- AIBriefingService

Examples:
- saveDraft
- appendMessage
- saveAlert
- saveBriefing

### MarketRepository
Purpose:
- persist market intelligence and analysis data

Owned tables:
- market_news_sources
- market_import_queue
- market_intelligence_items
- market_ai_analyses

Typical operations:
- create market items
- update review state
- list market intelligence records

Called by:
- MarketNewsService
- MarketAnalysisService

Examples:
- saveNewsSource
- saveQueueItem
- saveIntelligenceItem

### SecurityRepository
Purpose:
- persist security workflow data

Owned tables:
- security_checks

Typical operations:
- upsert security check state
- list checks by organization
- save check updates

Called by:
- SecurityService

Examples:
- upsertCheck
- listChecks
- updateCheck

---

## 4. Allowed Call Graph

The repository layer must sit below the business layer in the call graph.

UI
↓
API
↓
Business Service
↓
Repository
↓
Supabase Client
↓
Database

Repositories never call:
- UI
- API
- Business Services
- Other repositories

Repositories are leaf-level persistence components. They do not orchestrate the domain.

---

## 5. Repository Standards

### One repository per aggregate/domain
Each repository should focus on one domain or aggregate, not every table in the system.

### Small focused methods
Methods should be narrow and predictable, such as create, update, findById, findByOrganization, and listByFilter.

### No giant generic repository
The system should avoid a monolithic repository that tries to serve every purpose. A generic base layer can exist only as a thin utility, not as a substitute for domain-specific clarity.

### Return typed models
Repositories should return structured models or DTOs that fit the service layer and avoid leaking raw database concerns too far upward.

### No side effects
Repositories should not perform side effects such as sending notifications, starting workflows, or modifying unrelated domain state.

---

## 6. Query Standards

Repositories should follow consistent query conventions.

### Filtering
- filters should be explicit
- tenant filters should be applied consistently
- query parameters should be passed in a structured way

### Pagination
- pagination should be supported for list operations
- page size and offset or cursor strategies should be explicit

### Ordering
- repositories should support deterministic ordering
- ordering should be based on domain defaults where practical

### Bulk operations
- bulk inserts or bulk updates may be used when appropriate
- they should still be explicit and safe

### Soft delete policy
If a soft delete policy is introduced later, it should be documented and enforced consistently.

### Transaction support
Repositories may participate in transactions delegated by services, but they should not define transaction boundaries independently.

---

## 7. Error Handling

Repositories only return persistence errors.

Examples:
- connection errors
- constraint violations
- invalid UUID format
- query failures

Business services decide how to interpret or transform those persistence errors into domain-level behavior.

---

## 8. Multi-Tenant Rules

Every repository query must include organization_id where applicable.

Repositories must never allow cross-tenant access.

The repository layer must not bypass tenant context. It should always operate within the scope provided by the calling service.

---

## 9. Testing Strategy

### Repository unit tests
Repository unit tests should verify method behavior in isolation, including filtering, mapping, and error propagation.

### Repository integration tests
Repository integration tests should validate behavior against a test or sandbox Supabase environment where possible.

### Mocking strategy
Mocks should be used only to isolate the repository from the broader application. The repository should be tested against realistic persistence behavior where practical.

### Supabase testing
When testing against Supabase, the tests should cover:
- tenant-scoped queries
- insert and update operations
- error conditions
- pagination behavior

---

## 10. Future Repositories

The following future repositories should follow the same pattern.

### CRM
- CRMRepository
- ContactRepository
- OpportunityRepository

### Warehouse
- WarehouseRepository
- ReceivingRepository
- DispatchRepository

### Accounting
- AccountingRepository
- JournalRepository
- LedgerRepository

### Payroll
- PayrollRepository
- PayslipRepository

### HR
- HRRepository
- EmployeeRepository

### Forecasting
- ForecastingRepository
- ScenarioRepository

### Workflow
- WorkflowRepository
- ApprovalRepository

### Notification
- NotificationRepository
- DeliveryRepository

### Voice Runtime
- VoiceRuntimeRepository
- SessionRepository

### MCP
- MCPRepository
- ToolRegistryRepository

---

## 11. Summary

The Repository Layer is the persistence boundary of TradeOS.

Its role is to keep storage concerns separate from business logic. Repositories perform data access, filtering, mapping, and persistence operations while leaving business decisions to services.

This layer keeps the architecture disciplined by ensuring that:
- business rules remain centralized
- persistence remains thin and predictable
- multi-tenant behavior stays enforceable
- the system remains easier to test and evolve
