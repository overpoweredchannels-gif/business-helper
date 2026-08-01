import type { CurrentLocationView } from "../location/types";
import type { ActionType } from "../ai/conversation-engine";

export type { ActionType };

export type ModuleKind =
  | "sales"
  | "purchases"
  | "inventory"
  | "staff"
  | "location"
  | "customers"
  | "suppliers"
  | "general"
  | "financial"
  | "business-intelligence"
  | "future";

export type AssistantCommand = "undo" | "repeat" | "continue" | "cancel" | "resume";

export type AssistantState =
  | "idle"
  | "collecting"
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "error"
  | "clarifying";

export interface EntityRef {
  id: string;
  name: string;
}

export interface ResolvedEntities {
  customer: EntityRef | null;
  supplier: EntityRef | null;
  product: EntityRef | null;
  employee: EntityRef | null;
  area: string | null;
  role: string | null;
  quantity: number | null;
  sellingPrice: number | null;
  purchasePrice: number | null;
  paymentType: "cash" | "credit" | null;
  creditDays: number | null;
  notes: string | null;
  phone: string | null;
  creditLimit: number | null;
  customerType: string | null;
  queryType: string | null;
}

export interface AssistantIntent {
  module: ModuleKind;
  actionType: ActionType;
  queryType: string | null;
  entities: ResolvedEntities;
  raw: string;
  confidence: number;
  unresolvedNames: { name: string; kind: "customer" | "supplier" | "product" | "employee" }[];
}

export interface ClarificationCandidate {
  key: string;
  name: string;
  detail: string;
}

export interface PendingClarification {
  id: string;
  kind: "customer" | "supplier" | "product" | "employee" | "quantity" | "generic";
  question: string;
  candidates: ClarificationCandidate[];
  context: Record<string, unknown>;
}

export interface WorkflowFieldAnswer {
  field: string;
  value: unknown;
  label: string;
  answeredAt: string;
}

export type WorkflowStatus = "active" | "paused" | "completed" | "cancelled" | "failed";

export interface Workflow {
  id: string;
  module: ModuleKind;
  actionType: ActionType;
  collectedData: Record<string, unknown>;
  nextField: string | null;
  status: WorkflowStatus;
  answers: WorkflowFieldAnswer[];
  awaitingConfirmation: boolean;
  confirmationSummary: string | null;
  createdAt: string;
  updatedAt: string;
  resultText: string | null;
  error: string | null;
}

export interface ActionRecord {
  id: string;
  sessionId: string;
  workflowId: string;
  intent: ActionType;
  module: ModuleKind;
  summary: string;
  executedAt: string;
  status: "executed" | "failed" | "reverted";
  payload: Record<string, unknown>;
  previousArea: string | null;
  /** Pre-action customer row snapshot (update_customer / delete_customer undo) */
  previousCustomer?: Record<string, unknown> | null;
  /** Pre-action supplier row snapshot (update_supplier / delete_supplier undo) */
  previousSupplier?: Record<string, unknown> | null;
}

export interface MemorySnapshot {
  currentTopic: string | null;
  currentWorkflowId: string | null;
  pendingConfirmation: string | null;
  lastCustomer: EntityRef | null;
  lastSupplier: EntityRef | null;
  lastProduct: EntityRef | null;
  lastEmployee: EntityRef | null;
  lastArea: string | null;
  lastSale: { customer: EntityRef | null; product: EntityRef | null; quantity: number; total: number } | null;
  lastPurchase: { supplier: EntityRef | null; product: EntityRef | null; quantity: number; total: number } | null;
  recentTopics: string[];
}

export interface HistoryEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface AssistantResponse {
  text: string;
  module: ModuleKind | "command" | "clarification";
  intent: string | null;
  state: AssistantState;
  workflowId: string | null;
  performed: AssistantCommand | null;
  revertedAction: ActionRecord | null;
  clarification: PendingClarification | null;
  memory: MemorySnapshot;
}

export interface AssistantSession {
  sessionId: string;
  state: AssistantState;
  activeWorkflow: Workflow | null;
  pausedWorkflows: Workflow[];
  pendingClarification: PendingClarification | null;
  pendingIntent: AssistantIntent | null;
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
  history: HistoryEntry[];
  /** Completed/cancelled workflows retained for resume */
  workflowHistory: Workflow[];
  createdAt: string;
  updatedAt: string;
  /** Internal: cross-module reference store (last customer/supplier/etc.) */
  _refs?: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  id?: string;
  referenceNumber?: string;
  error?: string;
}

export interface AssistantActionExecutor {
  createSale(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  createPurchase(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  assignStaff?(input: Record<string, unknown>): ActionResult;
  reassignStaff?(input: Record<string, unknown>): ActionResult;
  removeStaff?(input: Record<string, unknown>): ActionResult;
  createCustomer?(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  updateCustomer?(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  deleteCustomer?(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  createSupplier?(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  updateSupplier?(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
  deleteSupplier?(input: Record<string, unknown>, organizationId: string): Promise<ActionResult>;
}

export type GeneralChatHandler = (message: string, context: string, recent: string) => Promise<string>;

export interface UnifiedAssistantOptions {
  organizationId?: string;
  profileId?: string | null;
  locations?: CurrentLocationView[];
  actionExecutor?: AssistantActionExecutor;
  generalChatHandler?: GeneralChatHandler;
}

export type { CurrentLocationView };
