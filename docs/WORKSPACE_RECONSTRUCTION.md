# Workspace reconstruction

The owner workspace must help an owner start a sale, see today's figures, find a
record, and navigate daily tasks without reading a long stack of forms or history.
The warm paper, espresso and terracotta palette remains the shared visual identity.

## App shell

- The main header owns the Aankh mark and organization identity. Desktop search
  occupies the middle column; account, notifications and regional controls sit at
  the end. On smaller screens, search opens below the header and regional settings
  live in the account menu.
- Primary sidebar groups fit at the tested 1366×800 laptop viewport. Native task
  groups are exclusive while browsing, while search can expose all matches.
  Customization, display scale and help live in an expandable utility panel.
- The footer is a compact brand/contact row rather than a large closing section.

## Dashboard

Every visible card is part of one ordered grid, including quick sale, export and
setup. Edit home exposes keyboard/touch up/down controls. Order is saved per profile
under `aankh_dashboard_order_<profile>`, independently of existing hide/show settings.
Hidden cards retain their position when visible neighbors move. Reset restores the
default ordering as well as restoring removed cards.

Daily metrics appear before quick sale/export, which appear before analytics.
Quick sale is also available in the dashboard header for permitted users. Financial
values are never invented or animated through intermediate financial amounts:
their actual text gets a short reveal on update. Reduced motion disables it.
Business Overview uses compact tiles; recent activity shows the newest five rows
with a route to the full activity view.

## Sales and stock

`RecordHistoryPanel` keeps sales history closed during invoice creation. The ledger
tab opens it directly. Existing customer/invoice, product, and date filtering stays
with the owning page; the panel renders ten results at a time and resets pagination
when filters change. Invoice details expand per row, preserving credit, tax,
discount, due-date and allocation information and print actions.

The product catalog uses the same pagination. Product creation and detailed stock
insights expand on demand, so existing products are reachable without scrolling
through the complete editor and reorder analysis. The Add Product quick action
opens the editor directly. Editing an existing product opens it as well.

Sales, purchase and inventory tools share a responsive navigation strip. Import,
template and export actions share icon/label treatments. Scanner guidance folds
away while unit selection, scan submission and ready-to-scan actions remain visible.
Existing scan timing, duplicate suppression, permissions, calculations and saving
behavior stay in the original handlers.

## Verification

Browser coverage at 320, 390, 768, 1366 and 1920px checks page fit, primary navigation
fit, saved dashboard ordering, history disclosure, pagination and filter resets.
Pure order tests cover invalid storage, duplicates, hidden-card stability, account
isolation, and reset. Existing business and authorization tests remain required.
