export interface Brand {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  parent_category_id: string | null;
  overselling_policy?: "allow" | "block" | null;
}

export interface Product {
  id: number;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  unit_type: string | null;
  units_per_pack?: number | null;
  sku?: string | null;
  barcode?: string | null;
  last_purchase_price?: number | null;
  default_purchase_price?: number | null;
  default_selling_price?: number | null;
  minimum_stock_level?: number | null;
  reorder_level?: number | null;
  track_batch?: boolean | null;
  track_expiry?: boolean | null;
  current_stock?: number | null;
  overselling_policy?: "allow" | "block" | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Customer {
  id: string;
  customer_name: string;
  shop_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  area: string | null;
  customer_type: string | null;
  credit_policy: string | null;
  credit_limit: number | null;
  credit_days: number | null;
  allow_over_limit: boolean | null;
  allow_overdue_sales: boolean | null;
  preferred_payment_method: string | null;
  // Sales Management (Phase 4) — additive metadata.
  is_active?: boolean | null;
  notes?: string | null;
}

export interface Supplier {
  id: string;
  supplier_name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  notes: string | null;
  is_active?: boolean | null;
}

export interface PurchaseTransaction {
  id: string;
  supplier_id: string;
  invoice_number: string;
  created_at: string;
  purchase_date?: string | null;
  expense_review_status: string | null;
  expense_reviewed_at: string | null;
  // Invoice Management Foundation (ERP V2 Sprint 1) — additive metadata.
  organization_id?: string;
  total_amount?: number | null;
  notes?: string | null;
  status?: string | null;
  invoice_type?: string | null;
  created_by_profile_id?: string | null;
  /** Supplier's own paper invoice reference, distinct from invoice_number. */
  supplier_invoice_number?: string | null;
}

export interface SalesTransaction {
  id: string;
  customer_id: string;
  invoice_number: string;
  created_at: string;
  sale_date: string | null;
  payment_type: string | null;
  credit_due_date: string | null;
  credit_limit_snapshot: number | null;
  credit_days_snapshot: number | null;
  // Invoice Management Foundation (ERP V2 Sprint 1) — additive metadata.
  organization_id?: string;
  total_amount?: number | null;
  notes?: string | null;
  status?: string | null;
  invoice_type?: string | null;
  created_by_profile_id?: string | null;
  // Sales Management (Phase 4) — additive metadata.
  discount_amount?: number | null;
  tax_rate?: number | null;
  tax_amount?: number | null;
}

// Sales Management (Phase 4) — sales orders, their line items, returns.

export interface SalesOrder {
  id: string;
  organization_id: string;
  so_number: string;
  customer_id: string | null;
  order_date: string | null;
  expected_date: string | null;
  notes: string | null;
  status: "draft" | "confirmed" | "delivered" | "cancelled";
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesOrderItem {
  id: string;
  sales_order_id: string;
  product_id: number;
  quantity_ordered: number;
  quantity_delivered: number;
  unit_price: number | null;
  discount: number | null;
  created_at: string;
}

export interface SalesReturn {
  id: string;
  organization_id: string;
  return_number: string;
  customer_id: string | null;
  sales_transaction_id: string | null;
  return_date: string | null;
  reason: string | null;
  status: "confirmed" | "cancelled";
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesReturnItem {
  id: string;
  sales_return_id: string;
  product_id: number;
  quantity: number;
  unit_price: number | null;
  discount: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  created_at: string;
}

// Purchase Management (Phase 1) — purchase orders, their line items, returns.

export interface PurchaseOrder {
  id: string;
  organization_id: string;
  po_number: string;
  supplier_id: string | null;
  order_date: string | null;
  expected_date: string | null;
  notes: string | null;
  status: "ordered" | "partial" | "received" | "cancelled";
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: number;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  created_at: string;
}

export interface PurchaseReturn {
  id: string;
  organization_id: string;
  return_number: string;
  supplier_id: string | null;
  purchase_transaction_id: string | null;
  return_date: string | null;
  reason: string | null;
  status: "confirmed" | "cancelled";
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseReturnItem {
  id: string;
  purchase_return_id: string;
  product_id: number;
  quantity: number;
  unit_price: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  organization_id: string;
  title: string;
  task_type: string;
  priority: string;
  status: string;
  due_date: string | null;
  notes: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  purchase_transaction_id: string | null;
  sales_transaction_id: string | null;
  product_id: number | string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TaskSuggestion {
  key: string;
  title: string;
  reason: string;
  task_type: string;
  priority: string;
  customer_id: string | null;
  supplier_id: string | null;
  product_id: number | string | null;
  purchase_transaction_id: string | null;
  sales_transaction_id: string | null;
}

export interface AuditLog {
  id: string;
  organization_id: string;
  actor_profile_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  description: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export interface StaffProfile {
  id: string;
  organization_id: string;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  display_name: string | null;
  auth_user_id?: string | null;
}

export interface StaffPermission {
  id?: string;
  organization_id: string;
  profile_id: string;
  can_manage_products: boolean | null;
  can_manage_customers: boolean | null;
  can_manage_suppliers: boolean | null;
  can_create_purchases: boolean | null;
  can_create_sales: boolean | null;
  can_manage_payments: boolean | null;
  can_manage_expenses: boolean | null;
  can_view_profit: boolean | null;
  can_view_reports: boolean | null;
  can_manage_tasks: boolean | null;
  can_manage_settings: boolean | null;
  can_manage_inventory: boolean | null;
}

export interface SecurityCheck {
  id?: string;
  organization_id: string;
  check_key: string;
  check_label: string;
  status: "pending" | "pass" | "fail" | string;
  notes: string | null;
  checked_at: string | null;
  checked_by_profile_id: string | null;
}

export interface MarketNewsSource {
  id: string;
  organization_id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
  country: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string | null;
}

export interface MarketIntelligenceItem {
  id: string;
  organization_id: string;
  created_by_profile_id: string | null;
  title: string;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  market_category: string;
  related_product_category: string | null;
  related_product_id: number | string | null;
  impact_direction: string;
  impact_level: string;
  confidence_level: string;
  affected_area: string;
  suggested_action: string | null;
  news_date: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
}

export interface MarketImportQueueItem {
  id: string;
  organization_id: string;
  created_by_profile_id: string | null;
  source_name: string | null;
  source_url: string | null;
  raw_title: string | null;
  raw_summary: string | null;
  raw_text: string | null;
  suggested_market_category: string | null;
  suggested_impact_direction: string | null;
  suggested_impact_level: string | null;
  suggested_confidence_level: string | null;
  suggested_affected_area: string | null;
  suggested_action: string | null;
  review_status: string;
  converted_intelligence_item_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  reviewed_at: string | null;
}

export interface MarketAiAnalysis {
  id: string;
  organization_id: string;
  created_by_profile_id: string | null;
  market_import_queue_id: string | null;
  market_intelligence_item_id: string | null;
  input_title: string | null;
  input_summary: string | null;
  input_text: string | null;
  input_source_name: string | null;
  input_source_url: string | null;
  ai_summary: string | null;
  ai_reasoning: string | null;
  ai_market_category: string | null;
  ai_impact_direction: string | null;
  ai_impact_level: string | null;
  ai_confidence_level: string | null;
  ai_affected_area: string | null;
  ai_suggested_action: string | null;
  ai_risks: string | null;
  ai_owner_questions: string | null;
  raw_ai_response: unknown;
  review_status: string;
  converted_intelligence_item_id: string | null;
  created_at: string;
  updated_at: string | null;
  reviewed_at: string | null;
}

export interface AiBusinessQueryResult {
  answer: string;
  query_type: string;
  language: string;
  key_points: string[];
  warnings: string[];
}

export interface AiBusinessQueryLog {
  id: string;
  organization_id: string;
  created_by_profile_id: string | null;
  question: string;
  answer: string | null;
  query_type: string | null;
  language: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  summary_data: unknown;
  raw_ai_response: unknown;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface AiVoiceOperatorSession {
  id: string;
  organization_id: string;
  profile_id: string | null;
  session_title: string | null;
  language: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
}

export interface AiVoiceOperatorMessage {
  id: string;
  organization_id: string;
  profile_id: string | null;
  voice_session_id: string | null;
  role: string;
  message_type: string;
  message_text: string;
  detected_intent: string | null;
  routed_to: string | null;
  related_ai_action_draft_id: string | null;
  related_business_query_log_id: string | null;
  related_market_ai_analysis_id: string | null;
  created_at: string;
}

export interface AiAlert {
  id: string;
  organization_id: string;
  created_by_profile_id: string | null;
  alert_type: string;
  title: string;
  summary: string | null;
  severity: string;
  source_type: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  recommended_action: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
}

export interface AiDailyBriefing {
  id: string;
  organization_id: string;
  created_by_profile_id: string | null;
  briefing_date: string;
  language: string | null;
  title: string;
  summary: string | null;
  top_signals: unknown;
  recommended_actions: unknown;
  raw_summary_data: unknown;
  status: string;
  created_at: string;
  updated_at: string | null;
}

export interface NewPurchaseExpenseReminder {
  id: string;
  invoiceNumber: string;
  supplierId: string;
}

export interface SupplierPurchasePaymentAllocation {
  purchaseTotal: number;
  explicitAllocatedAmount: number;
  fallbackAllocatedAmount: number;
  paidAmount: number;
  remainingPayableAmount: number;
}

export interface SupplierLedgerEntry {
  id: string;
  date: string | null;
  eventTimestamp: string | null;
  eventTime: number;
  eventType: "purchase" | "payment";
  reference: string;
  notes: string;
  debit: number;
  credit: number;
}

export interface SupplierLedgerDisplayEntry extends SupplierLedgerEntry {
  runningBalance: number;
}

export type SectionId =
  | "dashboard"
  | "products"
  | "brands"
  | "categories"
  | "customers"
  | "suppliers"
  | "purchases"
  | "sales"
  | "inventory"
  | "customer-payments"
  | "supplier-payments"
  | "expenses"
  | "profit-loss"
  | "business-intelligence"
  | "ai-analytics"
  | "customer-credit"
  | "supplier-ledger"
  | "business-settings"
  | "task-manager"
  | "activity-logs"
  | "staff-permissions"
  | "security-check"
  | "deployment"
  | "staff-duty"
  | "ai-assistant"
  | "ai-business-query"
  | "ai-voice-operator"
  | "market-intelligence"
  | "mobile-app"
  | "live-tracking";

export type StaffPermissionKey =
  | "can_manage_products"
  | "can_manage_customers"
  | "can_manage_suppliers"
  | "can_create_purchases"
  | "can_create_sales"
  | "can_manage_payments"
  | "can_manage_expenses"
  | "can_view_profit"
  | "can_view_reports"
  | "can_manage_tasks"
  | "can_manage_settings"
  | "can_manage_inventory";

export interface PurchaseLine {
  id?: string;
  product_id: string | null;
  quantity: string;
  purchase_price: string;
  selling_price: string;
  batch_number: string;
  expiry_date: string;
}

export interface StaffDutySession {
  id: string;
  organization_id: string;
  profile_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  start_accuracy: number | null;
  end_accuracy: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface StaffLocationPoint {
  id: string;
  organization_id: string;
  profile_id: string;
  duty_session_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  captured_at: string;
  created_at: string;
}

export interface CurrentLocationSnapshot {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  captured_at: string;
}

export interface AiActionDraft {
  id: string;
  organization_id: string;
  profile_id: string | null;
  command_text: string;
  action_type: string;
  status: "draft" | "needs_info" | "executed" | "cancelled" | "failed" | string;
  parsed_data: Record<string, unknown> | null;
  missing_fields: Array<string> | null;
  confirmation_summary: string | null;
  follow_up_questions?: Array<{ field: string; question: string; input_type?: string }> | null;
  follow_up_answers?: Record<string, unknown> | null;
  ready_to_execute?: boolean | null;
  execution_preview?: Record<string, unknown> | null;
  related_customer_id: string | null;
  related_supplier_id: string | null;
  related_product_id: number | string | null;
  executed_entity_type: string | null;
  executed_entity_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
  executed_at: string | null;
  owner_confirmed_at?: string | null;
}

export interface AiActionMessage {
  id: string;
  organization_id: string;
  profile_id: string | null;
  ai_action_draft_id: string | null;
  role: "owner" | "assistant" | "system" | string;
  message_type: "command" | "question" | "answer" | "confirmation" | "execution" | "error" | "text" | string;
  message_text: string;
  related_field: string | null;
  parsed_value: unknown;
  created_at: string;
}
