import type { SectionId, StaffPermissionKey } from "./types";

export const navigationItems: Array<{ id: SectionId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "products", label: "Products" },
  { id: "brands", label: "Brands" },
  { id: "categories", label: "Categories" },
  { id: "customers", label: "Customers" },
  { id: "suppliers", label: "Suppliers" },
  { id: "purchases", label: "Purchases" },
  { id: "sales", label: "Sales" },
  { id: "inventory", label: "Inventory" },
  { id: "customer-payments", label: "Customer Payments" },
  { id: "supplier-payments", label: "Supplier Payments" },
  { id: "expenses", label: "Expenses" },
  { id: "profit-loss", label: "Profit & Loss" },
  { id: "business-intelligence", label: "Business Intelligence" },
  { id: "ai-analytics", label: "AI Analytics" },
  { id: "customer-credit", label: "Customer Credit" },
  { id: "supplier-ledger", label: "Supplier Ledger" },
  { id: "business-settings", label: "Business Settings" },
  { id: "task-manager", label: "Task Manager" },
  { id: "activity-logs", label: "Activity Logs" },
  { id: "staff-permissions", label: "Staff & Permissions" },
  { id: "security-check", label: "Security Check" },
  { id: "deployment", label: "Deployment" },
  { id: "staff-duty", label: "Staff Duty" },
  { id: "ai-assistant", label: "AI Assistant" },
  { id: "ai-business-query", label: "AI Business Query" },
  { id: "ai-voice-operator", label: "AI Voice Operator" },
  { id: "market-intelligence", label: "Market Intelligence" },
  { id: "mobile-app", label: "Mobile App" },
];

export const staffPermissionLabels: Array<{ key: StaffPermissionKey; label: string }> = [
  { key: "can_manage_products", label: "Manage Products" },
  { key: "can_manage_customers", label: "Manage Customers" },
  { key: "can_manage_suppliers", label: "Manage Suppliers" },
  { key: "can_create_purchases", label: "Create Purchases" },
  { key: "can_create_sales", label: "Create Sales" },
  { key: "can_manage_payments", label: "Manage Payments" },
  { key: "can_manage_expenses", label: "Manage Expenses" },
  { key: "can_view_profit", label: "View Profit" },
  { key: "can_view_reports", label: "View Reports" },
  { key: "can_manage_tasks", label: "Manage Tasks" },
  { key: "can_manage_settings", label: "Manage Settings" },
];

export const staffRoles = ["owner", "admin", "manager", "staff", "accountant", "sales"];

export const defaultSecurityChecks: Array<{ key: string; label: string }> = [
  { key: "app_loads", label: "App loads after RLS hardening" },
  { key: "owner_profile_linked", label: "Owner profile linked to auth user" },
  { key: "organization_isolation", label: "Organization-based RLS policies applied" },
  { key: "child_table_security", label: "Invoice item and payment allocation child tables protected" },
  { key: "staff_permissions_ui", label: "Staff permissions UI working" },
  { key: "product_create", label: "Product create works" },
  { key: "customer_create", label: "Customer create works" },
  { key: "supplier_create", label: "Supplier create works" },
  { key: "purchase_create", label: "Purchase invoice with item works" },
  { key: "sales_create", label: "Sales invoice with item works" },
  { key: "payment_allocation", label: "Customer/supplier payment allocations work" },
  { key: "dashboard_reports", label: "Dashboard, Profit & Loss, and reports load" },
  { key: "print_export", label: "Print invoices and CSV exports work" },
  { key: "build_passes", label: "Production build passes" },
  { key: "ready_for_deployment", label: "Ready for Vercel deployment preparation" },
];

export const deploymentManualChecklistItems = [
  "Local build passes",
  "GitHub main branch is pushed",
  "Vercel project connected to GitHub",
  "Vercel env variables added",
  "First deployment succeeds",
  "Login works on deployed URL",
  "Dashboard opens on deployed URL",
  "Product create works on deployed URL",
  "Sale create works on deployed URL",
  "Print invoice works on deployed URL",
  "PWA manifest added",
  "Mobile install tested",
];

export const mobileReadinessItems = [
  { label: "App manifest configured", status: "Ready" },
  { label: "Mobile install icon configured", status: "Ready" },
  { label: "Standalone display mode configured", status: "Ready" },
  { label: "Secure login required", status: "Ready" },
  { label: "Staff permissions available", status: "Ready" },
  { label: "Staff duty location tracking V1", status: "Ready" },
  { label: "AI voice shortcut planned", status: "Planned" },
];

export const mobileRoadmapItems = [
  "Live staff location tracking",
  "Owner mobile dashboard",
  "AI voice assistant shortcut",
  "Push notifications later",
  "Offline-friendly improvements later",
];

export const aiAssistantExampleCommands = [
  "Add purchase of 10 cartons Pepsi 500ml from Test Pepsi Agency at purchase price 1000 and selling price 1200.",
  "Create cash sale for Test Customer: 1 carton Pepsi 500ml at 1200.",
  "Add task: Call supplier tomorrow about Pepsi rates.",
  "Add expense: 500 transport expense for purchase invoice TEST-PUR-001.",
];

export const aiAssistantRoadmapItems = [
  "Voice input",
  "AI follow-up questions",
  "Purchase draft execution",
  "Sale draft execution",
  "Expense draft execution",
  "Owner confirmation before saving",
  "Market intelligence integration",
];

export const taskTypes = [
  "general",
  "customer_follow_up",
  "supplier_follow_up",
  "payment_collection",
  "stock_check",
  "purchase_review",
  "sales_follow_up",
  "reorder",
  "expense_review",
];

export const taskPriorities = ["low", "medium", "high", "urgent"];
export const taskStatuses = ["pending", "in_progress", "completed", "cancelled"];

export const taskTypeLabels: Record<string, string> = {
  general: "General",
  customer_follow_up: "Customer Follow Up",
  supplier_follow_up: "Supplier Follow Up",
  payment_collection: "Payment Collection",
  stock_check: "Stock Check",
  purchase_review: "Purchase Review",
  sales_follow_up: "Sales Follow Up",
  reorder: "Reorder",
  expense_review: "Expense Review",
};

export const taskPriorityLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const taskStatusLabels: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const marketCategoryOptions = [
  { value: "cooking_oil_ghee", label: "Cooking Oil & Ghee" },
  { value: "sugar", label: "Sugar" },
  { value: "wheat_flour", label: "Wheat Flour" },
  { value: "rice", label: "Rice" },
  { value: "pulses", label: "Pulses" },
  { value: "spices", label: "Spices" },
  { value: "beverages", label: "Beverages" },
  { value: "dairy", label: "Dairy" },
  { value: "fuel_transport", label: "Fuel & Transport" },
  { value: "packaging", label: "Packaging" },
  { value: "currency_imports", label: "Currency & Imports" },
  { value: "taxes_policy", label: "Taxes & Policy" },
  { value: "weather_agriculture", label: "Weather & Agriculture" },
  { value: "general_fmcg", label: "General FMCG" },
];

export const marketImpactDirectionOptions = [
  { value: "price_up", label: "Price Up" },
  { value: "price_down", label: "Price Down" },
  { value: "supply_shortage", label: "Supply Shortage" },
  { value: "supply_improvement", label: "Supply Improvement" },
  { value: "demand_up", label: "Demand Up" },
  { value: "demand_down", label: "Demand Down" },
  { value: "neutral", label: "Neutral" },
];

export const marketImpactLevelOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const marketConfidenceOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const marketAffectedAreaOptions = [
  { value: "buying", label: "Buying" },
  { value: "selling", label: "Selling" },
  { value: "inventory", label: "Inventory" },
  { value: "transport", label: "Transport" },
  { value: "pricing", label: "Pricing" },
  { value: "cashflow", label: "Cashflow" },
  { value: "business", label: "Business" },
];

export const marketIntelligenceStatusOptions = [
  { value: "active", label: "Active" },
  { value: "watching", label: "Watching" },
  { value: "archived", label: "Archived" },
];

export const marketIntelligenceExampleChips = [
  {
    title: "Cooking oil import cost rising - possible price increase",
    summary: "Manual signal: import or landing costs may be rising for cooking oil and ghee.",
    market_category: "cooking_oil_ghee",
    impact_direction: "price_up",
    impact_level: "high",
    confidence_level: "medium",
    affected_area: "buying",
    suggested_action: "Review supplier rates and avoid underpricing current stock.",
  },
  {
    title: "Fuel price increase - delivery cost may rise",
    summary: "Manual signal: transport and delivery costs may increase after fuel price movement.",
    market_category: "fuel_transport",
    impact_direction: "price_up",
    impact_level: "medium",
    confidence_level: "medium",
    affected_area: "transport",
    suggested_action: "Check delivery charges and update transport expense assumptions.",
  },
  {
    title: "Sugar supply concern - keep watch on stock",
    summary: "Manual signal: sugar supply concerns may affect availability and buying price.",
    market_category: "sugar",
    impact_direction: "supply_shortage",
    impact_level: "high",
    confidence_level: "medium",
    affected_area: "inventory",
    suggested_action: "Monitor supplier availability and avoid stockouts.",
  },
  {
    title: "Currency depreciation - imported items may become expensive",
    summary: "Manual signal: currency movement may affect imported FMCG, packaging, and raw materials.",
    market_category: "currency_imports",
    impact_direction: "price_up",
    impact_level: "high",
    confidence_level: "medium",
    affected_area: "pricing",
    suggested_action: "Review prices for imported or import-linked items.",
  },
  {
    title: "Weather impact on crops - pulses/rice prices may move",
    summary: "Manual signal: weather conditions may affect crop output and commodity prices.",
    market_category: "weather_agriculture",
    impact_direction: "neutral",
    impact_level: "medium",
    confidence_level: "low",
    affected_area: "buying",
    suggested_action: "Watch wholesale market prices before large purchases.",
  },
];

export const marketImportQueueExampleChips = [
  {
    raw_title: "News link about cooking oil import cost",
    raw_summary: "Owner pasted note: cooking oil import cost may be rising.",
    raw_text: "Paste the source link or manual summary here before converting to a structured intelligence item.",
    suggested_market_category: "cooking_oil_ghee",
    suggested_impact_direction: "price_up",
    suggested_impact_level: "high",
    suggested_confidence_level: "medium",
    suggested_affected_area: "buying",
    suggested_action: "Review supplier costs and current selling prices.",
  },
  {
    raw_title: "Supplier says sugar supply is tight",
    raw_summary: "Supplier update: sugar availability may be limited.",
    raw_text: "Manual supplier update awaiting owner review.",
    suggested_market_category: "sugar",
    suggested_impact_direction: "supply_shortage",
    suggested_impact_level: "high",
    suggested_confidence_level: "medium",
    suggested_affected_area: "inventory",
    suggested_action: "Monitor stock and supplier availability before committing sales.",
  },
  {
    raw_title: "Fuel price update may increase delivery cost",
    raw_summary: "Fuel price movement may increase transport and delivery costs.",
    raw_text: "Manual fuel/transport observation awaiting review.",
    suggested_market_category: "fuel_transport",
    suggested_impact_direction: "price_up",
    suggested_impact_level: "medium",
    suggested_confidence_level: "medium",
    suggested_affected_area: "transport",
    suggested_action: "Review delivery charges and transport expense assumptions.",
  },
  {
    raw_title: "Currency movement may affect imported goods",
    raw_summary: "Currency depreciation may make imported or import-linked goods expensive.",
    raw_text: "Manual currency/import note awaiting review.",
    suggested_market_category: "currency_imports",
    suggested_impact_direction: "price_up",
    suggested_impact_level: "high",
    suggested_confidence_level: "medium",
    suggested_affected_area: "pricing",
    suggested_action: "Review pricing for imported items and packaging.",
  },
  {
    raw_title: "Weather/crop update may affect pulses/rice",
    raw_summary: "Weather or crop conditions may affect pulses and rice prices.",
    raw_text: "Manual agriculture/weather observation awaiting review.",
    suggested_market_category: "weather_agriculture",
    suggested_impact_direction: "neutral",
    suggested_impact_level: "medium",
    suggested_confidence_level: "low",
    suggested_affected_area: "buying",
    suggested_action: "Watch wholesale market prices before large purchases.",
  },
];
