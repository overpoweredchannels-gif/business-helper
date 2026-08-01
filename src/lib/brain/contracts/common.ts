export type Channel = "in_app" | "voice" | "whatsapp" | "mcp" | "system";
export type PipelineMode = "read" | "write";
export type MemoryConfidenceLabel = "high" | "medium" | "low" | "unreliable";
export type Language = "english" | "urdu" | "roman_urdu" | "auto";

export type Intent =
  | "health" | "analytics_sales" | "analytics_inventory"
  | "analytics_customers" | "analytics_expenses"
  | "forecast" | "kpi" | "reorder" | "recommendations"
  | "general_overview" | "staff_query"
  | "action_sale" | "action_purchase" | "action_expense"
  | "action_task" | "action_customer" | "action_supplier"
  | "action_product" | "send_whatsapp"
  | "generate_briefing" | "generate_alert"
  | "schedule_reminder" | "learn_preference"
  | "greeting" | "thanks" | "farewell" | "casual" | "unknown";

export type StageName =
  | "input_reception" | "intent_classification" | "entity_extraction"
  | "context_retrieval" | "skill_execution" | "validation"
  | "permission_check" | "confirmation" | "execution"
  | "response_generation" | "audit" | "learning";

export type ErrorCode =
  | "EMPTY_INPUT" | "RATE_LIMITED" | "INPUT_TOO_LONG"
  | "UNCLASSIFIABLE" | "LOW_CONFIDENCE"
  | "ENTITIES_UNRESOLVED" | "ENTITIES_AMBIGUOUS" | "MISSING_REQUIRED_FIELD" | "ENTITY_NOT_FOUND"
  | "MEMORY_EMPTY" | "MEMORY_STALE" | "MEMORY_SECTION_NOT_FOUND"
  | "SKILLS_FAILED" | "SKILL_ERROR" | "ACTION_BLOCKED"
  | "INSUFFICIENT_STOCK" | "CREDIT_LIMIT_EXCEEDED" | "DUPLICATE_DRAFT" | "INVALID_VALUE" | "INVALID_DATE"
  | "UNAUTHENTICATED" | "PERMISSION_DENIED" | "OPERATION_DENIED"
  | "EXECUTION_FAILED" | "ALREADY_EXECUTED" | "API_FAILED" | "TRANSACTION_ROLLED_BACK"
  | "LLM_UNAVAILABLE" | "LLM_INVALID_RESPONSE" | "LLM_RATE_LIMITED" | "LLM_TIMEOUT" | "LLM_SAFETY_BLOCK" | "LLM_EMPTY_RESPONSE"
  | "INTERNAL_ERROR" | "TIMEOUT" | "CONFIGURATION_ERROR" | "PROTOCOL_VIOLATION";

export interface PipelineError {
  code: ErrorCode;
  message: string;
  detail: string;
  stage: StageName;
  severity: "info" | "warning" | "error" | "critical";
  recoverable: boolean;
  resolutionHint: string | null;
  source: "input" | "classification" | "entity" | "memory" | "skill" | "validation" | "permission" | "execution" | "llm" | "system";
  internalCode: string | null;
}

export interface StandardRequest {
  requestId: string;
  timestamp: string;
  organizationId: string;
  profileId: string;
  channel: Channel;
  contractVersion: string;
  idempotencyKey?: string;
}

export interface StandardResponseMeta {
  pipelineMode: PipelineMode;
  stagesCompleted: number;
  memoryAgeMs: number;
  memoryConfidence: MemoryConfidenceLabel;
  provider: string | null;
  model: string | null;
  llmLatencyMs: number | null;
  totalTokenEstimate: number;
  warnings: string[];
}

export interface StandardResponse<T = unknown> {
  ok: boolean;
  requestId: string;
  timestamp: string;
  durationMs: number;
  contractVersion: string;
  data?: T;
  error?: PipelineError;
  _meta: StandardResponseMeta;
}

export interface SkillWarning {
  code: string;
  message: string;
  severity: "info" | "warning";
  affectedData: string;
}

export interface TrendPoint {
  label: string;
  value: number;
  comparisonValue?: number;
}

export interface ChartData {
  type: "bar" | "line" | "pie" | "metric" | "gauge";
  title: string;
  labels: string[];
  datasets: Array<{ label: string; values: number[]; color?: string }>;
}

export interface TableData {
  title: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, string | number | boolean | null>>;
  sortable?: boolean;
  maxRows?: number;
}
