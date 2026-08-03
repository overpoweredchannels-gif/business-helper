import { PurchaseRepository, NewPurchaseItem } from "../repositories/purchase-repository";
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
  constructor(
    private readonly repository = new PurchaseRepository(),
    private readonly audit = new AuditRepository(),
    private readonly invoiceNumbers = new InvoiceNumberService(),
  ) {}

  static withSupabase(supabase: SupabaseClient): PurchaseService {
    return new PurchaseService(
      new PurchaseRepository(supabase),
      new AuditRepository(supabase),
      new InvoiceNumberService(supabase),
    );
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
    }> = (Array.isArray(input.lines) ? input.lines : []).map((line) => {
      const record = line as Record<string, unknown>;
      return {
        product_id: record.product_id as string | number | null,
        quantity: record.quantity as string | number | null,
        purchase_price: record.purchase_price as string | number | null,
        selling_price: record.selling_price as string | number | null | undefined,
        batch_number: record.batch_number as string | null | undefined,
        expiry_date: record.expiry_date as string | null | undefined,
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
    const creditDays = normalizeOptionalNumber(input.credit_days);

    const totalAmount = lines.reduce(
      (sum, line) => sum + Number(line.quantity) * Number(line.purchase_price),
      0,
    );

    const invoiceNumber = await this.invoiceNumbers.generatePurchaseInvoice(actor.organizationId);

    const transaction = await this.repository.createTransaction({
      organization_id: actor.organizationId,
      supplier_id: supplierId,
      invoice_number: invoiceNumber,
      purchase_date: purchaseDate,
      payment_type: paymentType,
      credit_due_date:
        paymentType === "credit" && creditDays !== null
          ? new Date(Date.now() + creditDays * 86400000).toISOString()
          : null,
      notes: normalizeOptionalText(input.notes),
      total_amount: totalAmount,
      status: "confirmed",
      invoice_type: "purchase",
      created_by_profile_id: (input.created_by_profile_id as string) || actor.profileId,
      supplier_invoice_number: normalizeOptionalText(input.supplier_invoice_number),
    });

    const items: NewPurchaseItem[] = lines.map((line) => ({
      purchase_transaction_id: transaction.id,
      organization_id: actor.organizationId,
      product_id: line.product_id as string,
      quantity: Number(line.quantity),
      purchase_price: Number(line.purchase_price),
      selling_price: normalizeOptionalNumber(line.selling_price),
      batch_number: normalizeOptionalText(line.batch_number),
      expiry_date: normalizeOptionalDate(line.expiry_date),
    }));

    try {
      await this.repository.addItems(items);
    } catch (err) {
      await this.repository.deleteTransaction(actor.organizationId, transaction.id);
      throw err;
    }

    if (paymentType === "credit") {
      const newBalance = Number(supplier.outstanding_balance ?? 0) + totalAmount;
      await this.repository.updateSupplierBalance(supplierId, newBalance);
    }

    await this.audit.create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "purchase_created",
      entity_type: "purchase_transaction",
      entity_id: transaction.id,
      entity_label: invoiceNumber,
      description: `Created purchase ${invoiceNumber}`,
      new_values: { supplier_id: supplierId, total_amount: totalAmount },
    });

    return { transaction, items };
  }

  async deletePurchase(actor: ActorContext, purchaseId: string) {
    if (!actor.organizationId) {
      throw new Error("Organization context required");
    }

    const transaction = await this.repository.findTransactionById(actor.organizationId, purchaseId);
    if (!transaction) {
      throw new Error("Purchase not found");
    }

    await this.repository.deleteItemsForTransaction(purchaseId);
    await this.repository.deleteTransaction(actor.organizationId, purchaseId);

    await this.audit.create({
      organization_id: actor.organizationId,
      actor_profile_id: actor.profileId,
      actor_email: actor.email,
      action: "purchase_deleted",
      entity_type: "purchase_transaction",
      entity_id: purchaseId,
      entity_label: transaction.invoice_number,
      description: `Deleted purchase ${transaction.invoice_number}`,
      old_values: { invoice_number: transaction.invoice_number },
    });
  }
}
