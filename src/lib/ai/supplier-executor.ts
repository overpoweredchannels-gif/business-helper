type CreateSupplierInput = {
  organizationId: string;
  supplier_name: string;
  contact_person?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  city?: string | null;
  area?: string | null;
  notes?: string | null;
  credit_limit?: number | null;
  credit_days?: number | null;
  credit_policy?: string | null;
  preferred_payment_method?: string | null;
};

type UpdateSupplierInput = Partial<CreateSupplierInput> & {
  organizationId: string;
  supplier_id: string;
};

type SupplierResult = {
  ok: boolean;
  supplierId?: string;
  message: string;
  error?: string;
};

export async function executeCreateSupplier(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<SupplierResult> {
  const errors: string[] = [];

  const supplierName = String(collectedData.supplier_name ?? "").trim();
  if (!supplierName) errors.push("Supplier name is required");

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  const input: CreateSupplierInput = {
    organizationId,
    supplier_name: supplierName,
    contact_person: collectedData.contact_person ? String(collectedData.contact_person) : null,
    phone: collectedData.phone ? String(collectedData.phone) : null,
    whatsapp: collectedData.whatsapp ? String(collectedData.whatsapp) : null,
    city: collectedData.city ? String(collectedData.city) : null,
    area: collectedData.area ? String(collectedData.area) : null,
    notes: collectedData.notes ? String(collectedData.notes) : null,
    credit_limit: collectedData.credit_limit === undefined || collectedData.credit_limit === null || collectedData.credit_limit === ""
      ? null
      : Number(collectedData.credit_limit),
    credit_days: collectedData.credit_days === undefined || collectedData.credit_days === null || collectedData.credit_days === ""
      ? null
      : Number(collectedData.credit_days),
    preferred_payment_method: collectedData.preferred_payment_method ? String(collectedData.preferred_payment_method) : null,
  };

  try {
    const response = await fetch("/api/ai/suppliers/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to create supplier",
      };
    }

    return {
      ok: true,
      supplierId: result.supplierId,
      message: formatCreateSupplierMessage(result),
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while creating supplier",
    };
  }
}

export async function executeUpdateSupplier(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<SupplierResult> {
  const errors: string[] = [];

  const supplierId = String(collectedData.supplier_id ?? "");
  if (!supplierId) errors.push("Supplier is required");

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  const input: UpdateSupplierInput = {
    organizationId,
    supplier_id: supplierId,
  };
  for (const field of [
    "supplier_name",
    "contact_person",
    "phone",
    "whatsapp",
    "city",
    "area",
    "notes",
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
    const response = await fetch("/api/ai/suppliers/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to update supplier",
      };
    }

    return {
      ok: true,
      supplierId: result.supplierId,
      message: "Supplier updated successfully.",
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while updating supplier",
    };
  }
}

export async function executeDeleteSupplier(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<SupplierResult> {
  const errors: string[] = [];

  const supplierId = String(collectedData.supplier_id ?? "");
  if (!supplierId) errors.push("Supplier is required");

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  try {
    const response = await fetch("/api/ai/suppliers/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, supplier_id: supplierId }),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to delete supplier",
      };
    }

    return {
      ok: true,
      supplierId: result.supplierId,
      message: "Supplier deleted successfully.",
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while deleting supplier",
    };
  }
}

function formatCreateSupplierMessage(result: { supplierId?: string; supplierName?: string }): string {
  const parts: string[] = ["Supplier created successfully."];
  if (result.supplierName) parts.push(`Name: ${result.supplierName}.`);
  return parts.join(" ");
}

export function validateSupplierInput(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!input.supplier_name || !String(input.supplier_name).trim()) errors.push("supplier_name is required");
  if (input.credit_limit !== undefined && input.credit_limit !== null && input.credit_limit !== "") {
    if (!Number.isFinite(Number(input.credit_limit))) errors.push("credit_limit must be a valid number");
  }
  if (input.credit_days !== undefined && input.credit_days !== null && input.credit_days !== "") {
    if (!Number.isFinite(Number(input.credit_days))) errors.push("credit_days must be a valid number");
  }
  return errors;
}

export type { CreateSupplierInput, UpdateSupplierInput, SupplierResult };
