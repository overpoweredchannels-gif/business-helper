export type ConversationState =
  | "idle"
  | "waiting_for_intent"
  | "waiting_for_customer"
  | "waiting_for_supplier"
  | "waiting_for_product"
  | "waiting_for_quantity"
  | "waiting_for_price"
  | "waiting_for_payment_method"
  | "waiting_for_invoice_date"
  | "waiting_for_employee"
  | "waiting_for_area"
  | "waiting_for_notes"
  | "waiting_for_confirmation"
  | "executing"
  | "completed"
  | "cancelled"
  | "error";

export type ActionType =
  | "create_purchase"
  | "create_sale"
  | "create_expense"
  | "create_task"
  | "create_customer"
  | "update_customer"
  | "delete_customer"
  | "customer_query"
  | "create_supplier"
  | "update_supplier"
  | "delete_supplier"
  | "supplier_query"
  | "create_product"
  | "business_query"
  | "market_intelligence"
  | "inventory_query"
  | "location_query"
  | "assign_staff"
  | "reassign_staff"
  | "remove_staff"
  | "staff_query"
  | "unknown";

export interface ConversationContext {
  // Core identifiers
  sessionId: string;
  organizationId: string;
  profileId: string | null;

  // Current state
  state: ConversationState;
  actionType: ActionType | null;

  // Collected data
  collectedData: Record<string, unknown>;
  pendingField: string | null;

  // Draft reference
  actionDraftId: string | null;

  // Confirmation
  awaitingConfirmation: boolean;
  confirmationSummary: string | null;

  // Timing
  startedAt: string;
  lastActivityAt: string;
  timeoutAt: string | null;

  // Error tracking
  error: string | null;
  retryCount: number;

  // Messages for UI
  messages: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  type: "text" | "question" | "confirmation" | "execution" | "error" | "result";
  text: string;
  field?: string;
  timestamp: string;
  parsedValue?: unknown;
}

export interface ConversationTimeoutConfig {
  timeoutMinutes: number;
  warningMinutes: number;
  onTimeout: () => void;
  onWarning: () => void;
}

export interface FieldDefinition {
  key: string;
  label: string;
  question: string;
  required: boolean;
  inputType: "text" | "number" | "select" | "date" | "boolean";
  validation?: (value: unknown) => { valid: boolean; error?: string };
  extractor?: (answer: string, context: ConversationContext) => unknown;
  dependsOn?: string[];
}

export interface ActionSchema {
  actionType: ActionType;
  label: string;
  description: string;
  requiredFields: string[];
  optionalFields: string[];
  fieldDefinitions: Record<string, FieldDefinition>;
  confirmationTemplate: string;
  executionFunction: string; // Function name to call
}

// State transition rules
export const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  idle: ["waiting_for_intent", "waiting_for_employee", "waiting_for_area", "cancelled"],
  waiting_for_intent: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_employee",
    "waiting_for_area",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_customer: [
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_supplier: [
    "waiting_for_customer",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_product: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_quantity: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_price: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_payment_method: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_invoice_date",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_invoice_date: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_employee: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_area",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_area: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_employee",
    "waiting_for_notes",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_notes: [
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_confirmation",
    "cancelled",
    "error",
  ],
  waiting_for_confirmation: [
    "executing",
    "cancelled",
    "waiting_for_customer",
    "waiting_for_supplier",
    "waiting_for_product",
    "waiting_for_quantity",
    "waiting_for_price",
    "waiting_for_payment_method",
    "waiting_for_invoice_date",
    "waiting_for_employee",
    "waiting_for_area",
    "waiting_for_notes",
    "error",
  ],
  executing: ["completed", "error", "cancelled"],
  completed: ["idle", "cancelled"],
  cancelled: ["idle"],
  error: ["idle", "waiting_for_intent", "cancelled"],
};

export function canTransition(from: ConversationState, to: ConversationState): boolean {
  return from === to || (VALID_TRANSITIONS[from]?.includes(to) ?? false);
}

export function isTerminalState(state: ConversationState): boolean {
  return ["completed", "cancelled", "error"].includes(state);
}

export function isActiveState(state: ConversationState): boolean {
  return !isTerminalState(state) && state !== "idle";
}

// Field definitions for each action type
export const ACTION_SCHEMAS: Record<ActionType, ActionSchema> = {
  create_purchase: {
    actionType: "create_purchase",
    label: "Create Purchase Invoice",
    description: "Create a purchase invoice from a supplier",
    requiredFields: ["supplier_id", "product_id", "quantity", "purchase_price", "payment_type"],
    optionalFields: ["invoice_number", "invoice_date", "notes"],
    fieldDefinitions: {
      supplier_id: {
        key: "supplier_id",
        label: "Supplier",
        question: "Which supplier is this purchase from?",
        required: true,
        inputType: "select",
      },
      product_id: {
        key: "product_id",
        label: "Product",
        question: "Which product are you purchasing?",
        required: true,
        inputType: "select",
      },
      quantity: {
        key: "quantity",
        label: "Quantity",
        question: "How many units or cartons?",
        required: true,
        inputType: "number",
        validation: (v) => {
          const num = Number(v);
          return { valid: Number.isFinite(num) && num > 0, error: "Quantity must be a positive number" };
        },
      },
      purchase_price: {
        key: "purchase_price",
        label: "Purchase Price",
        question: "What is the purchase price per unit?",
        required: true,
        inputType: "number",
        validation: (v) => {
          const num = Number(v);
          return { valid: Number.isFinite(num) && num >= 0, error: "Price must be a valid number" };
        },
      },
      payment_type: {
        key: "payment_type",
        label: "Payment Type",
        question: "Is this cash or credit?",
        required: true,
        inputType: "select",
      },
      invoice_number: {
        key: "invoice_number",
        label: "Invoice Number",
        question: "What is the supplier invoice number? (Optional)",
        required: false,
        inputType: "text",
      },
      invoice_date: {
        key: "invoice_date",
        label: "Invoice Date",
        question: "What is the purchase date? (Defaults to today)",
        required: false,
        inputType: "date",
      },
      notes: {
        key: "notes",
        label: "Notes",
        question: "Any additional notes? (Optional)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Create Purchase Invoice:\n• Supplier: {supplier_id}\n• Product: {product_id}\n• Quantity: {quantity}\n• Purchase Price: {purchase_price}\n• Payment: {payment_type}\n• Invoice Number: {invoice_number}\n• Invoice Date: {invoice_date}\n• Notes: {notes}\n\nShould I proceed?",
    executionFunction: "executePurchaseDraft",
  },

  create_sale: {
    actionType: "create_sale",
    label: "Create Sale Invoice",
    description: "Create a sale invoice for a customer",
    requiredFields: ["customer_id", "product_id", "quantity", "selling_price", "payment_type"],
    optionalFields: ["invoice_date", "batch_number", "expiry_date", "notes"],
    fieldDefinitions: {
      customer_id: {
        key: "customer_id",
        label: "Customer",
        question: "Which customer is this sale for?",
        required: true,
        inputType: "select",
      },
      product_id: {
        key: "product_id",
        label: "Product",
        question: "Which product are you selling?",
        required: true,
        inputType: "select",
      },
      quantity: {
        key: "quantity",
        label: "Quantity",
        question: "How many units or cartons?",
        required: true,
        inputType: "number",
        validation: (v) => {
          const num = Number(v);
          return { valid: Number.isFinite(num) && num > 0, error: "Quantity must be a positive number" };
        },
      },
      selling_price: {
        key: "selling_price",
        label: "Selling Price",
        question: "What is the selling price per unit?",
        required: true,
        inputType: "number",
        validation: (v) => {
          const num = Number(v);
          return { valid: Number.isFinite(num) && num >= 0, error: "Price must be a valid number" };
        },
      },
      payment_type: {
        key: "payment_type",
        label: "Payment Type",
        question: "Is this cash or credit?",
        required: true,
        inputType: "select",
      },
      invoice_date: {
        key: "invoice_date",
        label: "Invoice Date",
        question: "What is the sale date? (Defaults to today)",
        required: false,
        inputType: "date",
      },
      batch_number: {
        key: "batch_number",
        label: "Batch Number",
        question: "Which batch to sell from? (Optional)",
        required: false,
        inputType: "select",
      },
      expiry_date: {
        key: "expiry_date",
        label: "Expiry Date",
        question: "Expiry date for batch tracking? (Optional)",
        required: false,
        inputType: "date",
      },
      notes: {
        key: "notes",
        label: "Notes",
        question: "Any additional notes? (Optional)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Create Sale Invoice:\n• Customer: {customer_name}\n• Product: {product_name}\n• Quantity: {quantity}\n• Selling Price: {selling_price}\n• Payment: {payment_type}\n• Invoice Date: {invoice_date}\n• Batch: {batch_number}\n• Expiry: {expiry_date}\n\nShould I proceed?",
    executionFunction: "executeSaleDraft",
  },

  create_expense: {
    actionType: "create_expense",
    label: "Create Expense",
    description: "Record a business expense",
    requiredFields: ["amount", "expense_type"],
    optionalFields: ["supplier_id", "customer_id", "purchase_transaction_id", "invoice_date", "notes"],
    fieldDefinitions: {
      amount: {
        key: "amount",
        label: "Amount",
        question: "What is the expense amount?",
        required: true,
        inputType: "number",
        validation: (v) => {
          const num = Number(v);
          return { valid: Number.isFinite(num) && num > 0, error: "Amount must be a positive number" };
        },
      },
      expense_type: {
        key: "expense_type",
        label: "Expense Type",
        question: "What type of expense is this?",
        required: true,
        inputType: "select",
      },
      supplier_id: {
        key: "supplier_id",
        label: "Related Supplier",
        question: "Is this related to a supplier? (Optional)",
        required: false,
        inputType: "select",
      },
      customer_id: {
        key: "customer_id",
        label: "Related Customer",
        question: "Is this related to a customer? (Optional)",
        required: false,
        inputType: "select",
      },
      purchase_transaction_id: {
        key: "purchase_transaction_id",
        label: "Related Purchase",
        question: "Is this linked to a purchase invoice? (Optional)",
        required: false,
        inputType: "select",
      },
      invoice_date: {
        key: "invoice_date",
        label: "Expense Date",
        question: "What is the expense date? (Defaults to today)",
        required: false,
        inputType: "date",
      },
      notes: {
        key: "notes",
        label: "Notes",
        question: "Any additional notes? (Optional)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Create Expense:\n• Type: {expense_type}\n• Amount: {amount}\n• Supplier: {supplier_name}\n• Customer: {customer_name}\n• Date: {invoice_date}\n• Notes: {notes}\n\nShould I proceed?",
    executionFunction: "executeExpenseDraft",
  },

  create_task: {
    actionType: "create_task",
    label: "Create Task",
    description: "Create a follow-up task",
    requiredFields: ["title"],
    optionalFields: ["task_type", "priority", "due_date", "customer_id", "supplier_id", "product_id", "notes"],
    fieldDefinitions: {
      title: {
        key: "title",
        label: "Task Title",
        question: "What is the task?",
        required: true,
        inputType: "text",
        validation: (v) => ({ valid: String(v).trim().length > 0, error: "Task title is required" }),
      },
      task_type: {
        key: "task_type",
        label: "Task Type",
        question: "What type of task is this?",
        required: false,
        inputType: "select",
      },
      priority: {
        key: "priority",
        label: "Priority",
        question: "What priority? (low, medium, high, urgent)",
        required: false,
        inputType: "select",
      },
      due_date: {
        key: "due_date",
        label: "Due Date",
        question: "When is this due? (Optional)",
        required: false,
        inputType: "date",
      },
      customer_id: {
        key: "customer_id",
        label: "Related Customer",
        question: "Related to which customer? (Optional)",
        required: false,
        inputType: "select",
      },
      supplier_id: {
        key: "supplier_id",
        label: "Related Supplier",
        question: "Related to which supplier? (Optional)",
        required: false,
        inputType: "select",
      },
      product_id: {
        key: "product_id",
        label: "Related Product",
        question: "Related to which product? (Optional)",
        required: false,
        inputType: "select",
      },
      notes: {
        key: "notes",
        label: "Notes",
        question: "Any additional notes? (Optional)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Create Task:\n• Title: {title}\n• Type: {task_type}\n• Priority: {priority}\n• Due: {due_date}\n• Customer: {customer_name}\n• Supplier: {supplier_name}\n• Notes: {notes}\n\nShould I proceed?",
    executionFunction: "executeTaskDraft",
  },

  create_customer: {
    actionType: "create_customer",
    label: "Create Customer",
    description: "Add a new customer",
    requiredFields: ["customer_name"],
    optionalFields: ["shop_name", "phone", "whatsapp", "city", "area", "credit_limit", "credit_days", "customer_type"],
    fieldDefinitions: {
      customer_name: {
        key: "customer_name",
        label: "Customer Name",
        question: "What is the customer's name?",
        required: true,
        inputType: "text",
        validation: (v) => ({ valid: String(v).trim().length > 0, error: "Customer name is required" }),
      },
      shop_name: {
        key: "shop_name",
        label: "Shop Name",
        question: "What is the shop name? (Optional)",
        required: false,
        inputType: "text",
      },
      phone: {
        key: "phone",
        label: "Phone",
        question: "What is the phone number? (Optional)",
        required: false,
        inputType: "text",
      },
      whatsapp: {
        key: "whatsapp",
        label: "WhatsApp",
        question: "What is the WhatsApp number? (Optional)",
        required: false,
        inputType: "text",
      },
      city: {
        key: "city",
        label: "City",
        question: "Which city? (Optional)",
        required: false,
        inputType: "text",
      },
      area: {
        key: "area",
        label: "Area",
        question: "Which area? (Optional)",
        required: false,
        inputType: "text",
      },
      credit_limit: {
        key: "credit_limit",
        label: "Credit Limit",
        question: "What is the credit limit? (Optional)",
        required: false,
        inputType: "number",
      },
      credit_days: {
        key: "credit_days",
        label: "Credit Days",
        question: "How many credit days? (Optional)",
        required: false,
        inputType: "number",
      },
      customer_type: {
        key: "customer_type",
        label: "Customer Type",
        question: "What type of customer? (wholesale, retail, institutional)",
        required: false,
        inputType: "select",
      },
    },
    confirmationTemplate:
      "Create Customer:\n• Name: {customer_name}\n• Shop: {shop_name}\n• Phone: {phone}\n• City: {city}\n• Area: {area}\n• Credit Limit: {credit_limit}\n• Credit Days: {credit_days}\n• Type: {customer_type}\n\nShould I proceed?",
    executionFunction: "executeCreateCustomer",
  },

  update_customer: {
    actionType: "update_customer",
    label: "Update Customer",
    description: "Update an existing customer's details",
    requiredFields: ["customer_id"],
    optionalFields: ["customer_name", "shop_name", "phone", "whatsapp", "city", "area", "credit_limit", "credit_days", "customer_type"],
    fieldDefinitions: {
      customer_id: {
        key: "customer_id",
        label: "Customer",
        question: "Which customer do you want to update?",
        required: true,
        inputType: "text",
      },
      customer_name: {
        key: "customer_name",
        label: "Customer Name",
        question: "What is the new customer name? (Optional)",
        required: false,
        inputType: "text",
      },
      shop_name: {
        key: "shop_name",
        label: "Shop Name",
        question: "What is the shop name? (Optional)",
        required: false,
        inputType: "text",
      },
      phone: {
        key: "phone",
        label: "Phone",
        question: "What is the phone number? (Optional)",
        required: false,
        inputType: "text",
      },
      whatsapp: {
        key: "whatsapp",
        label: "WhatsApp",
        question: "What is the WhatsApp number? (Optional)",
        required: false,
        inputType: "text",
      },
      city: {
        key: "city",
        label: "City",
        question: "Which city? (Optional)",
        required: false,
        inputType: "text",
      },
      area: {
        key: "area",
        label: "Area",
        question: "Which area? (Optional)",
        required: false,
        inputType: "text",
      },
      credit_limit: {
        key: "credit_limit",
        label: "Credit Limit",
        question: "What is the credit limit? (Optional)",
        required: false,
        inputType: "number",
      },
      credit_days: {
        key: "credit_days",
        label: "Credit Days",
        question: "How many credit days? (Optional)",
        required: false,
        inputType: "number",
      },
      customer_type: {
        key: "customer_type",
        label: "Customer Type",
        question: "What type of customer? (wholesale, retail, institutional)",
        required: false,
        inputType: "select",
      },
    },
    confirmationTemplate:
      "Update Customer:\n• Customer: {customer_id}\n• Name: {customer_name}\n• Shop: {shop_name}\n• Phone: {phone}\n• City: {city}\n• Area: {area}\n• Credit Limit: {credit_limit}\n• Credit Days: {credit_days}\n• Type: {customer_type}\n\nShould I proceed?",
    executionFunction: "executeUpdateCustomer",
  },

  delete_customer: {
    actionType: "delete_customer",
    label: "Delete Customer",
    description: "Remove a customer from the records",
    requiredFields: ["customer_id"],
    optionalFields: [],
    fieldDefinitions: {
      customer_id: {
        key: "customer_id",
        label: "Customer",
        question: "Which customer do you want to delete?",
        required: true,
        inputType: "text",
      },
    },
    confirmationTemplate: "Delete Customer:\n• Customer: {customer_id}\n\nShould I proceed?",
    executionFunction: "executeDeleteCustomer",
  },

  create_supplier: {
    actionType: "create_supplier",
    label: "Create Supplier",
    description: "Add a new supplier",
    requiredFields: ["supplier_name"],
    optionalFields: ["contact_person", "phone", "whatsapp", "city", "area", "notes", "credit_limit", "credit_days"],
    fieldDefinitions: {
      supplier_name: {
        key: "supplier_name",
        label: "Supplier Name",
        question: "What is the supplier's name?",
        required: true,
        inputType: "text",
        validation: (v) => ({ valid: String(v).trim().length > 0, error: "Supplier name is required" }),
      },
      contact_person: {
        key: "contact_person",
        label: "Contact Person",
        question: "Who is the contact person? (Optional)",
        required: false,
        inputType: "text",
      },
      phone: {
        key: "phone",
        label: "Phone",
        question: "What is the phone number? (Optional)",
        required: false,
        inputType: "text",
      },
      whatsapp: {
        key: "whatsapp",
        label: "WhatsApp",
        question: "What is the WhatsApp number? (Optional)",
        required: false,
        inputType: "text",
      },
      city: {
        key: "city",
        label: "City",
        question: "Which city? (Optional)",
        required: false,
        inputType: "text",
      },
      area: {
        key: "area",
        label: "Area",
        question: "Which area? (Optional)",
        required: false,
        inputType: "text",
      },
      credit_limit: {
        key: "credit_limit",
        label: "Credit Limit",
        question: "What is the credit limit? (Optional)",
        required: false,
        inputType: "number",
      },
      credit_days: {
        key: "credit_days",
        label: "Credit Days",
        question: "How many credit days? (Optional)",
        required: false,
        inputType: "number",
      },
      notes: {
        key: "notes",
        label: "Notes",
        question: "Any additional notes? (Optional)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Create Supplier:\n• Name: {supplier_name}\n• Contact: {contact_person}\n• Phone: {phone}\n• WhatsApp: {whatsapp}\n• City: {city}\n• Area: {area}\n• Credit Limit: {credit_limit}\n• Credit Days: {credit_days}\n• Notes: {notes}\n\nShould I proceed?",
    executionFunction: "executeCreateSupplier",
  },

  update_supplier: {
    actionType: "update_supplier",
    label: "Update Supplier",
    description: "Update an existing supplier's details",
    requiredFields: ["supplier_id"],
    optionalFields: ["supplier_name", "contact_person", "phone", "whatsapp", "city", "area", "notes", "credit_limit", "credit_days"],
    fieldDefinitions: {
      supplier_id: {
        key: "supplier_id",
        label: "Supplier",
        question: "Which supplier do you want to update?",
        required: true,
        inputType: "text",
      },
      supplier_name: {
        key: "supplier_name",
        label: "Supplier Name",
        question: "What is the new supplier name? (Optional)",
        required: false,
        inputType: "text",
      },
      contact_person: {
        key: "contact_person",
        label: "Contact Person",
        question: "Who is the contact person? (Optional)",
        required: false,
        inputType: "text",
      },
      phone: {
        key: "phone",
        label: "Phone",
        question: "What is the phone number? (Optional)",
        required: false,
        inputType: "text",
      },
      whatsapp: {
        key: "whatsapp",
        label: "WhatsApp",
        question: "What is the WhatsApp number? (Optional)",
        required: false,
        inputType: "text",
      },
      city: {
        key: "city",
        label: "City",
        question: "Which city? (Optional)",
        required: false,
        inputType: "text",
      },
      area: {
        key: "area",
        label: "Area",
        question: "Which area? (Optional)",
        required: false,
        inputType: "text",
      },
      notes: {
        key: "notes",
        label: "Notes",
        question: "Any additional notes? (Optional)",
        required: false,
        inputType: "text",
      },
      credit_limit: {
        key: "credit_limit",
        label: "Credit Limit",
        question: "What is the credit limit? (Optional)",
        required: false,
        inputType: "number",
      },
      credit_days: {
        key: "credit_days",
        label: "Credit Days",
        question: "How many credit days? (Optional)",
        required: false,
        inputType: "number",
      },
    },
    confirmationTemplate:
      "Update Supplier:\n• Supplier: {supplier_id}\n• Name: {supplier_name}\n• Contact: {contact_person}\n• Phone: {phone}\n• City: {city}\n• Area: {area}\n• Credit Limit: {credit_limit}\n• Credit Days: {credit_days}\n\nShould I proceed?",
    executionFunction: "executeUpdateSupplier",
  },

  delete_supplier: {
    actionType: "delete_supplier",
    label: "Delete Supplier",
    description: "Remove a supplier from the records",
    requiredFields: ["supplier_id"],
    optionalFields: [],
    fieldDefinitions: {
      supplier_id: {
        key: "supplier_id",
        label: "Supplier",
        question: "Which supplier do you want to delete?",
        required: true,
        inputType: "text",
      },
    },
    confirmationTemplate: "Delete Supplier:\n• Supplier: {supplier_id}\n\nShould I proceed?",
    executionFunction: "executeDeleteSupplier",
  },

  create_product: {
    actionType: "create_product",
    label: "Create Product",
    description: "Add a new product",
    requiredFields: ["name"],
    optionalFields: ["brand_id", "category_id", "unit_type", "purchase_price", "selling_price", "min_stock", "reorder_level", "track_batch", "track_expiry"],
    fieldDefinitions: {
      name: {
        key: "name",
        label: "Product Name",
        question: "What is the product name?",
        required: true,
        inputType: "text",
        validation: (v) => ({ valid: String(v).trim().length > 0, error: "Product name is required" }),
      },
      brand_id: {
        key: "brand_id",
        label: "Brand",
        question: "Which brand? (Optional)",
        required: false,
        inputType: "select",
      },
      category_id: {
        key: "category_id",
        label: "Category",
        question: "Which category? (Optional)",
        required: false,
        inputType: "select",
      },
      unit_type: {
        key: "unit_type",
        label: "Unit Type",
        question: "What unit? (carton, piece, kg, liter, etc.)",
        required: false,
        inputType: "text",
      },
      purchase_price: {
        key: "purchase_price",
        label: "Purchase Price",
        question: "What is the default purchase price? (Optional)",
        required: false,
        inputType: "number",
      },
      selling_price: {
        key: "selling_price",
        label: "Selling Price",
        question: "What is the default selling price? (Optional)",
        required: false,
        inputType: "number",
      },
      min_stock: {
        key: "min_stock",
        label: "Min Stock Level",
        question: "What is the minimum stock level? (Optional)",
        required: false,
        inputType: "number",
      },
      reorder_level: {
        key: "reorder_level",
        label: "Reorder Level",
        question: "What is the reorder level? (Optional)",
        required: false,
        inputType: "number",
      },
      track_batch: {
        key: "track_batch",
        label: "Track Batch",
        question: "Track batch numbers? (yes/no)",
        required: false,
        inputType: "boolean",
      },
      track_expiry: {
        key: "track_expiry",
        label: "Track Expiry",
        question: "Track expiry dates? (yes/no)",
        required: false,
        inputType: "boolean",
      },
    },
    confirmationTemplate:
      "Create Product:\n• Name: {name}\n• Brand: {brand_name}\n• Category: {category_name}\n• Unit: {unit_type}\n• Purchase Price: {purchase_price}\n• Selling Price: {selling_price}\n• Min Stock: {min_stock}\n• Reorder: {reorder_level}\n• Track Batch: {track_batch}\n• Track Expiry: {track_expiry}\n\nShould I proceed?",
    executionFunction: "executeCreateProduct",
  },

  business_query: {
    actionType: "business_query",
    label: "Business Query",
    description: "Answer a business question",
    requiredFields: ["question"],
    optionalFields: ["language", "query_type", "date_range"],
    fieldDefinitions: {
      question: {
        key: "question",
        label: "Question",
        question: "What would you like to know about your business?",
        required: true,
        inputType: "text",
        validation: (v) => ({ valid: String(v).trim().length > 0, error: "Question is required" }),
      },
      language: {
        key: "language",
        label: "Language",
        question: "What language? (auto, english, urdu, roman_urdu)",
        required: false,
        inputType: "select",
      },
      query_type: {
        key: "query_type",
        label: "Query Type",
        question: "What type of query? (general, analytics_explainer)",
        required: false,
        inputType: "select",
      },
      date_range: {
        key: "date_range",
        label: "Date Range",
        question: "What date range? (today, this_week, this_month, custom)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Ask Business Question:\n• Question: {question}\n• Language: {language}\n• Type: {query_type}\n• Date Range: {date_range}\n\nShould I proceed?",
    executionFunction: "executeBusinessQuery",
  },

  market_intelligence: {
    actionType: "market_intelligence",
    label: "Market Intelligence Analysis",
    description: "Analyze a market signal",
    requiredFields: ["title", "raw_text"],
    optionalFields: ["summary", "source_name", "source_url", "market_category", "context_country", "business_context"],
    fieldDefinitions: {
      title: {
        key: "title",
        label: "Title",
        question: "What is the title of this market signal?",
        required: true,
        inputType: "text",
      },
      summary: {
        key: "summary",
        label: "Summary",
        question: "Brief summary? (Optional)",
        required: false,
        inputType: "text",
      },
      raw_text: {
        key: "raw_text",
        label: "Raw Text",
        question: "Paste the full text or notes:",
        required: true,
        inputType: "text",
      },
      source_name: {
        key: "source_name",
        label: "Source Name",
        question: "What is the source? (Optional)",
        required: false,
        inputType: "text",
      },
      source_url: {
        key: "source_url",
        label: "Source URL",
        question: "Source URL? (Optional)",
        required: false,
        inputType: "text",
      },
      market_category: {
        key: "market_category",
        label: "Market Category",
        question: "Which category? (cooking_oil_ghee, sugar, wheat_flour, rice, pulses, spices, beverages, dairy, fuel_transport, packaging, currency_imports, taxes_policy, weather_agriculture, general_fmcg)",
        required: false,
        inputType: "select",
      },
      context_country: {
        key: "context_country",
        label: "Country",
        question: "Which country? (Defaults to Pakistan)",
        required: false,
        inputType: "text",
      },
      business_context: {
        key: "business_context",
        label: "Business Context",
        question: "Your business context? (Defaults to small wholesale/trading)",
        required: false,
        inputType: "text",
      },
    },
    confirmationTemplate:
      "Analyze Market Signal:\n• Title: {title}\n• Summary: {summary}\n• Category: {market_category}\n• Country: {context_country}\n\nShould I proceed?",
    executionFunction: "executeMarketIntelligence",
  },

  staff_query: {
    actionType: "staff_query",
    label: "Staff Query",
    description: "User asking about staff status, duty, or assignments",
    requiredFields: [],
    optionalFields: [],
    fieldDefinitions: {},
    confirmationTemplate: "",
    executionFunction: "",
  },

  customer_query: {
    actionType: "customer_query",
    label: "Customer Query",
    description: "User asking about customers, balances, credit, history or analytics",
    requiredFields: [],
    optionalFields: [],
    fieldDefinitions: {},
    confirmationTemplate: "",
    executionFunction: "",
  },

  supplier_query: {
    actionType: "supplier_query",
    label: "Supplier Query",
    description: "User asking about suppliers, payables, credit, history or analytics",
    requiredFields: [],
    optionalFields: [],
    fieldDefinitions: {},
    confirmationTemplate: "",
    executionFunction: "",
  },

  assign_staff: {
    actionType: "assign_staff",
    label: "Assign Staff",
    description: "Assign an employee to a duty area",
    requiredFields: ["employee_id", "area"],
    optionalFields: [],
    fieldDefinitions: {
      employee_id: {
        key: "employee_id",
        label: "Employee",
        question: "Which employee do you want to assign?",
        required: true,
        inputType: "text",
      },
      area: {
        key: "area",
        label: "Area",
        question: "Which area should the employee be assigned to?",
        required: true,
        inputType: "text",
      },
    },
    confirmationTemplate: "Assign Employee:\n• Employee: {employee_id}\n• Area: {area}\n\nShould I proceed?",
    executionFunction: "executeAssignStaff",
  },

  reassign_staff: {
    actionType: "reassign_staff",
    label: "Reassign Staff",
    description: "Change an employee's duty area",
    requiredFields: ["employee_id", "area"],
    optionalFields: [],
    fieldDefinitions: {
      employee_id: {
        key: "employee_id",
        label: "Employee",
        question: "Which employee do you want to reassign?",
        required: true,
        inputType: "text",
      },
      area: {
        key: "area",
        label: "New Area",
        question: "Which new area should the employee be assigned to?",
        required: true,
        inputType: "text",
      },
    },
    confirmationTemplate: "Reassign Employee:\n• Employee: {employee_id}\n• New Area: {area}\n\nShould I proceed?",
    executionFunction: "executeReassignStaff",
  },

  remove_staff: {
    actionType: "remove_staff",
    label: "Remove Staff from Duty",
    description: "Remove an employee from their duty assignment",
    requiredFields: ["employee_id"],
    optionalFields: [],
    fieldDefinitions: {
      employee_id: {
        key: "employee_id",
        label: "Employee",
        question: "Which employee do you want to remove from duty?",
        required: true,
        inputType: "text",
      },
    },
    confirmationTemplate: "Remove Employee from Duty:\n• Employee: {employee_id}\n\nShould I proceed?",
    executionFunction: "executeRemoveStaff",
  },

  location_query: {
    actionType: "location_query",
    label: "Location Query",
    description: "User asking about employee locations or tracking",
    requiredFields: [],
    optionalFields: [],
    fieldDefinitions: {},
    confirmationTemplate: "",
    executionFunction: "",
  },

  inventory_query: {
    actionType: "inventory_query",
    label: "Inventory Query",
    description: "User asking about inventory status or product stock",
    requiredFields: [],
    optionalFields: [],
    fieldDefinitions: {},
    confirmationTemplate: "",
    executionFunction: "",
  },

  unknown: {
    actionType: "unknown",
    label: "Unknown",
    description: "Action type not recognized",
    requiredFields: [],
    optionalFields: [],
    fieldDefinitions: {},
    confirmationTemplate: "",
    executionFunction: "",
  },
};

// Helper to get schema for action type
export function getActionSchema(actionType: ActionType): ActionSchema {
  return ACTION_SCHEMAS[actionType] ?? ACTION_SCHEMAS.unknown;
}

// Helper to get next required field
export function getNextRequiredField(context: ConversationContext): string | null {
  if (!context.actionType) return null;
  const schema = getActionSchema(context.actionType);
  const allFields = [...schema.requiredFields, ...schema.optionalFields];

  for (const field of allFields) {
    if (context.collectedData[field] === undefined || context.collectedData[field] === null || context.collectedData[field] === "") {
      return field;
    }
  }
  return null;
}

// Helper to check if all required fields are collected
export function hasAllRequiredFields(context: ConversationContext): boolean {
  if (!context.actionType) return false;
  const schema = getActionSchema(context.actionType);
  return schema.requiredFields.every((field) => {
    const value = context.collectedData[field];
    return value !== undefined && value !== null && value !== "";
  });
}

// Helper to format confirmation summary
export function formatConfirmationSummary(context: ConversationContext): string {
  if (!context.actionType) return "";
  const schema = getActionSchema(context.actionType);
  const allFields = [...schema.requiredFields, ...schema.optionalFields];

  let summary = schema.confirmationTemplate;
  for (const field of allFields) {
    const value = context.collectedData[field];
    if (value !== undefined && value !== null && value !== "") {
      const label = schema.fieldDefinitions[field]?.label ?? field;
      summary = summary.replace(new RegExp(`\\{${field}\\}`, "g"), String(value));
    }
  }
  return summary;
}

// Export runtime reference for execution
export const EXECUTION_FUNCTIONS: Record<string, string> = {
  executeSaleDraft: "@sales-executor",
  executePurchaseDraft: "@purchase-executor",
  executeExpenseDraft: "TODO",
  executeTaskDraft: "TODO",
  executeCreateCustomer: "TODO",
  executeCreateSupplier: "TODO",
  executeCreateProduct: "TODO",
  executeBusinessQuery: "TODO",
  executeMarketIntelligence: "TODO",
  executeAssignStaff: "@staff-executor",
  executeReassignStaff: "@staff-executor",
  executeRemoveStaff: "@staff-executor",
};

// Helper to create initial conversation context
export function createConversationContext(
  sessionId: string,
  organizationId: string,
  profileId: string | null
): ConversationContext {
  const now = new Date();
  const timeoutAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

  return {
    sessionId,
    organizationId,
    profileId,
    state: "idle",
    actionType: null,
    collectedData: {},
    pendingField: null,
    actionDraftId: null,
    awaitingConfirmation: false,
    confirmationSummary: null,
    startedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    timeoutAt: timeoutAt.toISOString(),
    error: null,
    retryCount: 0,
    messages: [],
  };
}

// Helper to add message to conversation
export function addConversationMessage(
  context: ConversationContext,
  role: "user" | "assistant" | "system",
  type: ConversationMessage["type"],
  text: string,
  field?: string,
  parsedValue?: unknown
): ConversationContext {
  const message: ConversationMessage = {
    id: crypto.randomUUID(),
    role,
    type,
    text,
    field,
    timestamp: new Date().toISOString(),
    parsedValue,
  };

  return {
    ...context,
    messages: [...context.messages, message],
    lastActivityAt: new Date().toISOString(),
  };
}

// Helper to update conversation state
export function updateConversationState(
  context: ConversationContext,
  newState: ConversationState
): ConversationContext {
  if (!canTransition(context.state, newState)) {
    console.warn(`Invalid state transition: ${context.state} -> ${newState}`);
    return context;
  }

  return {
    ...context,
    state: newState,
    lastActivityAt: new Date().toISOString(),
  };
}

// Helper to update collected data
export function updateCollectedData(
  context: ConversationContext,
  data: Record<string, unknown>
): ConversationContext {
  return {
    ...context,
    collectedData: { ...context.collectedData, ...data },
    lastActivityAt: new Date().toISOString(),
  };
}

// Helper to reset timeout
export function resetConversationTimeout(context: ConversationContext): ConversationContext {
  const now = new Date();
  const timeoutAt = new Date(now.getTime() + 5 * 60 * 1000);

  return {
    ...context,
    timeoutAt: timeoutAt.toISOString(),
    lastActivityAt: now.toISOString(),
  };
}

// Helper to check if conversation has timed out
export function isConversationTimedOut(context: ConversationContext): boolean {
  if (!context.timeoutAt) return false;
  return new Date(context.timeoutAt) < new Date();
}

// Default timeout configuration
export const DEFAULT_TIMEOUT_CONFIG: ConversationTimeoutConfig = {
  timeoutMinutes: 5,
  warningMinutes: 1,
  onTimeout: () => {},
  onWarning: () => {},
};