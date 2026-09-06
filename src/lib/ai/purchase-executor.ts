import { authorizedFetch } from "@/lib/tradeos/authorized-fetch";
type PurchaseInput = {
  supplier_id: string;
  product_id: string;
  quantity: number;
  purchase_price: number;
  payment_type: "cash" | "credit";
  invoice_number?: string;
  invoice_date?: string;
  credit_days?: number;
  notes?: string;
};

type PurchaseResult = {
  ok: boolean;
  purchaseId?: string;
  invoiceNumber?: string;
  message: string;
  error?: string;
};

export async function executePurchaseDraft(
  collectedData: Record<string, unknown>,
  organizationId: string
): Promise<PurchaseResult> {
  const errors: string[] = [];

  const supplierId = String(collectedData.supplier_id || "");
  const productId = String(collectedData.product_id || "");
  const quantity = Number(collectedData.quantity) || 0;
  const purchasePrice = Number(collectedData.purchase_price) || 0;
  const paymentType = String(collectedData.payment_type || "").toLowerCase();

  if (!supplierId) errors.push("Supplier is required");
  if (!productId) errors.push("Product is required");
  if (quantity <= 0) errors.push("Quantity must be a positive number");
  if (purchasePrice < 0) errors.push("Purchase price must be a valid number");
  if (!paymentType || !["cash", "credit"].includes(paymentType)) {
    errors.push("Payment type must be 'cash' or 'credit'");
  }

  if (errors.length > 0) {
    return { ok: false, message: "", error: errors.join("; ") };
  }

  const purchaseInput: PurchaseInput & { organizationId: string } = {
    organizationId,
    supplier_id: supplierId,
    product_id: productId,
    quantity,
    purchase_price: purchasePrice,
    payment_type: paymentType as "cash" | "credit",
    invoice_number: collectedData.invoice_number as string | undefined,
    invoice_date: collectedData.invoice_date as string | undefined,
    credit_days: collectedData.credit_days ? Number(collectedData.credit_days) : undefined,
    notes: collectedData.notes as string | undefined,
  };

  try {
    const response = await authorizedFetch("/api/ai/purchases/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(purchaseInput),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      return {
        ok: false,
        message: "",
        error: result.error || "Failed to create purchase",
      };
    }

    return {
      ok: true,
      purchaseId: result.purchaseId,
      invoiceNumber: result.invoiceNumber,
      message: formatPurchaseSuccessMessage(result),
    };
  } catch (err) {
    return {
      ok: false,
      message: "",
      error: err instanceof Error ? err.message : "Network error while creating purchase",
    };
  }
}

function formatPurchaseSuccessMessage(result: { invoiceNumber?: string; supplierName?: string; productName?: string; quantity?: number; total?: number }): string {
  const supplier = result.supplierName || "";
  const product = result.productName || "";
  const qty = result.quantity || 0;
  const total = result.total || 0;
  const inv = result.invoiceNumber || "";

  const parts: string[] = ["Purchase created successfully."];
  if (supplier) parts.push(`Supplier: ${supplier}.`);
  if (product) parts.push(`Product: ${product}.`);
  if (qty) parts.push(`Quantity: ${qty}.`);
  if (total) parts.push(`Total: PKR ${total.toLocaleString("en-PK")}.`);
  if (inv) parts.push(`Invoice number: ${inv}.`);

  return parts.join(" ");
}

export function validatePurchaseInput(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!input.supplier_id) errors.push("supplier_id is required");
  if (!input.product_id) errors.push("product_id is required");
  if (!input.quantity || Number(input.quantity) <= 0) errors.push("quantity must be a positive number");
  if (input.purchase_price === undefined || Number(input.purchase_price) < 0) errors.push("purchase_price is required and must be >= 0");
  if (!input.payment_type || !["cash", "credit"].includes(String(input.payment_type).toLowerCase())) {
    errors.push("payment_type must be 'cash' or 'credit'");
  }
  return errors;
}

export type { PurchaseInput, PurchaseResult };
