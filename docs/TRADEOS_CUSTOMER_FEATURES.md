# TradeOS — customer feature summary

TradeOS brings product records, stock, purchases, sales, payments and team work into one business workspace. It is designed for traders, distributors, wholesalers and retailers who want fewer repeated entries and clearer daily records.

## A short customer pitch

“With TradeOS, you can record purchases, keep track of stock, create sales invoices and see what customers owe you and what you owe suppliers. Your cashier can scan saved product barcodes instead of searching every item. Your sales team can submit sales for your approval, while you control which tools each employee can access. You can reuse import and print templates, make bulk product updates, and export date-based business records. Built-in tutorials explain how to use the system.”

## Features and their daily benefit

| Feature | What it does | Why it helps |
|---|---|---|
| Business dashboard | Shows recorded sales, inventory indicators, outstanding amounts and recent activity, with links to the relevant work. | Start the day by checking the business and opening the next task. |
| Quick sale | A prominent dashboard button opens the sales invoice and barcode counter. The customer can optionally remain selected for consecutive counter sales. | Fewer navigation steps between customers. |
| Barcode product registration | A keyboard-mode scanner enters the barcode into the product form; the user completes the name, category, units and prices, then saves. | Connect a physical item to its saved product record. |
| Barcode sales entry | Matches a barcode to an active saved product and fills a product line with a suggested price. Repeated scans increase quantity for the same product/unit. | Reduce repeated product searches and typing. |
| Main units and sub-units | Supports a configured main unit and a smaller unit with a conversion, such as one box containing twelve pieces. | Sell whole packs or individual pieces while keeping unit meaning explicit. |
| Products, brands and categories | Organizes products with identifiers, prices, groups and stock settings. | Find products and organize reports more easily. |
| Inventory | Tracks quantities and supported stock movements, with stock/reorder and batch/expiry settings. | Review availability and identify items needing attention. |
| Sales invoices | Records customers, dates, product lines, units, quantities, prices, discounts and supported bonus/tax fields. | Keep an organized record of sales instead of repeating calculations manually. |
| Sales orders, approval and returns | Separates orders/drafts from approved sales and provides a return workflow for eligible items. | Owners retain control over employee submissions and corrections. |
| Purchase invoices | Records goods bought, quantities, costs and supported batch/expiry details, with the related stock and supplier effects. | Keep purchasing and incoming stock connected. |
| Customers and credit | Stores customer details, credit settings and optional staff/territory assignments. | Review who owes money and organize customer work. |
| Suppliers and ledger | Stores supplier details and shows related purchases, payments and outstanding amounts. | Review what needs to be paid and to whom. |
| Customer and supplier payments | Records payment dates, methods, references and supported invoice allocations. | Reconcile collections and payments against business records. |
| Expenses and financial reports | Records expenses and provides available profit/loss and business summaries with filters. | Review recorded income and costs using the correct date range. |
| Import/export with saved mappings | Maps supported external spreadsheet columns, previews problems and reuses saved entity-specific mappings. | Reduce repeated setup when importing another file of the same format. |
| Bulk setup editing | Reviews unset product/customer settings and applies one setting to selected records across pages. | Update many reorder levels, assignments or other supported settings together. |
| Invoice and load-form printing | Generates printable invoices and warehouse picking summaries using saved layouts. | Prepare documents and goods from the same sales records. |
| Reference-template assistance | Detects supported spreadsheet table columns directly; configured AI can propose PDF/image layout settings. Preview, confirmation and saving remain explicit. | Use an existing document as a starting point for a reusable layout. |
| Date-range PDF report | Opens a printable report of supported invoices and lines, payments, expenses, stock movements, new products/customers and recorded activity. | Keep a daily or multi-day business record through Save as PDF. |
| Staff permissions | Owners select allowed sections and sales sub-options. Employees retain their permitted views and own performance information. | Keep employee screens focused on their duties. |
| Field-team tools | Includes employee profiles, territories/routes, visits, duty/attendance and related collection/location workflows. | Organize field work and review available activity. |
| Tasks and notifications | Provides task and alert workflows for follow-up. | Keep pending work visible. |
| Tutorial and contextual help | A first-visit guide, searchable topics and question-mark help beside visible controls. Users can reopen the tutorial or hide the icons. | Help new users learn the app and understand units before entering records. |
| AI assistance | Provides configured query, analysis and selected draft/action workflows. | Assist with supported tasks while users check the underlying records and confirm actions. |
| Mobile-friendly web interface | Adapts the web workspace to smaller screens; a separate mobile codebase also exists. | Access supported workflows away from a desktop. |

## Demonstration: a retail counter sale

1. Add a product with barcode `001234`, main unit Box, sub-unit Piece, 12 pieces per box, and a main-unit selling price of 120.
2. Create/select a customer record appropriate to the sale, such as a walk-in customer created by the business.
3. Open **Create a sale / Scan products** and choose sub-unit scanning.
4. Scan the saved barcode. Check that the line shows one piece at the suggested price of 10. Scan again to make the quantity two.
5. Adjust quantity or price if necessary, review the invoice and click Save. An employee submission still goes for owner approval.
6. For repeated sales to the same counter customer, deliberately enable the keep-customer option. Each saved invoice clears its product lines, discounts and tax entries for the next sale.

## Set expectations clearly when selling the product

- Barcode support is for scanners that type text like a keyboard, normally ending with Enter. Specialized serial/POS integrations and camera scanning are not included in this release. Test the shop's actual scanner.
- Barcode scanning selects saved information; it does not know the product name or price from an unknown barcode and does not automatically save or charge a customer.
- Historical imports require correct units, party references and duplicate handling. Old payments do not automatically reconstruct opening balances or invoice allocations.
- A reference template is an assisted reconstruction using supported fields, not a guarantee of an exact copy of every font, position or custom column.
- AI features require valid provider configuration and availability. Do not promise every business operation can already be performed autonomously by AI.
- Location, mobile installation/background operation, offline behavior and push notifications must be demonstrated for the intended device and deployment. Do not pitch a fully offline POS or a published native app as verified.
- Reports describe supported recorded data; a PDF report is not a complete database backup or a record of every click.
- This summary describes the implemented product scope. Confirm the target customer's required workflows and production configuration in an acceptance test before making commitments.
