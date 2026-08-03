# TradeOS Domain Model Architecture

## 1. Core Domains

TradeOS is organized around a set of core business domains that reflect the operational model of a modern trading business.

### Organization
The Organization domain represents the tenant or business account that owns the operating environment. It provides the top-level boundary for all business data and rules.

### Users
The Users domain represents people who operate the system, including owners, managers, staff, and other actors. This domain is responsible for identity, access, and account context.

### Inventory
The Inventory domain manages stock, movement, and product availability. It governs how inventory is represented and how changes flow through the business.

### Products
The Products domain represents the catalog of tradeable items. It includes product identity, pricing defaults, and catalog relationships.

### Brands
The Brands domain groups products into recognizable commercial identities for catalog organization and reporting.

### Categories
The Categories domain structures products into taxonomy groups for merchandising, filtering, and reporting.

### Suppliers
The Suppliers domain represents external vendors and purchasing relationships.

### Customers
The Customers domain represents buyers and trade relationships for receivables and sales workflows.

### Purchases
The Purchases domain captures procurement events, supplier invoices, purchase lines, receiving status, and payables effects.

### Sales
The Sales domain captures customer invoices, sales lines, payment outcomes, and receivables effects.

### Payments
The Payments domain models money in motion, including customer receipts and supplier disbursements.

### Expenses
The Expenses domain captures operating costs and non-inventory financial obligations.

### Tasks
The Tasks domain supports operational follow-up and business workflow tracking.

### Staff
The Staff domain covers workforce operations, staffing state, and operational responsibilities.

### Voice AI
The Voice AI domain represents conversational and voice-driven workflows that help users interact with TradeOS.

### AI Operations
The AI Operations domain covers AI-assisted actions, prompt history, alert generation, and business briefing workflows.

### Market Intelligence
The Market Intelligence domain captures market news, trend signals, AI analysis, and review workflows.

### Analytics
The Analytics domain provides business reporting, KPI aggregation, and intelligence summaries.

---

## 2. Aggregates

Aggregates are clusters of related entities that should be treated as a single consistency boundary.

### Inventory Aggregate
The Inventory Aggregate groups the core concepts needed to maintain stock health and stock movement.

Included concepts:
- Product
- Stock
- Batch
- Movement

Purpose:
- maintain the consistency of stock state
- ensure stock movements are recorded in a coherent way

### Sales Aggregate
The Sales Aggregate captures the business behavior of a sale.

Included concepts:
- Sale
- Sale Items
- Customer
- Payment

Purpose:
- maintain consistent sales records
- coordinate customer-facing transaction behavior

### Purchasing Aggregate
The Purchasing Aggregate captures the business behavior of procurement.

Included concepts:
- Purchase
- Purchase Items
- Supplier

Purpose:
- maintain consistent purchase records
- coordinate supplier workflows and receiving behavior

### Finance Aggregate
The Finance Aggregate captures payment and expense behavior.

Included concepts:
- Payment
- Expense
- Ledger (future)

Purpose:
- maintain consistent financial state and accounting boundaries

---

## 3. Entities

The following are the major entities in the TradeOS domain model.

### Product
A Product is the primary catalog entity. It represents an item that can be bought, sold, tracked, and reported on.

### Organization
An Organization is the tenant boundary for all business data and domain rules.

### Customer
A Customer is a party that buys goods and services and participates in sales and receivables workflows.

### Supplier
A Supplier is a party that provides goods and services and participates in purchasing and payables workflows.

### Purchase
A Purchase represents a procurement event or supplier invoice.

### Sale
A Sale represents a sales transaction or invoice to a customer.

### Payment
A Payment represents movement of money between the organization and another party.

### Expense
An Expense represents a cost incurred by the organization.

### Task
A Task captures work that needs follow-up, assignment, or completion.

### Employee or Staff Profile
A Staff Profile represents a human actor within the organization and is associated with access, duties, and operational activity.

### AI Action Draft
An AI Action Draft represents a structured action request collected from user or voice interaction.

### Market Intelligence Item
A Market Intelligence Item represents a reviewed market signal or insight that can affect the business.

---

## 4. Value Objects

Value objects are immutable concepts used to describe domain state.

### Money
Represents an amount of currency with behavior such as addition, comparison, and formatting.

### Quantity
Represents a measurable amount, often used for stock and transaction lines.

### Percentage
Represents a rate or ratio used in discounts, margins, or allocation logic.

### Address
Represents postal or physical address data that may be reused across multiple entities.

### Phone Number
Represents a normalized phone number or contact value.

### Email
Represents an email address as a typed value object.

### Business Hours
Represents the operational availability or scheduling context of a business or location.

### Barcode
Represents an external product identifier used in inventory and retail workflows.

### SKU
Represents the internal stock-keeping identifier for a product.

---

## 5. Domain Invariants

Domain invariants are the rules that protect the consistency of the domain model.

### Product invariants
- Product cannot exist without an Organization.
- Product names should be unique within a given organization when appropriate.

### Inventory invariants
- Stock cannot become negative unless explicitly allowed by policy.
- Inventory movements must be traceable to a valid source or reason.

### Sales invariants
- Sale must have at least one item.
- Sale totals must remain consistent with the sum of sale-line values.

### Purchase invariants
- Purchase must have at least one item.
- Purchase totals must remain consistent with purchase-line values.

### Payment invariants
- Customer payment cannot exceed outstanding balance unless an explicit policy allows it.
- Supplier payment cannot exceed payable balance unless policy allows it.

### Invoice invariants
- Invoice numbers must be unique within the relevant numbering context.

### Identity invariants
- A user profile must belong to an organization.
- Access decisions must be consistent with the organization context.

### AI invariants
- AI can only recommend actions and cannot execute restricted operations without authorization.
- AI actions must preserve auditability and organization context.

### Market invariants
- Market intelligence items must be reviewed or marked appropriately before acting on them as business signals.

---

## 6. Domain Events

Domain events describe meaningful changes in the business state.

### Reserved events
- ProductCreated
- ProductUpdated
- StockAdjusted
- PurchaseCompleted
- SaleCompleted
- PaymentReceived
- ExpenseRecorded
- CustomerCreated
- SupplierCreated
- AIRecommendationGenerated
- MarketAnalysisCompleted
- AlertGenerated
- BriefingCreated

These events should be treated as part of the domain contract and used to coordinate workflows and auditing.

---

## 7. Bounded Contexts

Bounded contexts define the conceptual boundaries within which a set of domain terms is internally consistent.

### Identity Context
Responsible for organization membership, users, profiles, roles, and access.

### Inventory Context
Responsible for products, stock, batches, movements, and catalog behavior.

### Purchasing Context
Responsible for suppliers, purchase documents, receiving state, and procurement workflows.

### Sales Context
Responsible for customers, sales documents, sales items, and receivables behavior.

### Finance Context
Responsible for payments, expenses, allocation behavior, and financial state.

### Workforce Context
Responsible for staff, duties, check-in, and operational workforce state.

### AI Context
Responsible for AI actions, voice interactions, alerts, briefings, and AI-generated recommendations.

### Market Intelligence Context
Responsible for news sources, queue review, intelligence items, and market analysis.

### Analytics Context
Responsible for reporting, summaries, and performance-oriented business insights.

### Interactions between contexts
- Sales and Inventory interact through stock movement and product availability.
- Purchasing and Inventory interact through receiving and inventory adjustments.
- Finance interacts with Sales and Purchasing through payment and allocation behavior.
- Identity interacts with all contexts by providing tenant and permission context.
- AI and Market Intelligence interact through recommendations, analysis, and alerting.

---

## 8. Future Domain Expansion

The domain model should reserve future bounded contexts for growth.

### CRM
- contacts
- opportunities
- relationship history

### Accounting
- ledger
- journal entries
- chart of accounts

### Payroll
- payroll transactions
- employee compensation
- approvals

### Warehouse
- locations
- transfer workflows
- handling units

### Manufacturing
- production orders
- work centers
- bill of materials

### Logistics
- dispatches
- deliveries
- route planning

### POS
- point-of-sale transactions
- cashier sessions
- tender handling

### Workflow Automation
- approvals
- state machines
- delegated processes

### Forecasting
- demand forecasting
- seasonal assumptions
- scenario planning

These future contexts should remain isolated and should follow the same domain boundaries as the core TradeOS model.

---

## 9. Summary

The TradeOS domain model is built around clear business domains and bounded contexts that reflect how a trading business actually operates.

Maintaining clear domain boundaries is important because it ensures:
- business rules stay centralized
- domain concepts remain coherent
- workflows remain understandable
- future growth can be introduced without collapsing the architecture

The domain model should remain the conceptual foundation for services, repositories, APIs, and the database ownership model.
