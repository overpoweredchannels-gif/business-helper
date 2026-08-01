type SaleInput = {
  customer_id: string;
  product_id: string;
  quantity: number;
  selling_price: number;
  payment_type: "cash" | "credit";
  invoice_date?: string;
  credit_days?: number;
  notes?: string;
};

type SaleResult = {
  ok: boolean;
  saleId?: string;
  invoiceNumber?: string;
  message: string;
  error?: string;
};

export async function executeSaleDraft(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<SaleResult> {
  const errors: string[] = [];

  const customerId = String(collectedData.customer_id || "");
  const productId = String(collectedData.product_id || "");
  const quantity = Number(collectedData.quantity) || 0;
  const sellingPrice = Number(collectedData.selling_price) || 0;
  const paymentType = String(collectedData.payment_type || "").toLowerCase();

  if (!customerId) errors.push("Customer is required");
  if (!productId) errors.push("Product is required");
  if (quantity <= 0) errors.push("Quantity must be a positive number");
  if (sellingPrice < 0) errors.push("Selling price must be a valid number");
  if (!paymentType || !["cash", "credit"].includes(paymentType)) {
    errors.push("Payment type must be 'cash' or 'credit'");
  }

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  const saleInput: SaleInput & { organizationId: string } = {
    organizationId,
    customer_id: customerId,
    product_id: productId,
    quantity,
    selling_price: sellingPrice,
    payment_type: paymentType as "cash" | "credit",
    invoice_date: collectedData.invoice_date as string | undefined,
    credit_days: collectedData.credit_days ? Number(collectedData.credit_days) : undefined,
    notes: collectedData.notes as string | undefined,
  };

  try {
    const response = await fetch("/api/ai/sales/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saleInput),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to create sale",
      };
    }

    return {
      ok: true,
      saleId: result.saleId,
      invoiceNumber: result.invoiceNumber,
      message: formatSaleSuccessMessage(result),
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while creating sale",
    };
  }
}

function formatSaleSuccessMessage(result: { invoiceNumber?: string; customerName?: string; productName?: string; quantity?: number; total?: number }): string {
  const customer = result.customerName || "";
  const product = result.productName || "";
  const qty = result.quantity || 0;
  const total = result.total || 0;
  const inv = result.invoiceNumber || "";

  const parts: string[] = ["Sale created successfully."];
  if (customer) parts.push(`Customer: ${customer}.`);
  if (product) parts.push(`Product: ${product}.`);
  if (qty) parts.push(`Quantity: ${qty}.`);
  if (total) parts.push(`Total: PKR ${total.toLocaleString("en-PK")}.`);
  if (inv) parts.push(`Invoice number: ${inv}.`);

  return parts.join(" ");
}

export function validateSaleInput(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!input.customer_id) errors.push("customer_id is required");
  if (!input.product_id) errors.push("product_id is required");
  if (!input.quantity || Number(input.quantity) <= 0) errors.push("quantity must be a positive number");
  if (input.selling_price === undefined || Number(input.selling_price) < 0) errors.push("selling_price is required and must be >= 0");
  if (!input.payment_type || !["cash", "credit"].includes(String(input.payment_type).toLowerCase())) {
    errors.push("payment_type must be 'cash' or 'credit'");
  }
  return errors;
}

export type { SaleInput, SaleResult };
