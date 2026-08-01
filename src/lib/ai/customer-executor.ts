type CreateCustomerInput = {
  organizationId: string;
  customer_name: string;
  shop_name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  city?: string | null;
  area?: string | null;
  customer_type?: string | null;
  credit_limit?: number | null;
  credit_days?: number | null;
  credit_policy?: string | null;
  preferred_payment_method?: string | null;
};

type UpdateCustomerInput = Partial<CreateCustomerInput> & {
  organizationId: string;
  customer_id: string;
};

type CustomerResult = {
  ok: boolean;
  customerId?: string;
  message: string;
  error?: string;
};

export async function executeCreateCustomer(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<CustomerResult> {
  const errors: string[] = [];

  const customerName = String(collectedData.customer_name ?? "").trim();
  if (!customerName) errors.push("Customer name is required");

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  const input: CreateCustomerInput = {
    organizationId,
    customer_name: customerName,
    shop_name: collectedData.shop_name ? String(collectedData.shop_name) : null,
    phone: collectedData.phone ? String(collectedData.phone) : null,
    whatsapp: collectedData.whatsapp ? String(collectedData.whatsapp) : null,
    city: collectedData.city ? String(collectedData.city) : null,
    area: collectedData.area ? String(collectedData.area) : null,
    customer_type: collectedData.customer_type ? String(collectedData.customer_type) : null,
    credit_limit: collectedData.credit_limit === undefined || collectedData.credit_limit === null || collectedData.credit_limit === ""
      ? null
      : Number(collectedData.credit_limit),
    credit_days: collectedData.credit_days === undefined || collectedData.credit_days === null || collectedData.credit_days === ""
      ? null
      : Number(collectedData.credit_days),
    preferred_payment_method: collectedData.preferred_payment_method ? String(collectedData.preferred_payment_method) : null,
  };

  try {
    const response = await fetch("/api/ai/customers/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to create customer",
      };
    }

    return {
      ok: true,
      customerId: result.customerId,
      message: formatCreateCustomerMessage(result),
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while creating customer",
    };
  }
}

export async function executeUpdateCustomer(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<CustomerResult> {
  const errors: string[] = [];

  const customerId = String(collectedData.customer_id ?? "");
  if (!customerId) errors.push("Customer is required");

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  const input: UpdateCustomerInput = {
    organizationId,
    customer_id: customerId,
  };
  for (const field of [
    "customer_name",
    "shop_name",
    "phone",
    "whatsapp",
    "city",
    "area",
    "customer_type",
    "preferred_payment_method",
  ] as const) {
    if (collectedData[field] !== undefined && collectedData[field] !== null) {
      input[field] = String(collectedData[field]);
    }
  }
  for (const field of ["credit_limit", "credit_days"] as const) {
    if (collectedData[field] !== undefined && collectedData[field] !== null && collectedData[field] !== "") {
      input[field] = Number(collectedData[field]);
    }
  }

  try {
    const response = await fetch("/api/ai/customers/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to update customer",
      };
    }

    return {
      ok: true,
      customerId: result.customerId,
      message: "Customer updated successfully.",
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while updating customer",
    };
  }
}

export async function executeDeleteCustomer(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<CustomerResult> {
  const errors: string[] = [];

  const customerId = String(collectedData.customer_id ?? "");
  if (!customerId) errors.push("Customer is required");

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  try {
    const response = await fetch("/api/ai/customers/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, customer_id: customerId }),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to delete customer",
      };
    }

    return {
      ok: true,
      customerId: result.customerId,
      message: "Customer deleted successfully.",
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while deleting customer",
    };
  }
}

function formatCreateCustomerMessage(result: { customerId?: string; customerName?: string }): string {
  const parts: string[] = ["Customer created successfully."];
  if (result.customerName) parts.push(`Name: ${result.customerName}.`);
  return parts.join(" ");
}

export function validateCustomerInput(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!input.customer_name || !String(input.customer_name).trim()) errors.push("customer_name is required");
  if (input.credit_limit !== undefined && input.credit_limit !== null && input.credit_limit !== "") {
    if (!Number.isFinite(Number(input.credit_limit))) errors.push("credit_limit must be a valid number");
  }
  if (input.credit_days !== undefined && input.credit_days !== null && input.credit_days !== "") {
    if (!Number.isFinite(Number(input.credit_days))) errors.push("credit_days must be a valid number");
  }
  return errors;
}

export type { CreateCustomerInput, UpdateCustomerInput, CustomerResult };
