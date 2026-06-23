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
  { id: "customer-credit", label: "Customer Credit" },
  { id: "supplier-ledger", label: "Supplier Ledger" },
  { id: "business-settings", label: "Business Settings" },
  { id: "task-manager", label: "Task Manager" },
  { id: "activity-logs", label: "Activity Logs" },
  { id: "staff-permissions", label: "Staff & Permissions" },
  { id: "security-check", label: "Security Check" },
  { id: "deployment", label: "Deployment" },
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
  { label: "Location tracking planned", status: "Planned" },
  { label: "AI voice shortcut planned", status: "Planned" },
];

export const mobileRoadmapItems = [
  "Staff duty mode",
  "Live staff location tracking",
  "Owner mobile dashboard",
  "AI voice assistant shortcut",
  "Push notifications later",
  "Offline-friendly improvements later",
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
