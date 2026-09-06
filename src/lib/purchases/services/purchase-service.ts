import { PurchaseRepository } from "../repositories/purchase-repository";
import { AuditRepository } from "@/lib/audit/audit-repository";
import { InvoiceNumberService } from "@/lib/invoices/invoice-number-service";
import {
  validatePurchaseTransactionInput,
  normalizeOptionalText,
  normalizeOptionalNumber,
  normalizeOptionalDate,
} from "../validation";
import type { ActorContext } from "../../identity/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class PurchaseService {
  constructor(private readonly repository = new PurchaseRepository()) {}

  static withSupabase(supabase: SupabaseClient): PurchaseService {
    return new PurchaseService(new PurchaseRepository(supabase));
  }

  async listPurchases(actor: ActorContext) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }
    return this.repository.listTransactions(actor.organizationId);
  }

  async getPurchase(actor: ActorContext, purchaseId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const transaction = await this.repository.findTransactionById(actor.organizationId, purchaseId);
    if (!transaction) {
      throw new Error("Purchase not found");
    }

    const items = await this.repository.listItemsForTransaction(purchaseId);
    return { transaction, items };
  }

  async createPurchase(actor: ActorContext, input: Record<string, unknown>) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const lines: Array<{
      product_id: string | number | null;
      quantity: string | number | null;
      purchase_price: string | number | null;
      selling_price?: string | number | null;
      batch_number?: string | null;
      expiry_date?: string | null;
      unit_mode?: "main" | "subunit";
      order_item_id?: string;
    }> = (Array.isArray(input.lines) ? input.lines : []).map((line) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        throw new Error("Each purchase line must be an object.");
      }
      const record = line as Record<string, unknown>;
      if (record.unit_mode != null && !["main", "subunit"].includes(String(record.unit_mode))) {
        throw new Error("Unit mode must be main or subunit.");
      }
      return {
        order_item_id: typeof record.order_item_id === "string" ? record.order_item_id : undefined,
        product_id: record.product_id as string | number | null,
        quantity: record.quantity as string | number | null,
        purchase_price: record.purchase_price as string | number | null,
        selling_price: record.selling_price as string | number | null | undefined,
        batch_number: record.batch_number as string | null | undefined,
        expiry_date: record.expiry_date as string | null | undefined,
        unit_mode: record.unit_mode === "subunit" ? "subunit" : "main",
      };
    });

    const validation = validatePurchaseTransactionInput({
      supplier_id: input.supplier_id as string | null,
      purchase_date: input.purchase_date as string | null,
      payment_type: input.payment_type as string | null,
      notes: input.notes as string | null,
      lines,
    });
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }

    const creditDays = normalizeOptionalNumber(input.credit_days);
    if (input.credit_days !== undefined && input.credit_days !== null && input.credit_days !== "" &&
        (creditDays === null || !Number.isInteger(creditDays) || creditDays < 0 || creditDays > 36500)) {
      throw new Error("Credit days must be a whole number between 0 and 36500.");
    }

    const supplierId = String(input.supplier_id);
    const supplier = await this.repository.findSupplierById(actor.organizationId, supplierId);
    if (!supplier) {
      throw new Error("Supplier not found");
    }

    const productIds = lines.map((line) => line.product_id as string);
    for (const productId of productIds) {
      const product = await this.repository.findProductById(actor.organizationId, productId);
      if (!product) {
        throw new Error(`Product not found: ${productId}`);
      }
    }

    const paymentType = normalizeOptionalText(input.payment_type)?.toLowerCase() ?? "cash";
    const purchaseDate = normalizeOptionalDate(input.purchase_date) ?? new Date().toISOString().slice(0, 10);

    const totalAmount = lines.reduce(
      (sum, line) => sum + Number(line.quantity) * Number(line.purchase_price),
      0,
    );

    if (!Number.isFinite(totalAmount)) {
      throw new Error("Purchase total exceeds the supported numeric range.");
    }

    return this.repository.createAtomic(actor.organizationId, actor.profileId, {
      supplier_id: supplierId,
      purchase_date: purchaseDate,
      payment_type: paymentType,
      credit_days: creditDays,
      notes: normalizeOptionalText(input.notes),
      supplier_invoice_number: normalizeOptionalText(input.supplier_invoice_number),
      request_key: normalizeOptionalText(input.request_key),
      purchase_order_id: normalizeOptionalText(input.purchase_order_id),
      lines: lines.map((line) => ({ ...line,
        quantity: Number(line.quantity), purchase_price: Number(line.purchase_price),
        selling_price: normalizeOptionalNumber(line.selling_price),
        batch_number: normalizeOptionalText(line.batch_number), expiry_date: normalizeOptionalDate(line.expiry_date),
      })),
    });
  }

  async deletePurchase(actor: ActorContext, purchaseId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    await this.repository.deleteAtomic(actor.organizationId, actor.profileId, purchaseId);
  }
}
