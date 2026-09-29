# Dashboard read dependencies

The owner dashboard derives its visible figures from the same organization-scoped loaders used by the rest of the application. A metric is available only after every listed read has succeeded. An empty result is valid data and can yield zero; an unread or failed dependency cannot.

| Dashboard output | Required reads | Calculation source |
| --- | --- | --- |
| Today's sales | `sales_transactions`, `sales_items` | Transactions select the rows for today; their items supply quantity, price and line discount. |
| Today's estimated profit | `sales_transactions`, `sales_items`, `products` | Today's line revenue less cost from the product cost / sale cost snapshot calculation. |
| Inventory value and low stock | `products` | Stored `current_stock`, cost (falling back to selling price), and reorder level. |
| Receivables | `customers`, `sales_transactions`, `sales_items`, `customer_payments`, `customer_payment_allocations` | Credit invoices are totaled from line data and reduced by explicit and legacy payment allocations, grouped by customer. |
| Payables | `suppliers`, `purchase_transactions`, `purchase_items`, `supplier_payments`, `supplier_payment_allocations` | Purchase line totals are reduced by explicit and legacy supplier payment allocations, grouped by supplier. |
| Pending approvals | `sales_orders` | Count of sales orders in `pending_approval`. |
| Collection tasks, customer follow-ups and expiring stock checks | `tasks` | Pending task types and stock-check titles. |
| Unpaid purchases | `suppliers`, `purchase_transactions`, `purchase_items`, `supplier_payments`, `supplier_payment_allocations` | Count of purchase transactions with an outstanding allocated payable. |
| Urgent reorders | `products` | Current product stock and reorder levels. |

The Business Health score summarizes the sales, estimated profit, inventory, receivables, payables and low-stock metrics above. It is withheld whenever any of those metric inputs is unread, loading or failed.

## Read-state behavior

Each source distinguishes not loaded, loading, successful empty, successful populated and failed. Metric state is derived from all required source states; a failure makes the affected metric unavailable, while unrelated completed metrics remain visible. A successful empty source is not an error.

On refresh, the application retains the previous arrays so other screens are not cleared by a transient read error. Dashboard cards hide those old values while a read is loading or failed. If every dependency has a prior successful timestamp, an unavailable card displays a conservative last-update time: the oldest dependency timestamp. Retry re-runs failed source loaders.

Every tracked read carries both the authenticated account ID and organization ID, plus a per-source request ID. A response commits only while that account/organization scope is active and the read is still the newest request for its source. Loading a new profile invalidates the previous scope and clears the dashboard source arrays before starting organization reads.

## Verification boundary

The automated state tests exercise the production tracker and `DashboardView` component with synthetic read results. Browser checks use the same tracker and component in an isolated local fixture. They do not query Supabase or establish authenticated integration behavior; that still requires an explicitly isolated Supabase/Postgres environment.
