import type { CustomerMemory, SupplierMemory, MemoryWriterRawData } from "../brain/contracts/memory";
import { AssistantEntityStore } from "./entity-store";
import { IntentRouter, detectCommand, extractBareNumber, extractPrice, extractQuantity, extractCustomerNameFragment, extractSupplierNameFragment, extractCreditLimit, extractCustomerType, extractPhone } from "./intent-router";
import { UnifiedConversationMemory } from "./memory";
import { ReferenceResolver } from "./references";
import { ClarificationEngine } from "./clarification";
import { WorkflowEngine } from "./workflow";
import { ModuleExecutor, entityValue } from "./executor";
import { getAssignmentForEmployee } from "../ai/staff-executor";
import type {
  AssistantResponse,
  AssistantSession,
  AssistantIntent,
  Workflow,
  ActionRecord,
  MemorySnapshot,
  UnifiedAssistantOptions,
  ResolvedEntities,
  EntityRef,
} from "./types";
import type { CurrentLocationView } from "../location/types";

const YES_PATTERN = /^\s*(yes|yeah|yep|yup|ok|okay|okay sir|haan|han|ji haan|theek hai|sahi hai|confirm|confirm karo|confirmed|done|pakka|pakki)\b/i;
const NO_PATTERN = /^\s*(no|nhi|nahi|nope|theek nahi|na)\b/i;

/**
 * TradeOS Unified AI Assistant.
 *
 * Orchestration layer that unifies every Business Brain capability into one
 * conversational assistant: intent routing, multi-step conversations, context
 * switching between modules, unified conversation memory, cross-module
 * references, clarification, and conversation history controls
 * (undo / repeat / continue / cancel / resume).
 *
 * It reuses existing workflows exclusively: Brain memory (MemoryStore /
 * MemoryWriter), the Conversation Engine action schemas, the AI module
 * intelligence functions and executors. It does NOT modify the Business
 * Brain, Conversation Gateway, Voice Runtime, Identity or any existing AI
 * module, and contains no voice-specific business logic — it is a
 * text-in / text-out layer, fully voice-compatible.
 */
export class UnifiedAssistant {
  readonly store: AssistantEntityStore;
  readonly memory: UnifiedConversationMemory;
  readonly router: IntentRouter;
  readonly references: ReferenceResolver;
  readonly clarification: ClarificationEngine;
  readonly workflows: WorkflowEngine;
  readonly executor: ModuleExecutor;

  private readonly organizationId: string;
  private readonly profileId: string | null;
  private readonly locations: CurrentLocationView[];
  private readonly options: UnifiedAssistantOptions;
  private readonly data: MemoryWriterRawData;

  constructor(data: MemoryWriterRawData, options: UnifiedAssistantOptions = {}) {
    this.store = new AssistantEntityStore(data);
    this.data = data;
    this.memory = new UnifiedConversationMemory();
    this.router = new IntentRouter(this.store);
    this.clarification = new ClarificationEngine();
    this.workflows = new WorkflowEngine();
    this.organizationId = options.organizationId ?? data.organizationId;
    this.profileId = options.profileId ?? null;
    this.locations = options.locations ?? [];
    this.options = options;
    this.executor = new ModuleExecutor({
      organizationId: this.organizationId,
      locations: this.locations,
      actionExecutor: options.actionExecutor,
      generalChatHandler: options.generalChatHandler,
      data,
      refreshIndex: (next) => this.store.refresh(next),
    });
    this.references = new ReferenceResolver(this.memory, options);
  }

  getOrganizationId(): string {
    return this.organizationId;
  }

  getProfileId(): string | null {
    return this.profileId;
  }

  setLocations(locations: CurrentLocationView[]): void {
    this.locations.length = 0;
    this.locations.push(...locations);
    this.executor.updateLocations(this.locations);
  }

  getBusinessSummary(): string {
    return this.store.getBusinessSummary();
  }

  getConversationContext(count: number): Array<{ role: string; text: string }> {
    return this.store.getConversationContext(count);
  }

  async chat(sessionId: string, message: string): Promise<AssistantResponse> {
    const session = this.memory.getSession(sessionId);
    const clean = message.trim();
    this.memory.pushMessage(session, "user", clean);

    let response: AssistantResponse;
    try {
      if (session.pendingClarification) {
        response = await this.handleClarification(session, clean);
      } else {
        const command = detectCommand(clean);
        if (command) {
          response = await this.handleCommand(session, command);
        } else if (this.isConfirmationAnswer(session, clean)) {
          response = await this.handleConfirmation(session, clean);
        } else {
          const fieldAnswer = this.tryFieldAnswer(session, clean);
          if (fieldAnswer) {
            response = fieldAnswer;
          } else {
            const intent = this.router.classify(clean);
            response = await this.handleIntent(session, intent);
          }
        }
      }
    } catch (error) {
      response = this.errorResponse(session, error instanceof Error ? error.message : String(error));
    }

    this.memory.pushMessage(session, "assistant", response.text);
    session.state = response.state;
    return response;
  }

  // ─── Clarification ─────────────────────────────────────────────────────────

  private async handleClarification(session: AssistantSession, clean: string): Promise<AssistantResponse> {
    const clarification = session.pendingClarification!;
    const memorySnapshot = this.memory.snapshot(session);
    const resolved = this.clarification.resolveAnswer(clarification, clean, memorySnapshot);

    if (!resolved) {
      return {
        text: `I didn't catch that. ${this.clarification.formatQuestion(clarification)}`,
        module: "clarification",
        intent: null,
        state: "clarifying",
        workflowId: null,
        performed: null,
        revertedAction: null,
        clarification,
        memory: this.memory.snapshot(session),
      };
    }

    const candidate = clarification.candidates.find((c) => c.key === resolved.key);
    if (candidate) {
      const ref: EntityRef = { id: candidate.key, name: candidate.name };
      if (clarification.kind === "customer") this.memory.rememberReference(session, "lastCustomer", ref);
      if (clarification.kind === "supplier") this.memory.rememberReference(session, "lastSupplier", ref);
      if (clarification.kind === "product") this.memory.rememberReference(session, "lastProduct", ref);
      if (clarification.kind === "employee") this.memory.rememberReference(session, "lastEmployee", ref);
    }

    const pending = session.pendingIntent;
    session.pendingClarification = null;
    session.pendingIntent = null;

    if (pending) {
      const entities: ResolvedEntities = {
        ...pending.entities,
        customer: clarification.kind === "customer" ? { id: resolved.key, name: candidate?.name ?? resolved.key } : pending.entities.customer,
        supplier: clarification.kind === "supplier" ? { id: resolved.key, name: candidate?.name ?? resolved.key } : pending.entities.supplier,
        product: clarification.kind === "product" ? { id: resolved.key, name: candidate?.name ?? resolved.key } : pending.entities.product,
        employee: clarification.kind === "employee" ? { id: resolved.key, name: candidate?.name ?? resolved.key } : pending.entities.employee,
      };
      pending.entities = entities;
      session.pendingIntent = null;
      if (this.isActionIntent(pending)) {
        return this.continueWithIntent(session, pending);
      }
      return await this.executeQuery(session, pending);
    }

    return {
      text: `Got it. ${candidate?.name ?? resolved.key} is noted. What would you like to do next?`,
      module: "clarification",
      intent: null,
      state: session.activeWorkflow ? "collecting" : "idle",
      workflowId: session.activeWorkflow?.id ?? null,
      performed: null,
      revertedAction: null,
      clarification: null,
      memory: this.memory.snapshot(session),
    };
  }

  // ─── Commands ──────────────────────────────────────────────────────────────

  private async handleCommand(
    session: AssistantSession,
    command: { command: "undo" | "repeat" | "continue" | "cancel" | "resume"; target?: string }
  ): Promise<AssistantResponse> {
    switch (command.command) {
      case "undo":
        return this.handleUndo(session);
      case "repeat":
        return this.handleRepeat(session);
      case "continue":
        return this.handleContinue(session);
      case "cancel":
        return this.handleCancel(session);
      case "resume":
        return this.handleResume(session);
    }
  }

  private async handleUndo(session: AssistantSession): Promise<AssistantResponse> {
    if (session.pendingClarification) {
      session.pendingClarification = null;
      session.pendingIntent = null;
      return this.okResponse(
        session,
        "Clarification dismissed. Say continue to pick up where you left off.",
        "idle",
        "undo"
      );
    }
    const workflow = session.activeWorkflow;
    if (workflow) {
      const undone = this.workflows.undoLastAnswer(workflow);
      if (undone.field) {
        return this.okResponse(
          session,
          `Undid "${undone.field.replace(/_/g, " ")}". ${undone.question ?? "All fields collected — confirm to proceed."}`,
          workflow.awaitingConfirmation ? "awaiting_confirmation" : "collecting",
          "undo"
        );
      }
    }
    const lastAction = this.memory.getLastAction(session.sessionId);
    if (lastAction) {
      return await this.revertAction(session, lastAction);
    }
    return this.okResponse(session, "Nothing to undo yet.", "idle", "undo");
  }

  private async revertAction(session: AssistantSession, record: ActionRecord): Promise<AssistantResponse> {
    const canRevertStaff =
      record.module === "staff" && (record.intent === "assign_staff" || record.intent === "remove_staff" || record.intent === "reassign_staff");
    const canRevertCustomer =
      record.module === "customers" &&
      (record.intent === "create_customer" || record.intent === "update_customer" || record.intent === "delete_customer");
    const canRevertSupplier =
      record.module === "suppliers" &&
      (record.intent === "create_supplier" || record.intent === "update_supplier" || record.intent === "delete_supplier");
    if (!canRevertStaff && !canRevertCustomer && !canRevertSupplier) {
      return this.okResponse(
        session,
        `That ${record.intent.replace(/_/g, " ")} is already completed and can't be undone.`,
        "idle",
        "undo"
      );
    }
    const payload = record.payload;
    let result: { ok: boolean; message: string };
    if (canRevertCustomer) {
      if (record.intent === "create_customer") {
        result = await this.executor.executeAction("delete_customer", { customer_id: payload.customer_id });
      } else if (record.intent === "delete_customer") {
        result = await this.executor.executeAction("create_customer", { ...(record.previousCustomer ?? {}) });
      } else {
        result = await this.executor.executeAction("update_customer", {
          customer_id: payload.customer_id,
          ...(record.previousCustomer ?? {}),
        });
      }
    } else if (canRevertSupplier) {
      if (record.intent === "create_supplier") {
        result = await this.executor.executeAction("delete_supplier", { supplier_id: payload.supplier_id });
      } else if (record.intent === "delete_supplier") {
        result = await this.executor.executeAction("create_supplier", { ...(record.previousSupplier ?? {}) });
      } else {
        result = await this.executor.executeAction("update_supplier", {
          supplier_id: payload.supplier_id,
          ...(record.previousSupplier ?? {}),
        });
      }
    } else if (record.intent === "assign_staff") {
      result = await this.executor.executeAction("remove_staff", { employee_id: payload.employee_id });
    } else if (record.intent === "remove_staff" || record.intent === "reassign_staff") {
      result = await this.executor.executeAction("reassign_staff", {
        employee_id: payload.employee_id,
        area: record.previousArea ?? payload.area,
      });
    } else {
      return this.okResponse(session, "That action can't be undone.", "idle", "undo");
    }
    if (result.ok) {
      this.memory.markActionReverted(session.sessionId, record.id);
      return this.okResponse(session, `${result.message} Undo complete.`, "idle", "undo", record);
    }
    return this.okResponse(session, `Couldn't undo: ${result.message}`, "error", "undo", record);
  }

  private handleRepeat(session: AssistantSession): AssistantResponse {
    const workflow = session.activeWorkflow;
    if (workflow?.awaitingConfirmation) {
      return this.okResponse(
        session,
        `Here's the summary again:\n${workflow.confirmationSummary}\n\nReply yes to confirm or no to change anything.`,
        "awaiting_confirmation",
        "repeat"
      );
    }
    if (workflow && workflow.nextField) {
      const question = this.workflows.questionFor(workflow, workflow.nextField);
      return this.okResponse(session, question, "collecting", "repeat");
    }
    const lastAssistant = session.lastAssistantMessage;
    if (lastAssistant) {
      return this.okResponse(session, `As I said: ${lastAssistant}`, "idle", "repeat");
    }
    return this.okResponse(session, "Nothing to repeat yet.", "idle", "repeat");
  }

  private handleContinue(session: AssistantSession): AssistantResponse {
    if (session.pendingClarification) {
      return this.okResponse(
        session,
        this.clarification.formatQuestion(session.pendingClarification),
        "clarifying",
        "continue"
      );
    }
    const workflow = session.activeWorkflow;
    if (workflow && workflow.status === "active") {
      if (workflow.awaitingConfirmation) {
        return this.okResponse(
          session,
          `Here's the summary:\n${workflow.confirmationSummary}\n\nReply yes to confirm or no to change anything.`,
          "awaiting_confirmation",
          "continue"
        );
      }
      const next = this.workflows.resume(workflow);
      return this.okResponse(session, next.question ?? "Workflow is complete.", "collecting", "continue");
    }
    if (session.pausedWorkflows.length > 0) {
      const workflow = session.pausedWorkflows.pop()!;
      workflow.status = "active";
      session.activeWorkflow = workflow;
      const next = this.workflows.resume(workflow);
      return this.okResponse(
        session,
        `Resuming your pending ${workflow.actionType.replace(/_/g, " ")}.\n${next.question ?? workflow.confirmationSummary}`,
        workflow.awaitingConfirmation ? "awaiting_confirmation" : "collecting",
        "continue"
      );
    }
    return this.okResponse(session, "Nothing to continue right now.", "idle", "continue");
  }

  private handleCancel(session: AssistantSession): AssistantResponse {
    if (session.pendingClarification) {
      session.pendingClarification = null;
      session.pendingIntent = null;
    }
    const workflow = session.activeWorkflow;
    if (workflow) {
      workflow.status = "cancelled";
      workflow.updatedAt = new Date().toISOString();
      session.workflowHistory.unshift(workflow);
      session.activeWorkflow = null;
      return this.okResponse(session, "Cancelled. Your workflow has been cleared.", "idle", "cancel");
    }
    return this.okResponse(session, "Nothing to cancel.", "idle", "cancel");
  }

  private handleResume(session: AssistantSession): AssistantResponse {
    const paused = session.pausedWorkflows;
    if (paused.length > 0) {
      const workflow = paused.pop()!;
      workflow.status = "active";
      session.activeWorkflow = workflow;
      const next = this.workflows.resume(workflow);
      return this.okResponse(
        session,
        `Resuming your ${workflow.actionType.replace(/_/g, " ")}.\n${next.question ?? workflow.confirmationSummary}`,
        workflow.awaitingConfirmation ? "awaiting_confirmation" : "collecting",
        "resume"
      );
    }
    const recent = session.workflowHistory.filter((w) => w.status === "cancelled" || w.status === "completed");
    if (recent.length > 0) {
      const last = recent[0];
      last.status = "active";
      last.awaitingConfirmation = false;
      last.error = null;
      session.activeWorkflow = last;
      const next = this.workflows.resume(last);
      if (!next.question) {
        last.awaitingConfirmation = true;
        last.confirmationSummary = this.formatWorkflowSummary(last);
        return this.okResponse(
          session,
          `Restored your last ${last.actionType.replace(/_/g, " ")}.\n${last.confirmationSummary}\n\nReply yes to confirm.`,
          "awaiting_confirmation",
          "resume"
        );
      }
      return this.okResponse(
        session,
        `Restored your last ${last.actionType.replace(/_/g, " ")}.\n${next.question}`,
        "collecting",
        "resume"
      );
    }
    return this.okResponse(session, "No previous workflow to resume.", "idle", "resume");
  }

  private recentFinishedWorkflows(session: AssistantSession): Workflow[] {
    return session.workflowHistory
      .filter((w) => w.status === "cancelled" || w.status === "completed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ─── Confirmation ──────────────────────────────────────────────────────────

  private isConfirmationAnswer(session: AssistantSession, clean: string): boolean {
    const workflow = session.activeWorkflow;
    return (
      !!workflow &&
      workflow.awaitingConfirmation &&
      (YES_PATTERN.test(clean) || NO_PATTERN.test(clean))
    );
  }

  private async handleConfirmation(session: AssistantSession, clean: string): Promise<AssistantResponse> {
    const workflow = session.activeWorkflow!;
    if (NO_PATTERN.test(clean)) {
      workflow.status = "cancelled";
      workflow.updatedAt = new Date().toISOString();
      session.activeWorkflow = null;
      return this.okResponse(
        session,
        "No problem — I cancelled that. Anything else?",
        "idle",
        null
      );
    }
    session.state = "executing";
    const payload = this.enrichStaffPayload(workflow.actionType, workflow.collectedData);
    const previousCustomer = this.snapshotCustomerForAction(workflow.actionType, workflow.collectedData);
    const previousSupplier = this.snapshotSupplierForAction(workflow.actionType, workflow.collectedData);
    const result = await this.executor.executeAction(workflow.actionType, payload);
    if (!result.ok) {
      workflow.status = "failed";
      workflow.error = result.error ?? result.message;
      workflow.updatedAt = new Date().toISOString();
      session.workflowHistory.unshift(workflow);
      session.activeWorkflow = null;
      return this.okResponse(
        session,
        `Sorry, that failed: ${result.error ?? result.message}`,
        "error",
        null
      );
    }
    workflow.status = "completed";
    workflow.resultText = result.message;
    workflow.updatedAt = new Date().toISOString();
    session.workflowHistory.unshift(workflow);
    session.activeWorkflow = null;

    const record: ActionRecord = {
      id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: session.sessionId,
      workflowId: workflow.id,
      intent: workflow.actionType,
      module: workflow.module,
      summary: workflow.confirmationSummary ?? workflow.actionType,
      executedAt: new Date().toISOString(),
      status: "executed",
      payload: {
        ...workflow.collectedData,
        ...(result.id && workflow.actionType === "create_customer" ? { customer_id: result.id } : {}),
        ...(result.id && workflow.actionType === "create_supplier" ? { supplier_id: result.id } : {}),
      },
      previousArea: workflow.module === "staff" ? this.currentAreaForEmployee(workflow) : null,
      previousCustomer,
      previousSupplier,
    };
    this.memory.recordAction(session.sessionId, record);
    this.updateMemoryAfterAction(session, workflow);

    return this.okResponse(
      session,
      result.message,
      "completed",
      null,
      record,
      workflow
    );
  }

  private enrichStaffPayload(actionType: string, collectedData: Record<string, unknown>): Record<string, unknown> {
    if (actionType !== "assign_staff" && actionType !== "reassign_staff" && actionType !== "remove_staff") {
      return { ...collectedData };
    }
    const payload = { ...collectedData };
    const employeeId = String(payload.employee_id ?? "");
    if (employeeId && !payload.employee_name) {
      const staff = this.store.store.staff.get(employeeId);
      if (staff) payload.employee_name = staff.name;
    }
    return payload;
  }

  private snapshotCustomerForAction(
    actionType: string,
    data: Record<string, unknown>
  ): Record<string, unknown> | null {
    if (actionType !== "update_customer" && actionType !== "delete_customer") return null;
    const id = String(data.customer_id ?? "");
    const row = this.data.customers.find((c) => c.id === id);
    if (!row) return null;
    return {
      customer_name: row.customer_name,
      shop_name: row.shop_name ?? null,
      phone: row.phone ?? null,
      whatsapp: row.whatsapp ?? null,
      city: row.city ?? null,
      area: row.area ?? null,
      customer_type: row.customer_type ?? null,
      credit_limit: row.credit_limit ?? null,
      credit_days: row.credit_days ?? null,
    };
  }

  private snapshotSupplierForAction(
    actionType: string,
    data: Record<string, unknown>
  ): Record<string, unknown> | null {
    if (actionType !== "update_supplier" && actionType !== "delete_supplier") return null;
    const id = String(data.supplier_id ?? "");
    const row = this.data.suppliers.find((s) => s.id === id);
    if (!row) return null;
    return {
      supplier_name: row.supplier_name,
      contact_person: row.contact_person ?? null,
      phone: row.phone ?? null,
      whatsapp: row.whatsapp ?? null,
      city: row.city ?? null,
      area: row.area ?? null,
      notes: row.notes ?? null,
      credit_limit: row.credit_limit ?? null,
      credit_days: row.credit_days ?? null,
    };
  }

  private currentAreaForEmployee(workflow: Workflow): string | null {
    const assignment = getAssignmentForEmployee(String(workflow.collectedData.employee_id ?? ""));
    return assignment?.area ?? null;
  }

  private updateMemoryAfterAction(session: AssistantSession, workflow: Workflow): void {
    const data = workflow.collectedData;
    const topics = this.memory.getStringList(session, "recentTopics");
    topics.push(workflow.module);
    this.memory.rememberReference(session, "recentTopics", topics.slice(-5));
    if (workflow.actionType === "create_sale") {
      const customer = this.store.store.customers.get(String(data.customer_id ?? "")) ?? null;
      const product = this.store.store.products.get(String(data.product_id ?? "")) ?? null;
      if (customer) this.memory.rememberReference(session, "lastCustomer", { id: customer.id, name: customer.name });
      if (product) this.memory.rememberReference(session, "lastProduct", { id: product.id, name: product.name });
      const quantity = Number(data.quantity) || 0;
      const price = Number(data.selling_price) || 0;
      this.memory.rememberReference(session, "lastSale", {
        customer: customer ? { id: customer.id, name: customer.name } : null,
        product: product ? { id: product.id, name: product.name } : null,
        quantity,
        total: quantity * price,
      });
    }
    if (workflow.actionType === "create_customer" || workflow.actionType === "update_customer") {
      const id = String(data.customer_id ?? "");
      let customer: CustomerMemory | null = this.store.store.customers.get(id) ?? null;
      if (!customer && workflow.actionType === "create_customer") {
        const name = String(data.customer_name ?? "").trim();
        customer =
          [...this.store.store.customers.values()].find(
            (c) => c.name.toLowerCase() === name.toLowerCase()
          ) ?? null;
      }
      if (customer) this.memory.rememberReference(session, "lastCustomer", { id: customer.id, name: customer.name });
    }
    if (workflow.actionType === "create_supplier" || workflow.actionType === "update_supplier") {
      const id = String(data.supplier_id ?? "");
      let supplier: SupplierMemory | null = this.store.store.suppliers.get(id) ?? null;
      if (!supplier && workflow.actionType === "create_supplier") {
        const name = String(data.supplier_name ?? "").trim();
        supplier =
          [...this.store.store.suppliers.values()].find(
            (s) => s.name.toLowerCase() === name.toLowerCase()
          ) ?? null;
      }
      if (supplier) this.memory.rememberReference(session, "lastSupplier", { id: supplier.id, name: supplier.name });
    }
    if (workflow.actionType === "create_purchase") {
      const supplier = this.store.store.suppliers.get(String(data.supplier_id ?? "")) ?? null;
      const product = this.store.store.products.get(String(data.product_id ?? "")) ?? null;
      if (supplier) this.memory.rememberReference(session, "lastSupplier", { id: supplier.id, name: supplier.name });
      if (product) this.memory.rememberReference(session, "lastProduct", { id: product.id, name: product.name });
      const quantity = Number(data.quantity) || 0;
      const price = Number(data.purchase_price) || 0;
      this.memory.rememberReference(session, "lastPurchase", {
        supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
        product: product ? { id: product.id, name: product.name } : null,
        quantity,
        total: quantity * price,
      });
    }
  }

  // ─── Field answers (multi-step collection) ─────────────────────────────────

  private tryFieldAnswer(session: AssistantSession, clean: string): AssistantResponse | null {
    const workflow = session.activeWorkflow;
    if (!workflow || workflow.status !== "active" || workflow.awaitingConfirmation || !workflow.nextField) {
      return null;
    }
    const candidate = this.router.classify(clean);
    if (candidate.module !== "general" && this.isActionIntent(candidate)) {
      return null;
    }
    const field = workflow.nextField;
    const value = this.extractFieldValue(field, clean, candidate.entities);
    if (value === null || value === undefined) {
      return null;
    }
    this.rememberEntities(session, candidate.entities);
    const applied = this.workflows.applyAnswer(workflow, field, value, (f, v) => this.formatFieldValue(f, v));
    this.prefillPriceIfApplicable(workflow);
    if (applied.complete) {
      workflow.awaitingConfirmation = true;
      workflow.confirmationSummary = this.formatWorkflowSummary(workflow);
      return this.okResponse(
        session,
        `Here's what I've put together:\n${workflow.confirmationSummary}\n\nReply yes to confirm.`,
        "awaiting_confirmation",
        null,
        null,
        workflow
      );
    }
    return this.okResponse(session, applied.question!, "collecting", null, null, workflow);
  }

  private prefillPriceIfApplicable(workflow: Workflow): void {
    if (workflow.actionType === "create_sale") {
      const productId = String(workflow.collectedData.product_id ?? "");
      const hasPrice = workflow.collectedData.selling_price !== undefined && workflow.collectedData.selling_price !== "";
      if (productId && !hasPrice) {
        const product = this.store.store.products.get(productId);
        if (product && product.defaultSellingPrice > 0) {
          this.workflows.applyAnswer(workflow, "selling_price", product.defaultSellingPrice, (f, v) => this.formatFieldValue(f, v));
        }
      }
    }
    if (workflow.actionType === "create_purchase") {
      const productId = String(workflow.collectedData.product_id ?? "");
      const hasPrice = workflow.collectedData.purchase_price !== undefined && workflow.collectedData.purchase_price !== "";
      if (productId && !hasPrice) {
        const product = this.store.store.products.get(productId);
        if (product && product.lastPurchasePrice > 0) {
          this.workflows.applyAnswer(workflow, "purchase_price", product.lastPurchasePrice, (f, v) => this.formatFieldValue(f, v));
        }
      }
    }
  }

  private extractFieldValue(field: string, clean: string, entities: ResolvedEntities): unknown {
    const base = entityValue(entities, field);
    if (base !== null && base !== undefined) return base;
    switch (field) {
      case "quantity": {
        const q = extractQuantity(clean);
        if (q !== null) return q;
        return extractBareNumber(clean);
      }
      case "selling_price":
      case "purchase_price": {
        const p = extractPrice(clean);
        if (p !== null) return p;
        return extractBareNumber(clean);
      }
      case "customer_name":
      case "shop_name": {
        const fragment = extractCustomerNameFragment(clean);
        if (!fragment) return null;
        return fragment
          .split(/\s+/)
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" ");
      }
      case "supplier_name": {
        const trimmed = clean.trim();
        const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
        if (
          tokens.length >= 1 &&
          tokens.length <= 3 &&
          !/\b(add|create|new|register|update|change|edit|delete|remove|banao|bana|karo|karein|hatay|hatao|show|find|search|tell|what|which|who|how|please)\b/.test(trimmed)
        ) {
          return tokens.map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
        }
        const fragment = extractSupplierNameFragment(clean);
        if (!fragment) return null;
        return fragment
          .split(/\s+/)
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" ");
      }
      case "contact_person": {
        const match = clean.match(/(?:contact person|representative|contact)\s*(?:is|name|n)?\s*[:=]?\s*(?:to\s+)?([a-z][a-z .'\-]{1,40})/i);
        if (match) return match[1].trim();
        const skip = clean
          .replace(/\b(contact person|representative|contact|is|name|the|ka naam)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        return skip.length >= 2 && skip.split(/\s+/).length <= 3 ? skip : null;
      }
      case "credit_limit": {
        const limit = extractCreditLimit(clean);
        if (limit !== null) return limit;
        return extractBareNumber(clean);
      }
      case "customer_type": {
        return extractCustomerType(clean);
      }
      case "phone": {
        return extractPhone(clean);
      }
      default:
        return null;
    }
  }

  // ─── Intent handling ───────────────────────────────────────────────────────

  private async handleIntent(session: AssistantSession, intent: AssistantIntent): Promise<AssistantResponse> {
    if (intent.module === "general") {
      return this.executeQuery(session, intent);
    }

    const entities = this.references.resolve(session, intent.raw.toLowerCase(), intent.entities);

    if (!this.isActionIntent(intent)) {
      const ambiguous = this.findAmbiguousQueryEntity(session, intent, entities);
      if (ambiguous) {
        session.pendingClarification = ambiguous.clarification;
        session.pendingIntent = intent;
        return {
          text: this.clarification.formatQuestion(ambiguous.clarification),
          module: "clarification",
          intent: intent.actionType,
          state: "clarifying",
          workflowId: session.activeWorkflow?.id ?? null,
          performed: null,
          revertedAction: null,
          clarification: ambiguous.clarification,
          memory: this.memory.snapshot(session),
        };
      }
      this.rememberEntities(session, entities);
      intent.entities = entities;
      return this.executeQuery(session, intent);
    }

    return this.handleActionIntent(session, intent);
  }

  private isActionIntent(intent: AssistantIntent): boolean {
    return (
      intent.actionType !== "inventory_query" &&
      intent.actionType !== "staff_query" &&
      intent.actionType !== "location_query" &&
      intent.actionType !== "customer_query" &&
      intent.actionType !== "supplier_query" &&
      intent.actionType !== "business_query"
    );
  }

  private handleActionIntent(session: AssistantSession, intent: AssistantIntent): AssistantResponse {
    const entities = this.references.resolve(session, intent.raw.toLowerCase(), intent.entities);

    const ambiguous = this.findAmbiguousEntity(session, intent, entities);
    if (ambiguous) {
      session.pendingClarification = ambiguous.clarification;
      session.pendingIntent = intent;
      return {
        text: this.clarification.formatQuestion(ambiguous.clarification),
        module: "clarification",
        intent: intent.actionType,
        state: "clarifying",
        workflowId: session.activeWorkflow?.id ?? null,
        performed: null,
        revertedAction: null,
        clarification: ambiguous.clarification,
        memory: this.memory.snapshot(session),
      };
    }

    return this.continueWithIntent(session, intent, entities);
  }

  private continueWithIntent(
    session: AssistantSession,
    intent: AssistantIntent,
    resolvedEntities?: ResolvedEntities
  ): AssistantResponse {
    const entities = resolvedEntities ?? intent.entities;
    intent.entities = entities;

    if (
      (intent.actionType === "create_sale" || intent.actionType === "create_purchase") &&
      entities.quantity === null
    ) {
      const bare = extractBareNumber(intent.raw);
      if (bare !== null) entities.quantity = bare;
    }

    this.rememberEntities(session, entities);
    const active = session.activeWorkflow;

    if (active && active.status === "active" && active.actionType === intent.actionType) {
      return this.continueWorkflow(session, active, intent);
    }

    if (active && active.status === "active") {
      this.workflows.pause(active);
      session.pausedWorkflows.push(active);
    }

    const prefill = this.buildPrefill(intent);
    const { workflow, question, pendingField } = this.workflows.start(
      intent.module,
      intent.actionType,
      intent.entities,
      prefill
    );
    session.activeWorkflow = workflow;

    if (pendingField === null) {
      workflow.awaitingConfirmation = true;
      workflow.confirmationSummary = this.formatWorkflowSummary(workflow);
      return this.okResponse(
        session,
        `Here's what I've put together:\n${workflow.confirmationSummary}\n\nReply yes to confirm.`,
        "awaiting_confirmation",
        null,
        null,
        workflow
      );
    }
    return this.okResponse(session, question!, "collecting", null, null, workflow);
  }

  private continueWorkflow(
    session: AssistantSession,
    workflow: Workflow,
    intent: AssistantIntent
  ): AssistantResponse {
    const entities = this.references.resolve(session, intent.raw.toLowerCase(), intent.entities);
    const ambiguous = this.findAmbiguousEntity(session, intent, entities);
    if (ambiguous) {
      session.pendingClarification = ambiguous.clarification;
      session.pendingIntent = intent;
      return {
        text: this.clarification.formatQuestion(ambiguous.clarification),
        module: "clarification",
        intent: intent.actionType,
        state: "clarifying",
        workflowId: workflow.id,
        performed: null,
        revertedAction: null,
        clarification: ambiguous.clarification,
        memory: this.memory.snapshot(session),
      };
    }

    const field = workflow.nextField;
    if (!field) {
      workflow.awaitingConfirmation = true;
      workflow.confirmationSummary = this.formatWorkflowSummary(workflow);
      return this.okResponse(
        session,
        `Here's what I've put together:\n${workflow.confirmationSummary}\n\nReply yes to confirm.`,
        "awaiting_confirmation",
        null,
        null,
        workflow
      );
    }

    const value = entityValue(entities, field);
    if (value === null || value === undefined) {
      return this.okResponse(
        session,
        `I still need: ${this.workflows.questionFor(workflow, field)}`,
        "collecting",
        null,
        null,
        workflow
      );
    }

    const applied = this.workflows.applyAnswer(workflow, field, value, (f, v) => this.formatFieldValue(f, v));
    this.prefillPriceIfApplicable(workflow);
    if (applied.complete) {
      workflow.awaitingConfirmation = true;
      workflow.confirmationSummary = this.formatWorkflowSummary(workflow);
      return this.okResponse(
        session,
        `Here's what I've put together:\n${workflow.confirmationSummary}\n\nReply yes to confirm.`,
        "awaiting_confirmation",
        null,
        null,
        workflow
      );
    }
    return this.okResponse(session, applied.question!, "collecting", null, null, workflow);
  }

  private buildPrefill(intent: AssistantIntent): Record<string, unknown> {
    const prefill: Record<string, unknown> = {};
    if (intent.actionType === "create_sale" && intent.entities.product && intent.entities.sellingPrice === null) {
      const product = this.store.store.products.get(intent.entities.product.id);
      if (product) prefill.selling_price = product.defaultSellingPrice;
    }
    if (intent.actionType === "create_purchase" && intent.entities.product && intent.entities.purchasePrice === null) {
      const product = this.store.store.products.get(intent.entities.product.id);
      if (product) prefill.purchase_price = product.lastPurchasePrice;
    }
    if (intent.actionType === "create_customer") {
      const name = intent.entities.customer?.name ?? extractCustomerNameFragment(intent.raw);
      if (name) {
        prefill.customer_name = name
          .split(/\s+/)
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" ");
      }
    }
    if (intent.actionType === "create_supplier") {
      const name = intent.entities.supplier?.name ?? extractSupplierNameFragment(intent.raw);
      if (name) {
        prefill.supplier_name = name
          .split(/\s+/)
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" ");
      }
    }
    if (intent.actionType === "update_supplier") {
      const contactPerson = this.extractFieldValue("contact_person", intent.raw.toLowerCase(), intent.entities);
      if (typeof contactPerson === "string" && contactPerson.length >= 2) {
        prefill.contact_person = contactPerson
          .split(/\s+/)
          .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" ");
      }
    }
    if (intent.entities.paymentType) prefill.payment_type = intent.entities.paymentType;
    if (intent.entities.creditDays !== null) prefill.credit_days = intent.entities.creditDays;
    return prefill;
  }

  private findAmbiguousQueryEntity(
    session: AssistantSession,
    intent: AssistantIntent,
    entities: ResolvedEntities
  ): { clarification: NonNullable<AssistantResponse["clarification"]> } | null {
    const wantsEmployee =
      (intent.module === "location") ||
      (intent.module === "staff" && intent.queryType === "find_employee");
    if (!wantsEmployee || entities.employee) return null;

    const fragment = this.extractNameFragment(intent.raw, [
      "where", "is", "was", "are", "where's", "whereis", "track", "find", "locate", "location",
      "of", "ka", "ke", "ki", "kahan", "kaha", "hai", "hain", "kya", "par", "se", "me", "mein",
      "who", "who's", "whose", "show", "tell", "the", "a", "an", "to", "from", "in", "at", "on",
      "for", "with", "duty", "assign", "reassign", "remove", "staff", "employee", "karmi",
      "worker", "order", "sell", "buy", "new", "create", "record", "sale", "purchase", "stock",
      "which", "what", "how", "much", "many", "please", "do", "does", "did",
      "gulberg", "johar", "dha", "township", "iqbal", "model", "bahria", "defence", "phase", "iii",
    ]);
    if (!fragment) return null;

    const resolved = this.store.resolveEmployee(fragment);
    if (resolved.candidates.length > 1) {
      return this.employeeClarification(fragment, resolved.candidates);
    }
    if (resolved.resolved) {
      entities.employee = resolved.resolved;
      this.rememberEntities(session, entities);
    }
    return null;
  }

  private employeeClarification(
    fragment: string,
    candidates: Array<{ key: string; name: string; detail: string }>
  ): { clarification: NonNullable<AssistantResponse["clarification"]> } {
    return {
      clarification: {
        id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "employee",
        question: `I found more than one employee matching "${fragment}". Which one do you mean?`,
        candidates,
        context: {},
      },
    };
  }

  private extractNameFragment(message: string, extraStop: string[]): string | null {
    const STOP = new Set([
      "where", "is", "was", "are", "where's", "whereis", "track", "find", "locate", "location",
      "of", "ka", "ke", "ki", "kahan", "kaha", "hai", "hain", "kya", "par", "se", "me", "mein",
      "who", "who's", "whose", "show", "tell", "the", "a", "an", "to", "from", "in", "at", "on",
      "for", "with", "duty", "assign", "reassign", "remove", "staff", "employee", "karmi",
      "worker", "order", "sell", "buy", "new", "create", "record", "sale", "purchase", "stock",
      "which", "what", "how", "much", "many", "please", "do", "does", "did",
      "gulberg", "johar", "dha", "township", "iqbal", "model", "bahria", "defence", "phase", "iii",
      ...extraStop,
    ]);
    const words = message
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length > 0 && !STOP.has(w));
    return words.length > 0 ? words.join(" ") : null;
  }

  private findAmbiguousEntity(
    session: AssistantSession,
    intent: AssistantIntent,
    entities: ResolvedEntities
  ): { clarification: NonNullable<AssistantResponse["clarification"]> } | null {
    if (
      (intent.actionType === "assign_staff" ||
        intent.actionType === "reassign_staff" ||
        intent.actionType === "remove_staff") &&
      !entities.employee
    ) {
      const fragment = this.extractNameFragment(intent.raw, ["assign", "to", "reassign", "remove", "from", "area", "duty", "gulberg", "johar", "dha", "township", "iqbal", "model", "bahria", "defence", "phase", "iii", "par", "karo", "lagao", "hatao"]);
      if (fragment) {
        const resolved = this.store.resolveEmployee(fragment);
        if (resolved.candidates.length > 1) {
          return this.employeeClarification(fragment, resolved.candidates);
        }
        if (resolved.resolved) entities.employee = resolved.resolved;
      }
    }
    if (intent.actionType === "create_sale" && !entities.customer) {
      const fragment = this.extractNameFragment(intent.raw, ["sell", "sale", "record", "create", "to", "for", "cash", "credit", "bech", "karo", "bana", "banao", "new"]);
      if (fragment) {
        const resolved = this.store.resolveCustomer(fragment);
        if (resolved.candidates.length > 1) {
          return {
            clarification: {
              id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "customer",
              question: `I found more than one customer matching "${fragment}". Which one do you mean?`,
              candidates: resolved.candidates,
              context: {},
            },
          };
        }
        if (resolved.resolved) entities.customer = resolved.resolved;
      }
    }
    if (
      (intent.actionType === "update_customer" || intent.actionType === "delete_customer") &&
      !entities.customer
    ) {
      const fragment = this.extractNameFragment(intent.raw, [
        "update", "change", "edit", "badal", "upgrade", "delete", "remove", "hata", "hatao", "hatay",
        "khatam", "customer", "client", "gahak", "kharidar", "khareedar", "karo", "karein", "please",
        "the", "to", "of", "ki", "ka", "ke", "credit", "limit", "phone", "shop", "store",
      ]);
      if (fragment) {
        const resolved = this.store.resolveCustomer(fragment);
        if (resolved.candidates.length > 1) {
          return {
            clarification: {
              id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "customer",
              question: `I found more than one customer matching "${fragment}". Which one do you mean?`,
              candidates: resolved.candidates,
              context: {},
            },
          };
        }
        if (resolved.resolved) entities.customer = resolved.resolved;
      }
    }
    if (intent.actionType === "create_purchase" && !entities.supplier) {
      const fragment = this.extractNameFragment(intent.raw, ["order", "purchase", "from", "to", "for", "buy", "khareed", "karo", "new", "create", "stock", "bharo"]);
      if (fragment) {
        const resolved = this.store.resolveSupplier(fragment);
        if (resolved.candidates.length > 1) {
          return {
            clarification: {
              id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "supplier",
              question: `I found more than one supplier matching "${fragment}". Which one do you mean?`,
              candidates: resolved.candidates,
              context: {},
            },
          };
        }
        if (resolved.resolved) entities.supplier = resolved.resolved;
      }
    }
    if (
      (intent.actionType === "update_supplier" || intent.actionType === "delete_supplier") &&
      !entities.supplier
    ) {
      const fragment = this.extractNameFragment(intent.raw, [
        "update", "change", "edit", "badal", "upgrade", "delete", "remove", "hata", "hatao", "hatay",
        "khatam", "supplier", "vendor", "furnisher", "thoker", "thokar", "karo", "karein", "please",
        "the", "to", "of", "ki", "ka", "ke", "credit", "limit", "phone", "contact", "person",
        "whatsapp", "city", "area", "notes", "is", "its",
      ]);
      if (fragment) {
        const resolved = this.store.resolveSupplier(fragment);
        if (resolved.candidates.length > 1) {
          return {
            clarification: {
              id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "supplier",
              question: `I found more than one supplier matching "${fragment}". Which one do you mean?`,
              candidates: resolved.candidates,
              context: {},
            },
          };
        }
        if (resolved.resolved) entities.supplier = resolved.resolved;
      }
    }
    if (
      (intent.actionType === "create_sale" || intent.actionType === "create_purchase") &&
      !entities.product
    ) {
      const fragment = this.extractNameFragment(intent.raw, ["sell", "sale", "record", "create", "to", "for", "cash", "credit", "bech", "karo", "bana", "banao", "new", "order", "purchase", "from", "buy", "khareed", "stock", "bharo"]);
      if (fragment) {
        const resolved = this.store.resolveProduct(fragment);
        if (resolved.candidates.length > 1) {
          return {
            clarification: {
              id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "product",
              question: `I found more than one product matching "${fragment}". Which one do you mean?`,
              candidates: resolved.candidates,
              context: {},
            },
          };
        }
        if (resolved.resolved) entities.product = resolved.resolved;
      }
    }

    const checks: Array<{
      kind: "customer" | "supplier" | "product" | "employee";
      name: string | null;
      module: string;
      resolve: (name: string) => { resolved: EntityRef | null; candidates: Array<{ key: string; name: string; detail: string }> };
    }> = [
      {
        kind: "customer",
        name: entities.customer?.name ?? null,
        module: "create_sale",
        resolve: (name) => this.store.resolveCustomer(name),
      },
      {
        kind: "supplier",
        name: entities.supplier?.name ?? null,
        module: "create_purchase",
        resolve: (name) => this.store.resolveSupplier(name),
      },
      {
        kind: "product",
        name: entities.product?.name ?? null,
        module: "sales|purchases|inventory",
        resolve: (name) => this.store.resolveProduct(name),
      },
      {
        kind: "employee",
        name: entities.employee?.name ?? null,
        module: "staff|location",
        resolve: (name) => this.store.resolveEmployee(name),
      },
    ];

    for (const check of checks) {
      if (!check.name) continue;
      const moduleRe = new RegExp(check.module);
      if (!moduleRe.test(intent.module)) continue;
      const resolved = check.resolve(check.name);
      if (resolved.candidates.length > 1) {
        return {
          clarification: {
            id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            kind: check.kind,
            question:
              check.kind === "employee"
                ? `I found more than one ${check.kind} named "${check.name}". Which one do you mean?`
                : `There are a few "${check.name}" entries. Which one do you mean?`,
            candidates: resolved.candidates,
            context: {},
          },
        };
      }
      if (resolved.candidates.length === 1 && !resolved.resolved) {
        // Single fuzzy candidate: use it directly (deterministic resolution).
        const candidate = resolved.candidates[0];
        const ref: EntityRef = { id: candidate.key, name: candidate.name };
        if (check.kind === "customer") entities.customer = ref;
        if (check.kind === "supplier") entities.supplier = ref;
        if (check.kind === "product") entities.product = ref;
        if (check.kind === "employee") entities.employee = ref;
        this.rememberEntities(session, entities);
      }
    }
    return null;
  }

  private async executeQuery(session: AssistantSession, intent: AssistantIntent): Promise<AssistantResponse> {
    const text = await this.executor.executeQuery(
      this.store.store,
      intent,
      this.getBusinessSummary(),
      this.memory.getRecentUserMessages(session, 3).join("\n")
    );
    const workflow = session.activeWorkflow;
    if (workflow && workflow.status === "active") {
      if (workflow.awaitingConfirmation) {
        const reminder = `\n\nMeanwhile, you still have a ${workflow.actionType.replace(/_/g, " ")} waiting for your confirmation. Say "yes" to proceed or "cancel" to dismiss it.`;
        return this.okResponse(session, text + reminder, "awaiting_confirmation", null, null, workflow, intent.module);
      }
      if (workflow.nextField) {
        const reminder = `\n\nBy the way, we still need to finish your ${workflow.actionType.replace(/_/g, " ")}: ${this.workflows.questionFor(workflow, workflow.nextField)}`;
        return this.okResponse(session, text + reminder, "collecting", null, null, workflow, intent.module);
      }
    }
    return this.okResponse(session, text, "idle", null, null, workflow ?? null, intent.module);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private rememberEntities(session: AssistantSession, entities: ResolvedEntities): void {
    if (entities.customer) this.memory.rememberReference(session, "lastCustomer", entities.customer);
    if (entities.supplier) this.memory.rememberReference(session, "lastSupplier", entities.supplier);
    if (entities.product) this.memory.rememberReference(session, "lastProduct", entities.product);
    if (entities.employee) this.memory.rememberReference(session, "lastEmployee", entities.employee);
    if (entities.area) this.memory.rememberReference(session, "lastArea", entities.area);
  }

  private formatWorkflowSummary(workflow: Workflow): string {
    let summary = this.workflows.formatSummary(workflow, (field, value) => this.formatFieldValue(field, value));
    const data = workflow.collectedData;
    const idToName: Record<string, string> = {
      customer_name: data.customer_id ? this.store.store.customers.get(String(data.customer_id))?.name ?? String(data.customer_id) : "",
      product_name: data.product_id ? this.store.store.products.get(String(data.product_id))?.name ?? String(data.product_id) : "",
      supplier_name: data.supplier_id ? this.store.store.suppliers.get(String(data.supplier_id))?.name ?? String(data.supplier_id) : "",
      employee_name: data.employee_id ? this.store.store.staff.get(String(data.employee_id))?.name ?? String(data.employee_id) : "",
    };
    for (const [token, name] of Object.entries(idToName)) {
      if (name) summary = summary.replace(new RegExp(`\\{${token}\\}`, "g"), name);
    }
    return summary;
  }

  private formatFieldValue(field: string, value: unknown): string {
    switch (field) {
      case "customer_id":
        return this.store.store.customers.get(String(value))?.name ?? String(value);
      case "supplier_id":
        return this.store.store.suppliers.get(String(value))?.name ?? String(value);
      case "product_id":
        return this.store.store.products.get(String(value))?.name ?? String(value);
      case "employee_id":
        return this.store.store.staff.get(String(value))?.name ?? String(value);
      case "quantity":
        return `${value} units`;
      case "selling_price":
      case "purchase_price":
        return `Rs ${value}`;
      case "payment_type":
        return value === "cash" ? "Cash" : "Credit";
      default:
        return String(value);
    }
  }

  private okResponse(
    session: AssistantSession,
    text: string,
    state: AssistantResponse["state"],
    performed: AssistantResponse["performed"],
    revertedAction: ActionRecord | null = null,
    workflow: Workflow | null = session.activeWorkflow,
    module?: AssistantResponse["module"]
  ): AssistantResponse {
    return {
      text,
      module: module ?? (performed ? "command" : workflow ? (workflow.module as AssistantResponse["module"]) : "general"),
      intent: workflow?.actionType ?? null,
      state,
      workflowId: workflow?.id ?? null,
      performed,
      revertedAction,
      clarification: null,
      memory: this.memory.snapshot(session),
    };
  }

  private errorResponse(session: AssistantSession, error: string): AssistantResponse {
    return {
      text: `Something went wrong: ${error}`,
      module: "general",
      intent: null,
      state: "error",
      workflowId: session.activeWorkflow?.id ?? null,
      performed: null,
      revertedAction: null,
      clarification: null,
      memory: this.memory.snapshot(session),
    };
  }

  getMemorySnapshot(sessionId: string): MemorySnapshot {
    return this.memory.snapshot(this.memory.getSession(sessionId));
  }

  getActionLog(sessionId: string): ActionRecord[] {
    return this.memory.getActionLog(sessionId);
  }
}
