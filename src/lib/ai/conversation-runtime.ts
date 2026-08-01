import { callAiProviderRouter } from "./provider-router";
import {
  ConversationContext,
  ConversationState,
  ActionType,
  createConversationContext,
  addConversationMessage,
  updateConversationState,
  updateCollectedData,
  getActionSchema,
  getNextRequiredField,
  hasAllRequiredFields,
  formatConfirmationSummary,
  resetConversationTimeout,
  isConversationTimedOut,
  ACTION_SCHEMAS,
  canTransition,
} from "./conversation-engine";
import { executeSaleDraft } from "./sales-executor";
import { executePurchaseDraft } from "./purchase-executor";
import { processInventoryQuery } from "./inventory-intelligence";
import type { InventoryQueryIntent } from "./inventory-intelligence";
import { processStaffQuery } from "./staff-intelligence";
import type { StaffQueryIntent } from "./staff-intelligence";
import { assignEmployee, reassignEmployee, removeEmployee, getStaffAssignments } from "./staff-executor";
import type { StaffInput, StaffResult } from "./staff-executor";
import { processLocationQuery } from "./location-intelligence";
import type { LocationQueryIntent } from "./location-intelligence";
import type { CurrentLocationView } from "../location/types";
import type { MemoryStore } from "../brain/memory/business-memory";
import type { PreferenceStore } from "../brain/learning/preference-store";
import { checkActionPermission, verifyIdentity } from "../identity/permissions";
import type { PermissionContext } from "../identity/permissions";
import { logAuditEvent } from "../identity/audit";

const CLASSIFICATION_PROMPT = `You are a TradeOS AI assistant that classifies user intent and extracts business entities.
Analyze the user's message and return a JSON object.
The user may write in English, Urdu, or Roman Urdu (or a mix).

Return JSON with:
{
  "intent": "create_sale" | "create_purchase" | "create_expense" | "create_task" | "create_customer" | "create_supplier" | "create_product" | "business_query" | "market_intelligence" | "inventory_query" | "location_query" | "staff_query" | "assign_staff" | "reassign_staff" | "remove_staff" | "cancel" | "confirm" | "unknown",
  "entities": {
    "customer_name": string | null,
    "supplier_name": string | null,
    "product_name": string | null,
    "quantity": number | null,
    "selling_price": number | null,
    "purchase_price": number | null,
    "payment_type": "cash" | "credit" | null,
    "credit_days": number | null,
    "notes": string | null,
    "query_type": "quantity_lookup" | "low_stock" | "reorder" | "below_reorder" | "out_of_stock" | "overstocked" | "inventory_value" | "category_summary" | "brand_summary" | "fast_moving" | "slow_moving" | "who_on_duty" | "who_off_duty" | "find_employee" | "staff_by_role" | "active_staff" | "inactive_staff" | "show_assignments" | "assignment_by_area" | "where_is_employee" | "all_locations" | "closest_to_area" | "who_near_area" | "not_updated" | "currently_moving" | null,
    "employee_name": string | null,
    "area": string | null,
    "role_name": string | null
  },
  "language": "english" | "urdu" | "roman_urdu",
  "confidence": number (0-1)
}

Examples:
- "Ali ko 5 carton oil de do 1500 me cash" → create_sale, customer=Ali, product=oil, qty=5, price=1500, payment=cash
- "bhai 10 kg cheeni do 120 per kg, udhar" → create_sale, product=cheeni, qty=10, price=120, payment=credit
- "create sale for Ahmad 3 cartons milk 2000 each credit" → create_sale, customer=Ahmad, product=milk, qty=3, price=2000, payment=credit
- "Khalid Stores se 20 carton oil 2500 me kharida cash" → create_purchase, supplier=Khalid, product=oil, qty=20, purchase_price=2500, payment=cash
- "supplier se 50 kg cheeni 110 per kg udhar" → create_purchase, product=cheeni, qty=50, purchase_price=110, payment=credit
- "purchase 10 cartons milk from Ahmad 1800 each credit" → create_purchase, supplier=Ahmad, product=milk, qty=10, purchase_price=1800, payment=credit
- "haal kya hai" → casual/greeting, unknown
- "yes confirm karo" → confirm
- "cancel mat karo" → cancel
- "nahi cancel" → cancel
- "sale ko confirm karo" → confirm
- "mere business ka kya haal hai" → business_query
- "kitna stock hai oil ka" → inventory_query, query_type=quantity_lookup, product=oil
- "low stock products" → inventory_query, query_type=low_stock
- "konsi cheezein khatam hone wali hain" → inventory_query, query_type=low_stock
- "out of stock items" → inventory_query, query_type=out_of_stock
- "inventory value" → inventory_query, query_type=inventory_value
- "gandum kitna bacha hai" → inventory_query, query_type=quantity_lookup, product=gandum
- "reorder kya karna hai" → inventory_query, query_type=reorder
- "reorder level" → inventory_query, query_type=below_reorder
- "fast moving items" → inventory_query, query_type=fast_moving
- "category wise stock" → inventory_query, query_type=category_summary
- "brand wise stock" → inventory_query, query_type=brand_summary
- "aj duty par kon hai" → staff_query, query_type=who_on_duty
- "who is on duty" → staff_query, query_type=who_on_duty
- "kon off duty hai" → staff_query, query_type=who_off_duty
- "Ali ko Gulberg assign karo" → assign_staff, employee_name=Ali, area=Gulberg
- "assign Ali" → assign_staff, employee_name=Ali
- "Ahmed ko DHA bhej do" → assign_staff, employee_name=Ahmed, area=DHA
- "Bilal ka duty change karo DHA" → reassign_staff, employee_name=Bilal, area=DHA
- "change Ahmed duty to Gulberg" → reassign_staff, employee_name=Ahmed, area=Gulberg
- "Bilal ko duty se hatao" → remove_staff, employee_name=Bilal
- "remove Bilal from duty" → remove_staff, employee_name=Bilal
- "aj ki assignments dikhao" → staff_query, query_type=show_assignments
- "Ali kahan hai" → location_query, query_type=where_is_employee, employee_name=Ali
- "where is Ali" → location_query, query_type=where_is_employee, employee_name=Ali
- "today staff locations" → location_query, query_type=all_locations
- "sab employees ki location dikhao" → location_query, query_type=all_locations
- "kon Gulberg ke paas hai" → location_query, query_type=who_near_area, area=Gulberg
- "who is closest to DHA" → location_query, query_type=closest_to_area, area=DHA
- "kisne location update nahi ki" → location_query, query_type=not_updated
- "kaun move kar raha hai" → location_query, query_type=currently_moving
- "kis employee ko Gulberg assign hai" → staff_query, query_type=assignment_by_area, area=Gulberg
- "salesmen dikhao" → staff_query, query_type=staff_by_role, role_name=salesman
- "available staff" → staff_query, query_type=active_staff
- "inactive staff" → staff_query, query_type=inactive_staff
- "Ahmed ko dhundo" → staff_query, query_type=find_employee, employee_name=Ahmed

For casual messages, greetings, or unclear intents, return "unknown".
For confirmation responses, return "confirm".
For cancellation, return "cancel".`;

const FIELD_EXTRACTION_PROMPT = `You are a TradeOS AI assistant. Extract the specific field value from the user's response.
The user may write in English, Urdu, or Roman Urdu.

Current field being asked: {field_label}
User response: {user_message}
Previous collected data: {collected_data}

Return JSON with:
{
  "value": the extracted value (appropriate type),
  "confidence": number (0-1),
  "clarification_needed": boolean,
  "clarification_question": string | null
}

For customer names: return string
For product names: return string
For quantity: return number
For price: return number
For payment_type: "cash" | "credit"
For notes: return string (may contain mixed language text)`;

export class ConversationRuntime {
  private sessions: Map<string, ConversationContext> = new Map();
  private store: MemoryStore | null = null;
  private prefs: PreferenceStore | null = null;
  private currentLocations: CurrentLocationView[] = [];
  private identityProvider: (() => PermissionContext | null) | null = null;

  setStore(store: MemoryStore): void {
    this.store = store;
  }

  setPrefs(prefs: PreferenceStore): void {
    this.prefs = prefs;
  }

  setCurrentLocations(locations: CurrentLocationView[]): void {
    this.currentLocations = locations;
  }

  setIdentityProvider(provider: () => PermissionContext | null): void {
    this.identityProvider = provider;
  }

  getIdentityContext(): PermissionContext | null {
    return this.identityProvider ? this.identityProvider() : null;
  }

  private permissionDenialResponse(
    context: ConversationContext,
    action: string,
    sessionId: string,
  ): { response: string; state: ConversationState; actionType: ActionType | null } {
    const identity = this.getIdentityContext();
    if (!identity) {
      return { response: "", state: "idle", actionType: null };
    }
    const identityCheck = verifyIdentity(identity);
    if (!identityCheck.valid) {
      this.resetSession(context);
      return {
        response:
          "Sorry, I couldn't verify your identity. Please sign in to your TradeOS account first, then ask me again.",
        state: "idle",
        actionType: null,
      };
    }
    const result = checkActionPermission(action, identity);
    if (result.allowed) {
      return {
        response: "",
        state: "idle",
        actionType: null,
      };
    }
    try {
      logAuditEvent({
        organizationId: identity.organizationId ?? "unknown",
        actorProfileId: identity.profileId ?? null,
        actorEmail: identity.email ?? null,
        action: "ai_action_denied",
        entityType: "ai_action",
        entityId: action,
        description: `AI action ${action} denied by permission guard.`,
        success: false,
      });
    } catch {}
    this.resetSession(context);
    return {
      response: result.message,
      state: "idle",
      actionType: null,
    };
  }

  getSession(sessionId: string): ConversationContext | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreateSession(sessionId: string, organizationId: string, profileId: string | null): ConversationContext {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = createConversationContext(sessionId, organizationId, profileId);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  async processMessage(
    message: string,
    sessionId: string,
    organizationId: string,
    profileId: string | null
  ): Promise<{ response: string; state: ConversationState; actionType: ActionType | null }> {
    let context = this.getOrCreateSession(sessionId, organizationId, profileId);

    if (isConversationTimedOut(context) && !["idle", "completed", "cancelled", "error"].includes(context.state)) {
      context = addConversationMessage(context, "system", "error", "Conversation timed out. Please start again.");
      context = updateConversationState(context, "error");
      context.error = "TIMEOUT";
      this.sessions.set(sessionId, context);
      return { response: "The conversation timed out. Please tell me what you'd like to do again.", state: "error", actionType: null };
    }

    context = resetConversationTimeout(context);
    context = addConversationMessage(context, "user", "text", message);

    if (context.state === "error") {
      const resume = await this.checkIsResume(message);
      if (resume) {
        context = this.resetSession(context);
        return await this.handleNewIntent(message, context, sessionId, organizationId, profileId);
      }
      context = addConversationMessage(context, "assistant", "text", "The previous operation failed. Say yes to try again or provide a new command.");
      this.sessions.set(sessionId, context);
      return { response: "The previous operation failed. Would you like to try again? Say yes to restart or tell me something else.", state: "error", actionType: null };
    }

    if (context.state === "completed" || context.state === "cancelled") {
      context = this.resetSession(context);
      return await this.handleNewIntent(message, context, sessionId, organizationId, profileId);
    }

    if (context.state === "idle") {
      return await this.handleNewIntent(message, context, sessionId, organizationId, profileId);
    }

    if (context.state === "waiting_for_confirmation") {
      const isConfirm = this.isExplicitConfirmation(message);
      if (isConfirm) {
        return await this.executeAction(context, sessionId);
      }
      const isExplicitCancel = this.isExplicitCancellation(message);
      if (isExplicitCancel) {
        context = addConversationMessage(context, "assistant", "text", "Alright, cancelled. What would you like to do next?");
        context = updateConversationState(context, "cancelled");
        this.sessions.set(sessionId, context);
        return { response: "Alright, cancelled. What would you like to do next?", state: "cancelled", actionType: null };
      }
      return await this.handleFieldUpdate(message, context, sessionId);
    }

    if (this.isExplicitCancellation(message)) {
      context = addConversationMessage(context, "assistant", "text", "Cancelled. What would you like to do next?");
      context = updateConversationState(context, "cancelled");
      this.sessions.set(sessionId, context);
      return { response: "Cancelled. What would you like to do next?", state: "cancelled", actionType: null };
    }

    return await this.handleFieldUpdate(message, context, sessionId);
  }

  private resetSession(context: ConversationContext): ConversationContext {
    const fresh = createConversationContext(context.sessionId, context.organizationId, context.profileId);
    this.sessions.set(context.sessionId, fresh);
    return fresh;
  }

  private isExplicitConfirmation(message: string): boolean {
    const lower = message.toLowerCase().trim();
    const confirmWords = new Set(["yes", "haan", "ha", "han", "yeah", "yep", "confirm", "theek hai", "theek", "ok", "okay", "sahi hai", "sahi", "proceed", "karo", "kar do", "ho jaye", "confirm karo", "yep"]);
    return confirmWords.has(lower) || lower.startsWith("haa") || lower === "hmm";
  }

  private isExplicitCancellation(message: string): boolean {
    const lower = message.toLowerCase().trim();
    const cancelWords = new Set(["cancel", "cancel karo", "mat karo", "ruko", "cancel kr do", "cancel kar do", "nope", "cancel krdain", "cancel krdo"]);
    return cancelWords.has(lower) || lower.startsWith("cancel ") || lower === "cancel";
  }

  private async checkIsResume(message: string): Promise<boolean> {
    const lower = message.toLowerCase().trim();
    if (["yes", "haan", "ha", "han", "yeah", "yep", "ok", "okay", "theek hai", "theek", "try again", "karo", "phir se"].includes(lower)) return true;
    return false;
  }

  private async handleNewIntent(
    message: string,
    context: ConversationContext,
    sessionId: string,
    organizationId: string,
    profileId: string | null
  ): Promise<{ response: string; state: ConversationState; actionType: ActionType | null }> {
    context = updateConversationState(context, "waiting_for_intent");

    const classification = await this.classifyIntent(message, context);

    if (!classification.ok || classification.intent === "unknown") {
      return await this.fallbackToChat(message, context, sessionId, organizationId, profileId);
    }

    context.actionType = classification.intent;
    context.collectedData = {};

    const intent = classification.intent;
    const denied = this.permissionDenialResponse(context, intent, sessionId);
    if (denied.response !== "") {
      return denied;
    }

    const entities = classification.entities || {};
    const customerName = entities.customer_name as string | undefined;
    const supplierName = entities.supplier_name as string | undefined;
    const productName = entities.product_name as string | undefined;
    if (customerName && classification.intent === "create_sale") {
      const customer = this.resolveCustomer(customerName);
      if (customer) context.collectedData.customer_id = customer.id;
      else context.collectedData["_customer_name_hint"] = customerName;
    }
    if (supplierName && classification.intent === "create_purchase") {
      const supplier = this.resolveSupplier(supplierName);
      if (supplier) context.collectedData.supplier_id = supplier.id;
      else context.collectedData["_supplier_name_hint"] = supplierName;
    }
    if (productName) {
      const product = this.resolveProduct(productName);
      if (product) context.collectedData.product_id = product.id;
      else context.collectedData["_product_name_hint"] = productName;
    }
    const employeeName = entities.employee_name as string | undefined;
    if (employeeName && ["assign_staff", "reassign_staff", "remove_staff", "staff_query"].includes(classification.intent)) {
      const employee = this.resolveEmployee(employeeName);
      if (employee) {
        context.collectedData.employee_id = employee.id;
        context.collectedData["_employee_name"] = employee.name;
      } else {
        context.collectedData["_employee_name_hint"] = employeeName;
      }
    }
    const area = entities.area as string | undefined;
    if (area && ["assign_staff", "reassign_staff"].includes(classification.intent)) {
      context.collectedData.area = area;
    }
    if (entities.quantity) context.collectedData.quantity = entities.quantity;
    if (entities.selling_price) context.collectedData.selling_price = entities.selling_price;
    if (entities.purchase_price) context.collectedData.purchase_price = entities.purchase_price;
    if (entities.payment_type) context.collectedData.payment_type = entities.payment_type;
    if (entities.credit_days && entities.payment_type === "credit") context.collectedData["credit_days"] = entities.credit_days;
    if (entities.notes) context.collectedData.notes = entities.notes;

    if (classification.intent === "inventory_query") {
      if (!this.store) {
        context = updateConversationState(context, "idle");
        this.sessions.set(sessionId, context);
        return { response: "Inventory data is not available right now. Please ensure your business data is loaded.", state: "idle", actionType: null };
      }
      const queryType = (entities.query_type as InventoryQueryIntent) || null;
      const resolvedProduct = productName ? this.store.searchProducts(productName, 0.4, 1)[0]?.item || null : null;
      const result = processInventoryQuery(queryType, productName || null, this.store);
      context = addConversationMessage(context, "assistant", "text", result.message);
      context = updateConversationState(context, "idle");
      context.actionType = null;
      this.sessions.set(sessionId, context);
      return { response: result.message, state: "idle", actionType: null };
    }

    if (classification.intent === "staff_query") {
      if (!this.store) {
        context = updateConversationState(context, "idle");
        this.sessions.set(sessionId, context);
        return { response: "Staff data is not available right now. Please ensure your business data is loaded.", state: "idle", actionType: null };
      }
      const queryType = (entities.query_type as StaffQueryIntent) || null;
      const roleName = (entities.role_name as string) || null;
      const empName = employeeName || null;
      const areaName = area || null;
      const assignments = getStaffAssignments();
      const result = processStaffQuery(queryType, empName, roleName, areaName, this.store, assignments);
      context = addConversationMessage(context, "assistant", "text", result.message);
      context = updateConversationState(context, "idle");
      context.actionType = null;
      this.sessions.set(sessionId, context);
      return { response: result.message, state: "idle", actionType: null };
    }

    if (classification.intent === "location_query") {
      const queryType = (entities.query_type as LocationQueryIntent) || null;
      const empName = employeeName || null;
      const areaName = area || null;
      const result = processLocationQuery(queryType, empName, areaName, this.currentLocations);
      context = addConversationMessage(context, "assistant", "text", result.message);
      context = updateConversationState(context, "idle");
      context.actionType = null;
      this.sessions.set(sessionId, context);
      return { response: result.message, state: "idle", actionType: null };
    }

    context = addConversationMessage(context, "system", "text", `Intent classified as: ${classification.intent}`);

    const allFields = this.getAllFields(classification.intent);
    for (const fieldKey of allFields) {
      const value = context.collectedData[fieldKey];
      if (value !== undefined && value !== null && value !== "") {
        context.pendingField = null;
      }
    }

    const nextField = getNextRequiredField(context);
    if (!nextField && hasAllRequiredFields(context)) {
      return await this.presentConfirmation(context, sessionId);
    }

    context = updateConversationState(context, this.getStateForField(nextField || ""));
    context.pendingField = nextField;
    const question = this.getQuestionForField(context, nextField);
    context = addConversationMessage(context, "assistant", "question", question, nextField || undefined);
    this.sessions.set(sessionId, context);
    return { response: question, state: context.state, actionType: context.actionType };
  }

  private async fallbackToChat(
    message: string,
    context: ConversationContext,
    sessionId: string,
    organizationId: string,
    profileId: string | null
  ): Promise<{ response: string; state: ConversationState; actionType: ActionType | null }> {
    const ctx = this.store ? this.getBusinessContextText() : "";
    const recentConv = this.store ? this.store.getConversationContext(5) : [];
    const history = recentConv.map((m) => `${m.role}: ${m.text}`).join("\n");

    const result = await callAiProviderRouter({
      task: "business_chat",
      prompt: [
        `You are the AI assistant for a Pakistani retail/wholesale business called TradeOS.`,
        `Answer the user's question concisely using the business context below.`,
        `If the user greets you, greet back and ask how you can help.`,
        `Use PKR currency formatting.`,
        ``,
        `BUSINESS CONTEXT:`,
        ctx || "(No business data loaded)",
        ``,
        history ? `RECENT CONVERSATION:\n${history}\n` : "",
        `USER: ${message}`,
        ``,
        `You can help with: creating sales, purchases, expenses, checking analytics, inventory status, etc.`,
        `If the user wants to create something, guide them to provide the details.`,
        `Response:`,
      ].join("\n"),
      temperature: 0.3,
    });

    const response = result.ok && result.text ? result.text : "Sorry, I couldn't process that. Can you please rephrase?";
    context = addConversationMessage(context, "assistant", "text", response);
    context = updateConversationState(context, "idle");
    this.sessions.set(sessionId, context);

    const store = this.store;
    if (store) {
      try {
        const writer = (store as any)["_sections"]?.conversations;
        if (writer) {
          writer.recentMessages.push({
            id: `msg_${Date.now()}`,
            role: "user" as const,
            type: "text",
            text: message,
            createdAt: new Date().toISOString(),
          });
          writer.recentMessages.push({
            id: `msg_${Date.now()}_1`,
            role: "assistant" as const,
            type: "text",
            text: response,
            createdAt: new Date().toISOString(),
          });
          if (writer.recentMessages.length > 100) {
            writer.recentMessages = writer.recentMessages.slice(-100);
          }
        }
      } catch {}
    }

    return { response, state: "idle", actionType: null };
  }

  private async classifyIntent(message: string, context: ConversationContext): Promise<{
    ok: boolean;
    intent: ActionType;
    entities: Record<string, unknown>;
    language: string;
  }> {
    try {
      const result = await callAiProviderRouter({
        task: "intent_classification",
        prompt: `${CLASSIFICATION_PROMPT}\n\nUser message: "${message}"`,
        jsonMode: true,
        temperature: 0.1,
      });

      if (result.ok && result.json) {
        const intent = result.json.intent as string;
        const validIntents: ActionType[] = ["create_sale", "create_purchase", "create_expense", "create_task", "create_customer", "create_supplier", "create_product", "business_query", "market_intelligence", "inventory_query", "location_query", "staff_query", "assign_staff", "reassign_staff", "remove_staff", "unknown"];
        const isValid = validIntents.includes(intent as ActionType);
        const language = result.json.language || "english";

        if (isValid && intent !== "unknown" && (result.json.confidence || 0) >= 0.3) {
          return {
            ok: true,
            intent: intent as ActionType,
            entities: result.json.entities || {},
            language,
          };
        }
      }
      return { ok: false, intent: "unknown", entities: {}, language: "english" };
    } catch {
      return { ok: false, intent: "unknown", entities: {}, language: "english" };
    }
  }

  private async handleFieldUpdate(
    message: string,
    context: ConversationContext,
    sessionId: string
  ): Promise<{ response: string; state: ConversationState; actionType: ActionType | null }> {
    const schema = getActionSchema(context.actionType || "unknown");
    const currentField = context.pendingField;

    if (currentField && schema.fieldDefinitions[currentField]) {
      const extracted = await this.extractFieldValue(message, currentField, context);
      if (extracted.found && extracted.value !== undefined && extracted.value !== null) {
        context.collectedData[currentField] = extracted.value;
        context = addConversationMessage(context, "assistant", "text", `Got it: ${schema.fieldDefinitions[currentField]?.label} = ${extracted.value}`, currentField, extracted.value);
      } else {
        context.collectedData[currentField] = message;
        context = addConversationMessage(context, "assistant", "text", `Got it: ${schema.fieldDefinitions[currentField]?.label} = ${message}`, currentField, message);
      }
    }

    const missingFields = this.getMissingRequiredFields(context);
    if (missingFields.length > 0) {
      let nextField = missingFields[0];
      let needFieldUpdate = true;
      for (const field of missingFields) {
        if (field === "customer_id" && context.collectedData["_customer_name_hint"]) {
          const name = context.collectedData["_customer_name_hint"] as string;
          const customer = this.resolveCustomer(name);
          if (customer) {
            context.collectedData.customer_id = customer.id;
            delete context.collectedData["_customer_name_hint"];
            needFieldUpdate = false;
            continue;
          }
        }
        if (field === "supplier_id" && context.collectedData["_supplier_name_hint"]) {
          const name = context.collectedData["_supplier_name_hint"] as string;
          const supplier = this.resolveSupplier(name);
          if (supplier) {
            context.collectedData.supplier_id = supplier.id;
            delete context.collectedData["_supplier_name_hint"];
            needFieldUpdate = false;
            continue;
          }
        }
        if (field === "product_id" && context.collectedData["_product_name_hint"]) {
          const name = context.collectedData["_product_name_hint"] as string;
          const product = this.resolveProduct(name);
          if (product) {
            context.collectedData.product_id = product.id;
            delete context.collectedData["_product_name_hint"];
            needFieldUpdate = false;
            continue;
          }
        }
        nextField = field;
        needFieldUpdate = true;
        break;
      }

      if (!needFieldUpdate) {
        const stillMissing = this.getMissingRequiredFields(context);
        if (stillMissing.length === 0) {
          return await this.presentConfirmation(context, sessionId);
        }
        nextField = stillMissing[0];
      }

      context.pendingField = nextField;
      context = updateConversationState(context, this.getStateForField(nextField));
      const question = this.getQuestionForField(context, nextField);
      context = addConversationMessage(context, "assistant", "question", question, nextField);
      this.sessions.set(sessionId, context);
      return { response: question, state: context.state, actionType: context.actionType };
    }

    return await this.presentConfirmation(context, sessionId);
  }

  private getMissingRequiredFields(context: ConversationContext): string[] {
    if (!context.actionType) return [];
    const schema = getActionSchema(context.actionType);
    const missing: string[] = [];
    for (const field of schema.requiredFields) {
      const value = context.collectedData[field];
      if (value === undefined || value === null || value === "") {
        missing.push(field);
      }
    }
    if (missing.length > 0) return missing;
    for (const field of schema.optionalFields) {
      const value = context.collectedData[field];
      if (value === undefined || value === null || value === "") {
        missing.push(field);
      }
    }
    return missing;
  }

  private getAllFields(actionType: ActionType): string[] {
    const schema = getActionSchema(actionType);
    return [...schema.requiredFields, ...schema.optionalFields];
  }

  private getStateForField(field: string): ConversationState {
    const stateMap: Record<string, ConversationState> = {
      customer_id: "waiting_for_customer",
      supplier_id: "waiting_for_supplier",
      product_id: "waiting_for_product",
      quantity: "waiting_for_quantity",
      selling_price: "waiting_for_price",
      purchase_price: "waiting_for_price",
      payment_type: "waiting_for_payment_method",
      invoice_date: "waiting_for_invoice_date",
      employee_id: "waiting_for_employee",
      area: "waiting_for_area",
      notes: "waiting_for_notes",
    };
    return stateMap[field] || "waiting_for_notes";
  }

  private getQuestionForField(context: ConversationContext, fieldKey: string | null): string {
    if (!fieldKey || !context.actionType) return "What would you like to do?";
    const schema = getActionSchema(context.actionType);
    const def = schema.fieldDefinitions[fieldKey];
    if (!def) return `Please provide ${fieldKey.replace(/_/g, " ")}`;

    const collected = context.collectedData;
    const store = this.store;

    if (fieldKey === "customer_id" && store) {
      const hint = collected["_customer_name_hint"];
      if (hint) {
        const searchResult = store.searchCustomers(hint as string, 0.3, 3);
        if (searchResult.length === 1) {
          return `Did you mean ${searchResult[0].item.name}? Say yes or tell me the full name.`;
        }
        if (searchResult.length > 1) {
          const names = searchResult.map((r, i) => `${i + 1}. ${r.item.name}${r.item.shopName ? `, ${r.item.shopName}` : ""}`).join(". ");
          return `I found a few customers: ${names}. Which one? Or tell me the full name to search again.`;
        }
      }
      const allCustomers = Array.from(store.customers.values()).slice(0, 5);
      if (allCustomers.length > 0) {
        const customerList = allCustomers.map((c) => `${c.name}${c.shopName ? `, ${c.shopName}` : ""}`).join(", ");
        return `${def.question} Known customers: ${customerList}.`;
      }
    }

    if (fieldKey === "supplier_id" && store) {
      const hint = collected["_supplier_name_hint"];
      if (hint) {
        const searchResult = store.searchSuppliers(hint as string, 0.3, 3);
        if (searchResult.length === 1) {
          return `Did you mean ${searchResult[0].item.name}? Say yes or tell me the full name.`;
        }
        if (searchResult.length > 1) {
          const names = searchResult.map((r, i) => `${i + 1}. ${r.item.name}`).join(". ");
          return `I found a few suppliers: ${names}. Which one? Or tell me the full name to search again.`;
        }
      }
      const allSuppliers = Array.from(store.suppliers.values()).slice(0, 5);
      if (allSuppliers.length > 0) {
        const supplierList = allSuppliers.map((s) => s.name).join(", ");
        return `${def.question} Known suppliers: ${supplierList}.`;
      }
    }

    if (fieldKey === "product_id" && store) {
      const hint = collected["_product_name_hint"];
      if (hint) {
        const searchResult = store.searchProducts(hint as string, 0.3, 3);
        if (searchResult.length === 1) {
          return `Did you mean ${searchResult[0].item.name}? Say yes or tell me the product name.`;
        }
        if (searchResult.length > 1) {
          const names = searchResult.map((r, i) => `${i + 1}. ${r.item.name}`).join(". ");
          return `I found a few products: ${names}. Which one? Or tell me the product name.`;
        }
      }
      const allProducts = Array.from(store.products.values()).slice(0, 5);
      if (allProducts.length > 0) {
        const productList = allProducts.map((p) => `${p.name}, stock ${p.currentStock}`).join("; ");
        return `${def.question} Available: ${productList}.`;
      }
    }

    if (fieldKey === "payment_type") {
      return "Is this cash or credit?";
    }

    if (fieldKey === "employee_id" && store) {
      const hint = collected["_employee_name_hint"];
      if (hint) {
        const searchResult = store.searchStaff(hint as string, 0.3, 3);
        if (searchResult.length === 1) {
          return `Did you mean ${searchResult[0].item.name}? Say yes or tell me the full name.`;
        }
        if (searchResult.length > 1) {
          const names = searchResult.map((r, i) => `${i + 1}. ${r.item.name}`).join(". ");
          return `I found a few employees: ${names}. Which one? Or tell me the full name.`;
        }
      }
      const allStaff = Array.from(store.staff.values()).slice(0, 5);
      if (allStaff.length > 0) {
        const staffList = allStaff.map((s) => `${s.name}${s.role ? `, ${s.role}` : ""}`).join("; ");
        return `${def.question} Known staff: ${staffList}.`;
      }
    }

    if (fieldKey === "quantity") {
      const hasHint = collected["_product_name_hint"];
      const productName = hasHint ? ` for ${hasHint}` : "";
      return `${def.question}${productName}`;
    }

    if (fieldKey === "area") {
      const employeeHint = collected["_employee_name"] || collected["_employee_name_hint"];
      if (employeeHint) {
        return `${def.question} (for ${employeeHint})`;
      }
    }

    if (fieldKey === "selling_price" || fieldKey === "purchase_price") {
      const hasHint = collected["_product_name_hint"];
      const productName = hasHint ? ` for ${hasHint}` : "";
      return `${def.question}${productName}`;
    }

    return def.question;
  }

  private async extractFieldValue(
    message: string,
    fieldKey: string,
    context: ConversationContext
  ): Promise<{ found: boolean; value: unknown }> {
    const schema = getActionSchema(context.actionType || "unknown");
    const def = schema.fieldDefinitions[fieldKey];
    if (!def) return { found: false, value: message };

    if (def.validation) {
      const result = def.validation(message);
      if (result.valid) {
        const num = Number(message);
        return { found: true, value: Number.isFinite(num) ? num : message };
      }
    }

    if (fieldKey === "payment_type") {
      const lower = message.toLowerCase().trim();
      if (["cash", "cash hai", "cash pay", "naqad", "naqd"].some((w) => lower.includes(w))) return { found: true, value: "cash" };
      if (["credit", "credit hai", "udhar", "udhaar", "karz"].some((w) => lower.includes(w))) return { found: true, value: "credit" };
    }

    if (def.extractor) {
      try {
        const result = def.extractor(message, context);
        if (result !== undefined) return { found: true, value: result };
      } catch {}
    }

    try {
      const prompt = FIELD_EXTRACTION_PROMPT
        .replace("{field_label}", def.label)
        .replace("{user_message}", message)
        .replace("{collected_data}", JSON.stringify(context.collectedData));

      const result = await callAiProviderRouter({
        task: "field_extraction",
        prompt,
        jsonMode: true,
        temperature: 0.1,
      });

      if (result.ok && result.json) {
        const value = result.json.value;
        if (result.json.clarification_needed) {
          return { found: false, value: null };
        }
        if (value !== undefined && value !== null) {
          return { found: true, value };
        }
      }
    } catch {}

    if (fieldKey === "customer_id" || fieldKey === "supplier_id" || fieldKey === "product_id") {
      return { found: false, value: message };
    }

    if (fieldKey === "quantity" || fieldKey === "selling_price" || fieldKey === "purchase_price" || fieldKey === "credit_days") {
      const num = Number(message);
      if (Number.isFinite(num)) return { found: true, value: num };
    }

    return { found: true, value: message };
  }

  private resolveCustomer(name: string): { id: string; name: string } | null {
    if (!this.store) return null;
    const results = this.store.searchCustomers(name, 0.4, 1);
    if (results.length > 0 && results[0].score >= 0.5) {
      return { id: results[0].item.id, name: results[0].item.name };
    }
    const exact = this.store.findExactCustomer(name);
    if (exact) return { id: exact.id, name: exact.name };
    return null;
  }

  private resolveSupplier(name: string): { id: string; name: string } | null {
    if (!this.store) return null;
    const results = this.store.searchSuppliers(name, 0.4, 1);
    if (results.length > 0 && results[0].score >= 0.5) {
      return { id: results[0].item.id, name: results[0].item.name };
    }
    const exact = this.store.findExactSupplier(name);
    if (exact) return { id: exact.id, name: exact.name };
    return null;
  }

  private resolveEmployee(name: string): { id: string; name: string } | null {
    if (!this.store) return null;
    const results = this.store.searchStaff(name, 0.4, 1);
    if (results.length > 0 && results[0].score >= 0.5) {
      return { id: results[0].item.id, name: results[0].item.name };
    }
    for (const s of this.store.staff.values()) {
      if (s.name.toLowerCase() === name.toLowerCase()) return { id: s.id, name: s.name };
    }
    return null;
  }

  private resolveProduct(name: string): { id: string; name: string } | null {
    if (!this.store) return null;
    const results = this.store.searchProducts(name, 0.4, 1);
    if (results.length > 0 && results[0].score >= 0.5) {
      return { id: results[0].item.id, name: results[0].item.name };
    }
    const exact = this.store.findExactProduct(name);
    if (exact) return { id: exact.id, name: exact.name };
    return null;
  }

  private async presentConfirmation(
    context: ConversationContext,
    sessionId: string
  ): Promise<{ response: string; state: ConversationState; actionType: ActionType | null }> {
    context.awaitingConfirmation = true;
    context.confirmationSummary = formatConfirmationSummary(context);
    context = updateConversationState(context, "waiting_for_confirmation");

    const stockCheck = this.checkStockAvailability(context);
    const creditCheck = this.checkCreditLimit(context);
    const purchaseWarnings = this.checkPurchaseWarnings(context);
    const warnings: string[] = [];
    if (stockCheck) warnings.push(stockCheck);
    if (creditCheck) warnings.push(creditCheck);
    if (purchaseWarnings) warnings.push(purchaseWarnings);

    const summary = context.confirmationSummary;
    const warningText = warnings.length > 0 ? `\nWarning: ${warnings.join(" ")}` : "";
    const response = `${summary}${warningText}\n\nPlease confirm with yes or no.`;
    context = addConversationMessage(context, "assistant", "confirmation", response);
    this.sessions.set(sessionId, context);
    return { response, state: "waiting_for_confirmation", actionType: context.actionType };
  }

  private checkPurchaseWarnings(context: ConversationContext): string | null {
    if (!this.store || context.actionType !== "create_purchase") return null;
    const productId = context.collectedData.product_id as string;
    const quantity = Number(context.collectedData.quantity) || 0;
    const product = this.store.getProduct(productId);
    if (product && product.currentStock > 0 && quantity > product.currentStock * 2) {
      return `Overstock warning: purchasing ${quantity} ${product.name} when current stock is ${product.currentStock}.`;
    }
    return null;
  }

  private checkStockAvailability(context: ConversationContext): string | null {
    if (!this.store || context.actionType !== "create_sale") return null;
    const productId = context.collectedData.product_id as string;
    const quantity = Number(context.collectedData.quantity) || 0;
    const product = this.store.getProduct(productId);
    if (product && quantity > product.currentStock) {
      return `Insufficient stock for ${product.name}: requested ${quantity}, available ${product.currentStock}.`;
    }
    return null;
  }

  private checkCreditLimit(context: ConversationContext): string | null {
    if (!this.store) return null;
    const paymentType = context.collectedData.payment_type as string;
    if (paymentType !== "credit") return null;

    if (context.actionType === "create_sale") {
      const customerId = context.collectedData.customer_id as string;
      const quantity = Number(context.collectedData.quantity) || 0;
      const price = Number(context.collectedData.selling_price) || 0;
      const total = quantity * price;
      const customer = this.store.getCustomer(customerId);
      if (customer && customer.creditLimit !== null && customer.creditLimit > 0) {
        const newBalance = (customer.outstandingBalance || 0) + total;
        if (newBalance > customer.creditLimit) {
          return `Customer ${customer.name}'s credit limit (PKR ${customer.creditLimit.toLocaleString("en-PK")}) would be exceeded. New balance would be PKR ${newBalance.toLocaleString("en-PK")}.`;
        }
      }
    }

    if (context.actionType === "create_purchase") {
      const supplierId = context.collectedData.supplier_id as string;
      const quantity = Number(context.collectedData.quantity) || 0;
      const price = Number(context.collectedData.purchase_price) || 0;
      const total = quantity * price;
      const supplier = this.store.getSupplier(supplierId);
      if (supplier) {
        const newPayable = (supplier.payableAmount || 0) + total;
        if (newPayable > 500000) {
          return `Warning: Supplier ${supplier.name}'s payable amount would be PKR ${newPayable.toLocaleString("en-PK")}.`;
        }
      }
    }

    return null;
  }

  private async executeAction(
    context: ConversationContext,
    sessionId: string
  ): Promise<{ response: string; state: ConversationState; actionType: ActionType | null }> {
    if (context.actionType) {
      const denied = this.permissionDenialResponse(context, context.actionType, sessionId);
      if (denied.response !== "") {
        return denied;
      }
    }
    context = updateConversationState(context, "executing");
    this.sessions.set(sessionId, context);

    if (context.actionType === "create_sale") {
      try {
        const result = await executeSaleDraft(context.collectedData, context.organizationId);
        if (result.ok) {
          context = updateConversationState(context, "completed");
          context = addConversationMessage(context, "assistant", "result", result.message);
          context.actionDraftId = result.saleId || null;
          this.sessions.set(sessionId, context);
          this.updateMemoryAfterSale(context, result);
          return { response: result.message, state: "completed", actionType: "create_sale" };
        } else {
          context = updateConversationState(context, "error");
          context.error = result.error || "EXECUTION_FAILED";
          context = addConversationMessage(context, "assistant", "error", `Failed to create sale: ${result.error}`);
          this.sessions.set(sessionId, context);
          return { response: `Sorry, I couldn't create the sale: ${result.error}`, state: "error", actionType: "create_sale" };
        }
      } catch (err) {
        context = updateConversationState(context, "error");
        context.error = err instanceof Error ? err.message : "EXECUTION_ERROR";
        context = addConversationMessage(context, "assistant", "error", `An unexpected error occurred: ${err instanceof Error ? err.message : "Unknown error"}`);
        this.sessions.set(sessionId, context);
        return { response: "Sorry, an unexpected error occurred while creating the sale. Please try again.", state: "error", actionType: "create_sale" };
      }
    }

    if (context.actionType === "create_purchase") {
      try {
        const result = await executePurchaseDraft(context.collectedData, context.organizationId);
        if (result.ok) {
          context = updateConversationState(context, "completed");
          context = addConversationMessage(context, "assistant", "result", result.message);
          context.actionDraftId = result.purchaseId || null;
          this.sessions.set(sessionId, context);
          this.updateMemoryAfterPurchase(context, result);
          return { response: result.message, state: "completed", actionType: "create_purchase" };
        } else {
          context = updateConversationState(context, "error");
          context.error = result.error || "EXECUTION_FAILED";
          context = addConversationMessage(context, "assistant", "error", `Failed to create purchase: ${result.error}`);
          this.sessions.set(sessionId, context);
          return { response: `Sorry, I couldn't create the purchase: ${result.error}`, state: "error", actionType: "create_purchase" };
        }
      } catch (err) {
        context = updateConversationState(context, "error");
        context.error = err instanceof Error ? err.message : "EXECUTION_ERROR";
        context = addConversationMessage(context, "assistant", "error", `An unexpected error occurred: ${err instanceof Error ? err.message : "Unknown error"}`);
        this.sessions.set(sessionId, context);
        return { response: "Sorry, an unexpected error occurred while creating the purchase. Please try again.", state: "error", actionType: "create_purchase" };
      }
    }

    if (context.actionType === "assign_staff" || context.actionType === "reassign_staff" || context.actionType === "remove_staff") {
      try {
        const data: StaffInput = {
          employee_id: context.collectedData.employee_id as string,
          employee_name: context.collectedData["_employee_name"] as string || undefined,
          area: context.collectedData.area as string || undefined,
        };
        let result: StaffResult;
        if (context.actionType === "assign_staff") {
          result = assignEmployee(data);
        } else if (context.actionType === "reassign_staff") {
          result = reassignEmployee(data);
        } else {
          result = removeEmployee(data);
        }
        if (result.ok) {
          context = updateConversationState(context, "completed");
          context = addConversationMessage(context, "assistant", "result", result.message);
          this.sessions.set(sessionId, context);
          this.updateMemoryAfterStaff(context);
          return { response: result.message, state: "completed", actionType: context.actionType };
        } else {
          context = updateConversationState(context, "error");
          context.error = result.error || "EXECUTION_FAILED";
          context = addConversationMessage(context, "assistant", "error", result.message);
          this.sessions.set(sessionId, context);
          return { response: result.message, state: "error", actionType: context.actionType };
        }
      } catch (err) {
        context = updateConversationState(context, "error");
        context.error = err instanceof Error ? err.message : "EXECUTION_ERROR";
        context = addConversationMessage(context, "assistant", "error", `An unexpected error occurred: ${err instanceof Error ? err.message : "Unknown error"}`);
        this.sessions.set(sessionId, context);
        return { response: "Sorry, an unexpected error occurred. Please try again.", state: "error", actionType: context.actionType };
      }
    }

    context = updateConversationState(context, "completed");
    context = addConversationMessage(context, "assistant", "text", "Action completed.");
    this.sessions.set(sessionId, context);
    return { response: "Done! What would you like to do next?", state: "completed", actionType: context.actionType };
  }

  private updateMemoryAfterStaff(context: ConversationContext): void {
    try {
      if (!this.store || !this.prefs) return;
      const writer = (this.store as any)["_sections"]?.conversations;
      if (writer) {
        writer.recentMessages.push({
          id: `msg_${Date.now()}`,
          role: "system" as const,
          type: "execution",
          text: `Staff action: ${context.actionType} for ${context.collectedData["_employee_name"] || context.collectedData.employee_id}`,
          createdAt: new Date().toISOString(),
        });
      }
      this.prefs.incrementTopic(context.actionType || "staff");
    } catch {}
  }

  private updateMemoryAfterPurchase(context: ConversationContext, result: { purchaseId?: string; invoiceNumber?: string }): void {
    try {
      if (!this.store || !this.prefs) return;
      const writer = (this.store as any)["_sections"]?.conversations;
      if (writer) {
        writer.recentMessages.push({
          id: `msg_${Date.now()}`,
          role: "system" as const,
          type: "execution",
          text: `Purchase created: ${result.invoiceNumber || result.purchaseId}`,
          createdAt: new Date().toISOString(),
        });
      }
      this.prefs.incrementTopic("create_purchase");
    } catch {}
  }

  private updateMemoryAfterSale(context: ConversationContext, result: { saleId?: string; invoiceNumber?: string }): void {
    try {
      if (!this.store || !this.prefs) return;
      const writer = (this.store as any)["_sections"]?.conversations;
      if (writer) {
        writer.recentMessages.push({
          id: `msg_${Date.now()}`,
          role: "system" as const,
          type: "execution",
          text: `Sale created: ${result.invoiceNumber || result.saleId}`,
          createdAt: new Date().toISOString(),
        });
      }
      this.prefs.incrementTopic("create_sale");
    } catch {}
  }

  private getBusinessContextText(): string {
    if (!this.store) return "";
    return this.store.getBusinessSummary();
  }

  resetSessionById(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanupOldSessions(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, ctx] of this.sessions.entries()) {
      const lastActivity = new Date(ctx.lastActivityAt).getTime();
      if (now - lastActivity > maxAgeMs) {
        this.sessions.delete(id);
      }
    }
  }
}

export const conversationRuntime = new ConversationRuntime();
