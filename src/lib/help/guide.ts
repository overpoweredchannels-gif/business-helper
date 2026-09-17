export type GuideTopic = { title: string; description: string; steps: string[] };
export const guideTopics: GuideTopic[] = [
  { title: "Welcome to TradeOS", description: "Manage products, stock, purchases, sales, payments and your team in one workspace. Available screens depend on the owner's permissions.", steps: ["Start with business settings, brands and categories.", "Add products with the correct units, prices and opening stock.", "Add customers and suppliers, then record purchases and sales.", "Record payments and review your reports. Click any question-mark icon for help. This tutorial never changes your records."] },
  { title: "Products, brands and categories", description: "A product is an item you buy or sell. Brands and categories organize products and help you filter reports.", steps: ["Add a product name, brand/category, and optional SKU or barcode.", "Set the main unit, optional sub-unit and units per pack before entering stock.", "Enter prices for the main unit and review reorder/batch/expiry settings.", "Save the product. Use setup review to fill missing settings for many products together."] },
  { title: "Main unit and sub-unit", description: "The main unit is a pack, box, carton, kilogram or another unit you define. A sub-unit is a smaller amount such as a piece or gram.", steps: ["Example: main unit Box, sub-unit Piece, units per pack 12 means one box contains 12 pieces.", "Choose Main to sell boxes or Sub-unit to sell pieces. Two boxes contain 24 pieces.", "The quantity and price on an invoice are for the selected unit. A main-unit price of 120 becomes 10 per piece when the pack contains 12.", "Review the displayed unit before saving. A product without a valid sub-unit conversion uses its main unit."] },
  { title: "Barcode and quick sale", description: "Use a USB/Bluetooth barcode scanner in keyboard mode. It types the barcode into the focused scan field; no special device pairing inside TradeOS is needed for this mode.", steps: ["In Products, click Ready to scan, scan the barcode, fill the remaining details and save. Keep leading zeroes in the barcode.", "Choose Retail POS / Create a sale from the dashboard. TradeOS prepares a Walk-in customer for your business; choose another customer when needed.", "Choose whether each scan adds one main unit or one sub-unit. Scan to add the matching saved product. Scanning again increases its quantity.", "Adjust quantity/price as needed. Click Ready to scan after editing another field. Unknown or duplicate barcodes must be corrected.", "Review and choose Pay & Save. Employee sales still require owner approval. Hold sale keeps an unfinished basket on this browser without posting it. After saving, open the receipt to print. Use Full invoice for advanced options."] },
  { title: "Sales invoices, orders and returns", description: "Invoices record sales. Orders track requested sales; employee submissions may wait for approval. Returns reverse eligible sold items through the return workflow.", steps: ["Choose a customer, date and cash/credit payment type.", "Search or scan products; check units, quantity, selling price, discount and any free bonus quantity.", "Enter moves to the next invoice field; the last field can open a new product line. Use the Save button to finish.", "Owners review staff drafts before approval. Do not treat a pending draft as a completed sale.", "Use invoice history, returns, printable invoices and load forms according to your permissions."] },
  { title: "Purchases and suppliers", description: "Record stock bought from suppliers and track what your business owes them.", steps: ["Create the supplier first, then open a purchase invoice.", "Choose products and their purchase units, quantities and costs. Enter batch/expiry details when required.", "Review and save. A saved purchase updates the applicable stock and supplier records.", "Record supplier payments separately and review allocation/outstanding amounts in the supplier ledger."] },
  { title: "Inventory and imports", description: "Inventory shows stock and its movements. Import mappings tell TradeOS what each external column means.", steps: ["Choose an entity and upload its file. Reuse a saved mapping for the same file format.", "Map quantities by meaning, not by the source column name. Review initial stock and units carefully.", "Preview errors and duplicate handling before importing. Update imports preserve omitted supported settings.", "Use setup review for missing fields and bulk edits. Zero reorder level and No are valid deliberate settings.", "Stock history records movements; never invent missing historical quantities. Review low-stock and expiry alerts."] },
  { title: "Customers, credit and payments", description: "Customer records hold contact details, credit rules and optional salesman/territory assignments. Payment records track money received.", steps: ["Add or import customers and verify their credit rules.", "Permitted salesmen can submit sales for active customers in their organization, including unassigned customers.", "Record the received amount, method, date and reference, then review invoice allocations.", "When importing historical payments, use unique references to avoid duplicates. Imports do not automatically reconstruct opening balances or allocate old payments.", "Check outstanding invoices and overdue credit before accepting another credit sale."] },
  { title: "Dashboard, reports and expenses", description: "Use the dashboard to review recorded sales, stock, amounts due and recent activity. Record business expenses so reports include them.", steps: ["Check the date range before comparing totals.", "Open sales, purchase, stock and customer reports for details behind a summary.", "Use Export business records for selected dates, then Print / Save as PDF.", "The export includes supported transactions and recorded activity; it is not a complete database backup.", "Review profit and other totals against source invoices and costs before using them for business decisions."] },
  { title: "Employees, permissions and field work", description: "Owners invite staff, choose permitted tools and manage assignments. Employees use the screens granted to them and review their own performance.", steps: ["An imported employee record does not automatically create a login. Invite/provision the staff account separately.", "Grant only the sections and sales sub-options the employee needs.", "Set territories/routes, then review visits, attendance, duty and collections where enabled.", "Location features need device permissions and connectivity. Mobile background behavior also depends on the device.", "Employees submit sales for approval; owners approve or reject. Help does not grant extra access."] },
  { title: "Print and reference templates", description: "Save invoice/load-form layouts and reuse them for future printing.", steps: ["Open the template customizer and upload a reference PDF, image or spreadsheet.", "Spreadsheets detect supported table columns directly. Images/PDFs need a configured recognition provider.", "Review recognized columns, fonts, widths and the preview; arbitrary reference layouts cannot always be copied exactly.", "Confirm the proposed settings, make corrections and explicitly save the template."] },
  { title: "AI, tasks and business settings", description: "AI features can assist with queries and drafts when their provider is configured. Settings control business details and available workflows.", steps: ["Ask questions using the records available to your account; check results against source transactions.", "Review suggested actions before any business record is changed. Provider outages or missing keys can prevent AI features from working.", "Use tasks and notifications to follow up on work.", "Owners manage branding, staff permissions, security and other settings. Deployment/readiness checklists do not automatically install a mobile app or configure external services."] },
];

const descriptions: Record<string, string> = {
  "keep customer": "Keep the same selected customer when starting the next quick sale. Enable this only when consecutive sales should belong to that customer; otherwise choose the next customer yourself.",
  "keep the selected customer": "Keep the same selected customer when starting the next quick sale. Enable this only when consecutive sales should belong to that customer; otherwise choose the next customer yourself.",
  "quick-sale mode": "Keep the barcode counter available for consecutive invoices. Saving clears the completed product lines. Customer retention is a separate choice and employee approval is still required.",
  "main unit": guideTopics[2].description,
  "unit type": "Name the main stock unit, such as Box, Carton or Kg. Product default prices are per main unit. Set a sub-unit and conversion if you also sell smaller amounts.",
  "subunit": "The smaller unit inside one main unit, such as Piece inside Box. Set units per pack correctly before using this conversion.",
  "sub-unit": "Choose the smaller configured unit, such as Piece. Quantity and price apply to that selected unit, not to a whole box.",
  "units per pack": "How many sub-units make one main unit. For a box of 12 pieces enter 12. This conversion affects prices and stock deductions.",
  "unit": "Choose the quantity unit for this line. Main means the whole configured unit; Sub-unit means the smaller configured unit. Check price per selected unit.",
  "barcode": guideTopics[3].description,
  "quick sale": guideTopics[3].description,
  "quantity": "Enter how many selected units are being sold or purchased. For example, Quantity 2 with Box selected means two boxes, not two pieces.",
  "selling price": "Price for one selected invoice unit. Product defaults or the customer's recent price may be suggested; check the unit before accepting it.",
  "purchase price": "Cost for one selected purchase unit. Check the unit and cost before saving because purchases feed stock and cost reporting.",
  "bonus": "Free quantity supplied with this product line. Review the selected unit: free stock still leaves inventory even though it is not charged like the sold quantity.",
  "discount": "A reduction in the invoice or line amount. Check whether the control uses a fixed amount or percentage before entering it.",
  "tax": "The tax rate applied by this invoice calculation. Review the resulting total and use the rate appropriate to your business.",
  "initial stock": "Opening quantity for this product. Map the file column to the intended stock unit and review the preview before import. The source heading alone does not determine its meaning.",
  "reorder": "The stock threshold used for low-stock review. Enter the level at which you want to consider purchasing more. Zero is allowed.",
  "minimum stock": "A minimum stock setting used in inventory review. Review it alongside the reorder level and your product's main unit.",
  "track batch": "Track batch identifiers for stock movements where the workflow requires them. This does not reconstruct missing historical batch records.",
  "track expiry": "Track product expiry dates where supported. Enter correct batch/expiry details when receiving and moving this stock.",
  "overselling": "Controls whether sales may exceed available stock under the applicable product/category policy. Review stock before permitting overselling.",
  "credit limit": "The customer's configured credit amount limit. The active credit policy and permitted overrides determine how it is enforced.",
  "credit days": "The configured number of days allowed before a credit payment is due. Review the resulting invoice due date.",
  "payment type": "Cash and Credit follow different payment and outstanding-balance workflows. Confirm the correct choice before saving the sale.",
  "payment method": "How the payment was made, such as cash or bank. Add a useful reference for bank/cheque payments and future reconciliation.",
  "reference": "An identifying reference for this record or payment. Unique payment references help detect repeated imports for the same party.",
  "assigned": "An optional staff, route or territory relationship. Assignments organize field work; they do not by themselves grant account permissions.",
  "sku": "Your internal product code. It can help with search and imports; it is separate from the printed barcode.",
  "dashboard": guideTopics[8].description,
  "product": guideTopics[1].description,
  "brand": "The product's brand or manufacturer grouping. Use it to organize product lists and reports.",
  "categor": "A product grouping such as Food or Medicine. Categories organize reports and may supply an inherited stock policy.",
  "customer": guideTopics[7].description,
  "supplier": guideTopics[5].description,
  "purchase": guideTopics[5].description,
  "sales": guideTopics[4].description,
  "invoice": guideTopics[4].description,
  "inventory": guideTopics[6].description,
  "import": guideTopics[6].description,
  "export": "Export the supported records using the selected filters. Check the date range and included records; an export is not a full database backup.",
  "profit": guideTopics[8].description,
  "expense": "Record a business cost with its date, type, amount and notes. Verify it before saving so financial reports use accurate entries.",
  "employee": guideTopics[9].description,
  "staff": guideTopics[9].description,
  "permission": "Controls which features a staff member may access. Only authorized owners/admins should change these settings. Help does not change permissions.",
  "route": "An ordered customer/field-work route. Review assigned staff, customers and territory before using it for visits.",
  "territor": "A geographical grouping for customers and staff assignments. Use it to organize coverage and field work.",
  "attendance": "Record or review staff attendance and duty times. Device/location requirements apply where enabled.",
  "visit": "Record customer field visits, notes and outcomes through the permitted visit workflow.",
  "tracking": "Shows available staff location records. Tracking needs the employee's device permission and a working connection; it is not guaranteed continuously on every device.",
  "notification": "Review alerts and follow-up items. Open the related record to understand the action required.",
  "task": "Track a piece of work with its status, priority and due date. Review the task details before changing its status.",
  "template": guideTopics[10].description,
  "load form": "A printable warehouse picking summary of selected sales. Check dates, staff, products, quantities and units before preparing the goods.",
  "profile": "Your account and employee details. Contact the owner if your role, assignments or access need correction.",
  "activity": "Recorded audit events for supported actions. This is not a recording of every click or every dashboard view.",
  "business intelligence": "Review available business summaries using the selected dates and filters. Open source transactions to reconcile totals.",
  "security": "Owner-facing security/readiness checks. Review each actual check result; a listed check is not proof that every security risk has been eliminated.",
  "deployment": "Deployment readiness and operational information for the owner. Configuration and external services require separate verification.",
  "mobile": "Mobile access and readiness information. Browser responsiveness and a native mobile build are different; device testing and deployment are still required.",
  "ai": guideTopics[11].description,
  "market": "Market intelligence and research depend on configured sources/providers. Check freshness and evidence before acting on a suggestion.",
  "settings": guideTopics[11].description,
};

export function describeControl(label: string, kind = "", context = "") {
  const normalized = label.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  const match = Object.keys(descriptions).sort((a, b) => b.length - a.length).find(key => normalized.includes(key.replace(/-/g, " ")));
  if (match) return descriptions[match];
  if (/^(save|create|add|submit|send|approve|reject|delete|remove|cancel|close|edit|update|apply|confirm|print|next|previous|clear|reset|select|search|filter|view|open|record)/i.test(normalized)) {
    const action = normalized.split(" ")[0];
    if (["delete", "remove"].includes(action)) return "Removes the selected item through this screen's workflow. Review what is selected and any confirmation before proceeding.";
    if (["cancel", "close"].includes(action)) return "Closes or cancels the current step. Unsaved entries may be lost; save first if you want to keep them.";
    if (["save", "create", "submit", "send", "apply", "confirm", "update", "record", "approve", "reject"].includes(action)) return "Applies the action named on this button to the current record or selection. Review fields, quantities, units and any confirmation first. Employee sales may remain pending owner approval.";
    return `Use “${label}” to ${action} the relevant item or step${context ? ` in ${context}` : ""}. Review the resulting screen before saving any business changes.`;
  }
  if (kind === "checkbox") return "Turn this option on or off for the current form. Review its label and related settings before saving.";
  if (kind === "select") return `Choose the ${label.toLowerCase()} appropriate to this record. Available choices are listed below; review the selection before saving.`;
  if (kind === "date") return "Choose the date this record or filter should use. Reports and transaction dates can produce different results if you choose the wrong range.";
  if (kind === "number") return `Enter the ${label.toLowerCase()} for this record. Check any unit, minimum and step shown on the field before saving.`;
  return `This is the “${label}” control${context ? ` in ${context}` : ""}. Use the visible label, choices and validation messages to set this part of the record. The full tutorial explains the surrounding workflow.`;
}
