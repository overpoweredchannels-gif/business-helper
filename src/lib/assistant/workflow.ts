import {
  getActionSchema,
} from "../ai/conversation-engine";
import type { Workflow, ModuleKind, ActionType, AssistantIntent, ResolvedEntities } from "./types";

/**
 * Workflow engine. Multi-step data collection driven by the existing
 * action schemas (reused from the Conversation Engine — read-only), with
 * a paused-workflow stack for context switching between modules.
 */
export class WorkflowEngine {
  start(
    module: ModuleKind,
    actionType: ActionType,
    entities: ResolvedEntities,
    prefill: Record<string, unknown> = {}
  ): { workflow: Workflow; question: string | null; pendingField: string | null } {
    const schema = getActionSchema(actionType);
    const workflow: Workflow = {
      id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      module,
      actionType,
      collectedData: {},
      nextField: null,
      status: "active",
      answers: [],
      awaitingConfirmation: false,
      confirmationSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resultText: null,
      error: null,
    };

    const hints: Record<string, unknown> = {};
    if (entities.customer) hints.customer_id = entities.customer.id;
    if (entities.supplier) hints.supplier_id = entities.supplier.id;
    if (entities.product) hints.product_id = entities.product.id;
    if (entities.employee) hints.employee_id = entities.employee.id;
    if (entities.quantity !== null) hints.quantity = entities.quantity;
    if (entities.sellingPrice !== null) hints.selling_price = entities.sellingPrice;
    if (entities.purchasePrice !== null) hints.purchase_price = entities.purchasePrice;
    if (entities.paymentType) hints.payment_type = entities.paymentType;
    if (entities.creditDays !== null) hints.credit_days = entities.creditDays;
    if (entities.notes) hints.notes = entities.notes;
    if (entities.area) hints.area = entities.area;
    if (entities.role) hints.role = entities.role;
    const schemaFields = getActionSchema(actionType).fieldDefinitions;
    if (entities.creditLimit !== null && schemaFields["credit_limit"]) hints.credit_limit = entities.creditLimit;
    if (entities.phone && schemaFields["phone"]) hints.phone = entities.phone;
    if (entities.customerType && schemaFields["customer_type"]) hints.customer_type = entities.customerType;

    const merged = { ...prefill, ...hints };
    for (const [field, value] of Object.entries(merged)) {
      if (value === null || value === undefined || value === "") continue;
      workflow.collectedData[field] = value;
      workflow.answers.push({ field, value, label: field, answeredAt: new Date().toISOString() });
    }

    const next = this.computeNextField(workflow);
    workflow.nextField = next;
    if (next === null) {
      workflow.awaitingConfirmation = true;
      workflow.confirmationSummary = this.formatSummary(workflow, (f, v) => String(v));
    }
    return { workflow, question: next ? this.questionFor(workflow, next) : null, pendingField: next };
  }

  applyAnswer(
    workflow: Workflow,
    field: string,
    value: unknown,
    formatValue?: (field: string, value: unknown) => string
  ): { question: string | null; pendingField: string | null; complete: boolean } {
    workflow.collectedData[field] = value;
    const existing = workflow.answers.find((a) => a.field === field);
    const label = existing?.label ?? field;
    if (existing) existing.value = value;
    else workflow.answers.push({ field, value, label, answeredAt: new Date().toISOString() });
    workflow.updatedAt = new Date().toISOString();

    const next = this.computeNextField(workflow);
    workflow.nextField = next;
    if (next === null) {
      workflow.awaitingConfirmation = true;
      workflow.confirmationSummary = this.formatSummary(workflow, formatValue ?? ((f, v) => String(v)));
      return { question: null, pendingField: null, complete: true };
    }
    return { question: this.questionFor(workflow, next), pendingField: next, complete: false };
  }

  undoLastAnswer(workflow: Workflow): { field: string | null; question: string | null } {
    const last = workflow.answers.pop();
    if (!last) return { field: null, question: null };
    delete workflow.collectedData[last.field];
    workflow.awaitingConfirmation = false;
    workflow.confirmationSummary = null;
    const next = this.computeNextField(workflow);
    workflow.nextField = next;
    workflow.updatedAt = new Date().toISOString();
    return { field: last.field, question: next ? this.questionFor(workflow, next) : null };
  }

  computeNextField(workflow: Workflow): string | null {
    const schema = getActionSchema(workflow.actionType);
    for (const field of schema.requiredFields) {
      const value = workflow.collectedData[field];
      if (value === undefined || value === null || value === "") return field;
    }
    return null;
  }

  questionFor(workflow: Workflow, field: string): string {
    const schema = getActionSchema(workflow.actionType);
    const definition = schema.fieldDefinitions[field];
    if (definition?.question) return definition.question;
    return `Please provide ${schema.fieldDefinitions[field]?.label ?? field.replace(/_/g, " ")}.`;
  }

  formatSummary(
    workflow: Workflow,
    formatValue: (field: string, value: unknown) => string
  ): string {
    const schema = getActionSchema(workflow.actionType);
    let summary = schema.confirmationTemplate;
    for (const [field, value] of Object.entries(workflow.collectedData)) {
      summary = summary.replace(
        new RegExp(`\\{${field}\\}`, "g"),
        String(formatValue(field, value))
      );
    }
    return summary;
  }

  pause(workflow: Workflow): void {
    workflow.status = "paused";
    workflow.updatedAt = new Date().toISOString();
  }

  resume(workflow: Workflow): { question: string | null } {
    workflow.status = "active";
    workflow.updatedAt = new Date().toISOString();
    if (workflow.awaitingConfirmation) {
      return { question: workflow.confirmationSummary ? `Confirm? ${workflow.confirmationSummary}` : null };
    }
    const next = this.computeNextField(workflow);
    workflow.nextField = next;
    return { question: next ? this.questionFor(workflow, next) : null };
  }
}

export function intentToActionType(module: ModuleKind, intent: AssistantIntent): ActionType {
  return intent.actionType;
}
