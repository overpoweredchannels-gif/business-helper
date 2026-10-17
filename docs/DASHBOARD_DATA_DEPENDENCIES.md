# Dashboard read dependencies

The owner dashboard derives its visible figures from the same organization-scoped loaders used by the rest of the application. A metric is available only after every listed read has succeeded. An empty result is valid data and can yield zero; an unread or failed dependency cannot.

| Dashboard output | Required reads | Calculation source |
| --- | --- | --- |
| Today's sales | `sales_transactions`, `sales_items` | Transactions select the rows for today; their items supply quantity, price and line discount. |
| Today's estimated profit | `sales_transactions`, `sales_items`, `products` | Today's line revenue less cost from the product cost / sale cost snapshot calculation. |
| Inventory value and low stock | `products` | Stored `current_stock`, cost (falling back to selling price), and reorder level. |
| Receivables | `customers`, `sales_transactions`, `sales_items`, `customer_payments`, `customer_payment_allocations` | Credit invoices are totaled from line data and reduced by explicit and legacy payment allocations, grouped by customer. |
| Payables | `suppliers`, `purchase_transactions`, `purchase_items`, `supplier_payments`, `supplier_payment_allocations` | Purchase line totals are reduced by explicit and legacy supplier payment allocations, grouped by supplier. |
| Business Health score | `sales_transactions`, `sales_items`, `products`, `customer_payments`, `expenses` | The score uses total sales, estimated net profit, stock counts, and customer collections. Estimated net profit subtracts known cost of goods and selected-period expenses. |
| Business Health — Cash Flow | All Receivables and Payables reads above | Displays total receivables less total payables. |
| Business Health — Inventory Health and Stock Health | `products` | Displays low-stock and out-of-stock counts from current stock and reorder levels. |
| Business Health — Profit Margin | `sales_transactions`, `sales_items`, `products`, `expenses` | Displays estimated net profit divided by selected-period line revenue; expenses reduce estimated net profit. |
| Pending approvals | `sales_orders` | Count of sales orders in `pending_approval`. |
| Collection tasks, customer follow-ups and expiring stock checks | `tasks` | Pending task types and stock-check titles. |
| Unpaid purchases | `suppliers`, `purchase_transactions`, `purchase_items`, `supplier_payments`, `supplier_payment_allocations` | Count of purchase transactions with an outstanding allocated payable. |
| Urgent reorders | `products` | Current product stock and reorder levels. |

The Business Health card is withheld as a whole whenever any input for the score or any displayed submetric is unread, loading or failed. Its complete source set is sales transactions and items, products, customer payments, expenses, customers and payment allocations, suppliers, purchase transactions and items, and supplier payments and allocations. Empty expenses are a successful zero input; a failed or pending expense read cannot be treated as zero.

The Business Overview module counts use these sources: Products → `products`; Customers → `customers`; Suppliers → `suppliers`; Sales → `sales_transactions`; Purchases → `purchase_transactions`. User-added section summary cards use the same source states for their counts and previews. Unloaded and failed sources display their state instead of a confirmed zero; failed reads with prior success show the last successful update time.

## Read-state behavior

Each source, including expenses, distinguishes not loaded, loading, successful empty, successful populated and failed. Metric state is derived from all required source states; a failure makes the affected metric unavailable, while unrelated completed metrics remain visible. A successful empty source is not an error.

On refresh, the application retains the previous arrays so other screens are not cleared by a transient read error. Dashboard cards hide those old values while a read is loading or failed. If every dependency has a prior successful timestamp, an unavailable card displays a conservative last-update time: the oldest dependency timestamp. Retry re-runs failed source loaders.

Every tracked read carries both the authenticated account ID and organization ID, plus a per-source request ID. A response commits only while that account/organization scope is active and the read is still the newest request for its source. Loading a new profile invalidates the previous scope and clears the dashboard source arrays, including expenses, before starting organization reads. Expense retry runs the same organization-scoped Supabase loader used for the initial read.

## Verification boundary

The automated state tests exercise the production tracker, expense-loader adapter, and shared dashboard components with a synthetic Supabase client. Browser checks use the same tracker and components in an isolated local fixture. They do not establish authenticated integration behavior or exercise a live application session; that still requires an explicitly isolated Supabase/Postgres environment.
