import { createSupabaseService } from "@/lib/supabase/server";
import { getInvoiceNumberService, generateSalesInvoice } from "@/lib/invoices/invoice-number-service";
import { logAuditEvent } from "@/lib/identity/audit";
import type { ActorContext } from "@/lib/identity/types";
import { loadSalesmanAssignmentScope } from "@/lib/sales/salesman-workspace-service";

export interface DraftSaleItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  unitMode?: "main" | "subunit";
  bonus?: number;
}

export interface CreateDraftSaleInput {
  customerId: string;
  visitId?: string;
  routeId?: string;
  items: DraftSaleItemInput[];
  notes?: string;
  expectedDate?: string;
  saleDate?: string;
  paymentType?: "cash" | "credit";
  creditDays?: number;
}

export interface DraftSaleResult {
  ok: boolean;
  error?: string;
  draft?: any;
}

export interface DraftListResult {
  ok: boolean;
  error?: string;
  drafts?: any[];
  total?: number;
}

export interface ApproveResult {
  ok: boolean;
  error?: string;
  invoice?: any;
  invoiceNumber?: string;
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

export class DraftSaleService {
  constructor(private readonly draftDependencies = { createSupabaseService, loadSalesmanAssignmentScope, getInvoiceNumberService, logAuditEvent }) {}
  /**
   * Salesman creates a draft sale (status: draft → pending_approval)
   */
  async createDraft(actor: ActorContext, input: CreateDraftSaleInput): Promise<DraftSaleResult> {
    if (!actor.organizationId || !actor.profileId) {
      return { ok: false, error: "Organization context required" };
    }

    if (!input.customerId || input.items.length === 0) {
      return { ok: false, error: "Customer and at least one item are required" };
    }

    if (input.saleDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.saleDate) || Number.isNaN(Date.parse(input.saleDate)) || new Date(input.saleDate).toISOString().slice(0, 10) !== input.saleDate)) {
      return { ok: false, error: "Enter a valid sale date." };
    }

    const supabase = this.draftDependencies.createSupabaseService();

    const canManageAllSales = actor.isOwner
      || actor.permissions?.includes("sales_manage")
      || actor.permissions?.includes("administration");
    if (!canManageAllSales) {
      const scope = await this.draftDependencies.loadSalesmanAssignmentScope({
        organizationId: actor.organizationId,
        profileId: actor.profileId,
      });
      if (!scope || scope.employee.is_active === false) {
        return { ok: false, error: "An active employee profile is required to create a sale" };
      }
      if (input.routeId && String(scope.route?.id ?? "") !== input.routeId) {
        return { ok: false, error: "The selected route is not assigned to you" };
      }
    }

    // Verify customer belongs to org
    const { data: customer } = await supabase
      .from("customers")
      .select("id, customer_name")
      .eq("id", input.customerId)
      .eq("organization_id", actor.organizationId)
      .eq("is_active", true)
      .maybeSingle();

    if (!customer) {
      return { ok: false, error: "Customer not found" };
    }

    // Generate sales order number
    let soNumber: string;
    try {
      soNumber = await this.draftDependencies.getInvoiceNumberService().generateSalesOrder(actor.organizationId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to generate order number" };
    }

    // Verify products and compute totals
    let totalAmount = 0;
    const verifiedItems: DraftSaleItemInput[] = [];
    for (const item of input.items) {
      if (!item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.bonus ?? 0) || (item.bonus ?? 0) < 0 || !Number.isFinite(item.discount ?? 0) || (item.discount ?? 0) < 0 || (item.discount ?? 0) > item.quantity * item.unitPrice || (item.unitMode !== undefined && !["main", "subunit"].includes(item.unitMode))) {
        return { ok: false, error: `Invalid item for product ${item.productId ?? "unknown"}` };
      }
      const { data: product } = await supabase
        .from("products")
        .select("id, name, current_stock, is_active")
        .eq("id", item.productId)
        .eq("organization_id", actor.organizationId)
        .maybeSingle();

      if (!product || product.is_active === false) {
        return { ok: false, error: `Product ${item.productId} not found` };
      }

      totalAmount += item.quantity * item.unitPrice - (item.discount ?? 0);
      verifiedItems.push(item);
    }

    // Insert draft order
    const { data: draft, error: draftError } = await supabase
      .from("sales_orders")
      .insert({
        organization_id: actor.organizationId,
        so_number: soNumber,
        customer_id: input.customerId,
        order_date: input.saleDate ?? new Date().toISOString().split("T")[0],
        expected_date: input.expectedDate ?? null,
        notes: input.notes ?? null,
        status: "pending_approval",
        payment_type: input.paymentType ?? "credit",
        credit_days: input.creditDays ?? null,
        created_by_profile_id: actor.profileId,
      })
      .select()
      .single();

    if (draftError) {
      return { ok: false, error: `Failed to create draft: ${draftError.message}` };
    }

    // Insert line items
    const itemsToInsert = verifiedItems.map((item) => ({
      sales_order_id: draft.id,
      product_id: item.productId,
      quantity_ordered: item.quantity,
      quantity_delivered: 0,
      unit_price: item.unitPrice,
      discount: item.discount ?? 0,
      unit_mode: item.unitMode === "subunit" ? "subunit" : "main",
      bonus: item.bonus ?? 0,
    }));

    const { error: itemsError } = await supabase
      .from("sales_order_items")
      .insert(itemsToInsert);

    if (itemsError) {
      // Rollback draft
      await supabase.from("sales_orders").delete().eq("id", draft.id);
      return { ok: false, error: `Failed to add draft items: ${itemsError.message}` };
    }

    // Create notification for owner (approval required)
    await this.notifyOwnerOfDraft(actor, draft.id, customer.customer_name, totalAmount);

    await this.draftDependencies.logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "draft_sale_created",
      entityType: "sales_order",
      entityId: draft.id,
      description: `Draft sale ${soNumber} created for ${customer.customer_name}`,
      success: true,
    });

    return { ok: true, draft: { ...draft, total_amount: totalAmount } };
  }

  /**
   * Owner lists drafts with filters
   */
  async listDrafts(
    actor: ActorContext,
    filters: {
      status?: string;
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
      createdBy?: string;
      limit?: number;
    } = {}
  ): Promise<DraftListResult> {
    if (!actor.organizationId) {
      return { ok: false, error: "Organization context required" };
    }

    const supabase = createSupabaseService();
    const limit = Math.min(filters.limit ?? 50, 200);

    let query = supabase
      .from("sales_orders")
      .select(`
        id, so_number, customer_id, order_date, expected_date, notes, status,
        created_by_profile_id, created_at, updated_at,
        customers!inner(customer_name, shop_name),
        sales_order_items(product_id, quantity_ordered, unit_price, discount),
        profiles!left(full_name)
      `, { count: "exact" })
      .eq("organization_id", actor.organizationId)
      .in("status", ["pending_approval", "approved", "rejected"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.customerId) {
      query = query.eq("customer_id", filters.customerId);
    }
    if (filters.createdBy) {
      query = query.eq("created_by_profile_id", filters.createdBy);
    }
    if (filters.dateFrom) {
      query = query.gte("order_date", filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte("order_date", filters.dateTo);
    }

    const { data, error, count } = await query;

    if (error) {
      return { ok: false, error: `Failed to load drafts: ${error.message}` };
    }

    // Compute total per draft
    const drafts = (data ?? []).map((draft: any) => {
      const items = draft.sales_order_items ?? [];
      const total = items.reduce(
        (sum: number, item: any) => sum + Number(item.quantity_ordered ?? 0) * Number(item.unit_price ?? 0) - Number(item.discount ?? 0),
        0
      );
      return { ...draft, total_amount: total };
    });

    return { ok: true, drafts, total: count ?? 0 };
  }

  /**
   * Owner approves a draft → auto-converts to sales invoice
   * Flow: draft → confirmed sales_transaction + sales_items (inventory auto-reduces via trigger)
   * + customer receivable updated + notification to salesman
   */
  async approveDraft(actor: ActorContext, draftId: string): Promise<ApproveResult> {
    if (!actor.organizationId) {
      return { ok: false, error: "Organization context required" };
    }
    if (!actor.isOwner && !actor.permissions?.includes("draft_approval")) {
      return { ok: false, error: "Only owner or approver can approve drafts" };
    }

    const supabase = createSupabaseService();

    // Load draft with items
    const { data: draft } = await supabase
      .from("sales_orders")
      .select(`
        id, organization_id, so_number, customer_id, order_date, expected_date, notes,
        status, payment_type, credit_days, created_by_profile_id, created_at,
        sales_order_items(product_id, quantity_ordered, unit_price, discount, unit_mode, bonus)
      `)
      .eq("id", draftId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!draft) {
      return { ok: false, error: "Draft not found" };
    }

    if (draft.status !== "pending_approval") {
      return { ok: false, error: `Draft is not pending approval (current: ${draft.status})` };
    }

    const items = draft.sales_order_items ?? [];
    if (items.length === 0) {
      return { ok: false, error: "Draft has no items" };
    }

    // Include free units and repeated product lines in stock validation.
    const requestedByProduct = new Map<string, number>();
    for (const item of items) {
      const { data: product } = await supabase
        .from("products")
        .select("id, current_stock, units_per_pack, is_active")
        .eq("id", item.product_id)
        .eq("organization_id", actor.organizationId)
        .maybeSingle();

      if (!product || product.is_active === false) {
        return { ok: false, error: `Product ${item.product_id} not found` };
      }

      // Normalize subunit quantities to main units before comparing to stock.
      const lineMain = item.unit_mode === "subunit" && Number(product.units_per_pack ?? 0) > 0
        ? (Number(item.quantity_ordered) + Number(item.bonus ?? 0)) / Number(product.units_per_pack)
        : Number(item.quantity_ordered) + Number(item.bonus ?? 0);
      const requestedMain = (requestedByProduct.get(String(item.product_id)) ?? 0) + lineMain;
      requestedByProduct.set(String(item.product_id), requestedMain);

      const { data: effectivePolicy, error: policyError } = await supabase.rpc(
        "resolve_overselling_policy",
        { p_organization_id: actor.organizationId, p_product_id: item.product_id }
      );
      if (policyError) return { ok: false, error: "Could not verify stock policy. Retry approval." };
      const oversellingAllowed = String(effectivePolicy ?? "allow") !== "block";
      if (!oversellingAllowed && Number(product.current_stock ?? 0) < requestedMain) {
        return { ok: false, error: `Insufficient stock for product ${item.product_id}: ${product.current_stock} available, ${requestedMain} requested` };
      }
    }

    // Generate invoice number
    let invoiceNumber: string;
    try {
      invoiceNumber = await generateSalesInvoice(actor.organizationId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to generate invoice number" };
    }

    // Compute total
    const totalAmount = items.reduce(
      (sum: number, item: any) => sum + Number(item.quantity_ordered ?? 0) * Number(item.unit_price ?? 0) - Number(item.discount ?? 0),
      0
    );

    const now = new Date().toISOString();

    const paymentType = draft.payment_type === "cash" ? "cash" : "credit";
    const creditDueDate =
      paymentType === "credit" && Number(draft.credit_days ?? 0) > 0
        ? addDaysToIsoDate(draft.order_date ?? now.split("T")[0], Number(draft.credit_days))
        : null;

    // Claim the draft before creating financial records. The status predicate
    // makes approval idempotent when two approvers click at the same time.
    const { data: claimedDraft, error: claimError } = await supabase
      .from("sales_orders")
      .update({ status: "approved", updated_at: now })
      .eq("id", draftId)
      .eq("organization_id", actor.organizationId)
      .eq("status", "pending_approval")
      .select("id")
      .maybeSingle();
    if (claimError || !claimedDraft) {
      return { ok: false, error: claimError?.message ?? "Draft was already processed by another approver" };
    }

    let paymentId: string | null = null;
    let previousCustomerBalance: number | null = null;
    const restorePending = async () => {
      await supabase.from("sales_orders").update({ status: "pending_approval", updated_at: new Date().toISOString() })
        .eq("id", draftId).eq("organization_id", actor.organizationId).eq("status", "approved");
    };

    // Create sales_transaction (invoice)
    const { data: invoice, error: invoiceError } = await supabase
      .from("sales_transactions")
      .insert({
        organization_id: actor.organizationId,
        customer_id: draft.customer_id,
        invoice_number: invoiceNumber,
        sale_date: draft.order_date ?? now.split("T")[0],
        payment_type: paymentType,
        credit_due_date: creditDueDate,
        status: paymentType === "cash" ? "paid" : "confirmed",
        notes: `Converted from draft ${draft.so_number}. ${draft.notes ?? ""}`.trim(),
        total_amount: totalAmount,
        invoice_type: "sales",
        created_by_profile_id: draft.created_by_profile_id ?? actor.profileId,
        created_at: now,
      })
      .select("id, invoice_number, total_amount")
      .single();

    if (invoiceError) {
      await restorePending();
      return { ok: false, error: `Failed to create invoice: ${invoiceError.message}` };
    }

    // Insert sales_items (inventory auto-reduces via inventory_sync_sale_item trigger)
    const salesItems = items.map((item: any) => ({
      sales_transaction_id: invoice.id,
      product_id: item.product_id,
      quantity: Number(item.quantity_ordered),
      selling_price: Number(item.unit_price ?? 0),
      discount: Number(item.discount ?? 0),
      bonus: Number(item.bonus ?? 0),
      unit_mode: item.unit_mode ?? "main",
      organization_id: actor.organizationId,
      created_at: now,
    }));

    const { error: itemsError } = await supabase.from("sales_items").insert(salesItems);

    if (itemsError) {
      await supabase.from("sales_items").delete().eq("sales_transaction_id", invoice.id).eq("organization_id", actor.organizationId);
      await supabase.from("sales_transactions").delete().eq("id", invoice.id);
      await restorePending();
      return { ok: false, error: `Failed to create invoice items: ${itemsError.message}` };
    }

    if (paymentType === "cash") {
      const { data: payment, error: paymentError } = await supabase.from("customer_payments").insert({
        organization_id: actor.organizationId,
        customer_id: draft.customer_id,
        amount: totalAmount,
        payment_date: draft.order_date ?? now.split("T")[0],
        payment_method: "cash",
        notes: `Payment received against invoice ${invoiceNumber}`,
      }).select("id").single();
      paymentId = payment?.id ?? null;
      const { error: allocationError } = paymentId
        ? await supabase.from("customer_payment_allocations").insert({
            organization_id: actor.organizationId,
            customer_payment_id: paymentId,
            sales_transaction_id: invoice.id,
            amount: totalAmount,
          })
        : { error: paymentError ?? new Error("Payment id was not returned") };
      if (paymentError || allocationError) {
        if (paymentId) await supabase.from("customer_payments").delete().eq("id", paymentId).eq("organization_id", actor.organizationId);
        await supabase.from("sales_items").delete().eq("sales_transaction_id", invoice.id).eq("organization_id", actor.organizationId);
        await supabase.from("sales_transactions").delete().eq("id", invoice.id).eq("organization_id", actor.organizationId);
        await restorePending();
        return { ok: false, error: `Failed to record cash payment: ${paymentError?.message ?? allocationError?.message}` };
      }
    } else {
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("outstanding_balance")
        .eq("id", draft.customer_id)
        .eq("organization_id", actor.organizationId)
        .maybeSingle();
      if (customerError || !customer) {
        await supabase.from("sales_items").delete().eq("sales_transaction_id", invoice.id).eq("organization_id", actor.organizationId);
        await supabase.from("sales_transactions").delete().eq("id", invoice.id).eq("organization_id", actor.organizationId);
        await restorePending();
        return { ok: false, error: customerError?.message ?? "Customer not found" };
      }
      previousCustomerBalance = Number(customer.outstanding_balance ?? 0);
      const { error: balanceError } = await supabase.from("customers").update({
        outstanding_balance: previousCustomerBalance + totalAmount,
        last_sale_date: now,
        updated_at: now,
      }).eq("id", draft.customer_id).eq("organization_id", actor.organizationId);
      if (balanceError) {
        await supabase.from("sales_items").delete().eq("sales_transaction_id", invoice.id).eq("organization_id", actor.organizationId);
        await supabase.from("sales_transactions").delete().eq("id", invoice.id).eq("organization_id", actor.organizationId);
        await restorePending();
        return { ok: false, error: `Failed to update customer balance: ${balanceError.message}` };
      }
    }

    // Mark draft as converted
    const { error: updateDraftError } = await supabase
      .from("sales_orders")
      .update({
        status: "converted",
        notes: `${draft.notes ?? ""} [Converted to invoice ${invoiceNumber}]`.trim(),
        updated_at: now,
      })
      .eq("id", draftId)
      .eq("organization_id", actor.organizationId)
      .eq("status", "approved");

    if (updateDraftError) {
      if (previousCustomerBalance !== null) {
        await supabase.from("customers").update({ outstanding_balance: previousCustomerBalance, updated_at: new Date().toISOString() })
          .eq("id", draft.customer_id).eq("organization_id", actor.organizationId);
      }
      if (paymentId) {
        await supabase.from("customer_payment_allocations").delete().eq("customer_payment_id", paymentId).eq("organization_id", actor.organizationId);
        await supabase.from("customer_payments").delete().eq("id", paymentId).eq("organization_id", actor.organizationId);
      }
      await supabase.from("sales_items").delete().eq("sales_transaction_id", invoice.id).eq("organization_id", actor.organizationId);
      await supabase.from("sales_transactions").delete().eq("id", invoice.id).eq("organization_id", actor.organizationId);
      await restorePending();
      return { ok: false, error: `Failed to finalize draft: ${updateDraftError.message}` };
    }

    // Notify the salesman who created the draft
    await this.notifySalesmanOfApproval(
      actor,
      draft.created_by_profile_id,
      draft.so_number,
      invoiceNumber,
      totalAmount
    );

    await logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "draft_sale_approved",
      entityType: "sales_order",
      entityId: draftId,
      description: `Draft ${draft.so_number} approved → invoice ${invoiceNumber} (${totalAmount})`,
      success: true,
    });

    return { ok: true, invoice, invoiceNumber };
  }

  /**
   * Owner rejects a draft → returns to salesman with reason
   */
  async rejectDraft(actor: ActorContext, draftId: string, reason: string): Promise<DraftSaleResult> {
    if (!actor.organizationId) {
      return { ok: false, error: "Organization context required" };
    }
    if (!actor.isOwner && !actor.permissions?.includes("draft_approval")) {
      return { ok: false, error: "Only owner or approver can reject drafts" };
    }

    if (!reason || !reason.trim()) {
      return { ok: false, error: "Rejection reason is required" };
    }

    const supabase = createSupabaseService();

    const { data: draft } = await supabase
      .from("sales_orders")
      .select("id, so_number, status, created_by_profile_id, notes")
      .eq("id", draftId)
      .eq("organization_id", actor.organizationId)
      .maybeSingle();

    if (!draft) {
      return { ok: false, error: "Draft not found" };
    }

    if (draft.status !== "pending_approval") {
      return { ok: false, error: `Draft is not pending approval (current: ${draft.status})` };
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("sales_orders")
      .update({
        status: "rejected",
        notes: `${draft.notes ?? ""} [Rejected: ${reason}]`.trim(),
        updated_at: now,
      })
      .eq("id", draftId)
      .eq("organization_id", actor.organizationId)
      .eq("status", "pending_approval")
      .select()
      .maybeSingle();

    if (error || !updated) {
      return { ok: false, error: error ? `Failed to reject draft: ${error.message}` : "Draft was already processed by another approver" };
    }

    // Notify salesman
    await this.notifySalesmanOfRejection(actor, draft.created_by_profile_id, draft.so_number, reason);

    await logAuditEvent({
      organizationId: actor.organizationId,
      actorProfileId: actor.profileId,
      actorEmail: actor.email,
      action: "draft_sale_rejected",
      entityType: "sales_order",
      entityId: draftId,
      description: `Draft ${draft.so_number} rejected: ${reason}`,
      success: true,
    });

    return { ok: true, draft: updated };
  }

  /**
   * Get drafts created by the current salesman
   */
  async getMyDrafts(actor: ActorContext): Promise<DraftListResult> {
    if (!actor.organizationId || !actor.profileId) {
      return { ok: false, error: "Organization context required" };
    }

    const supabase = createSupabaseService();
    const { data, error } = await supabase
      .from("sales_orders")
      .select(`
        id, so_number, customer_id, order_date, expected_date, notes, status,
        created_by_profile_id, created_at, updated_at,
        customers!inner(customer_name, shop_name),
        sales_order_items(product_id, quantity_ordered, unit_price, discount)
      `)
      .eq("organization_id", actor.organizationId)
      .eq("created_by_profile_id", actor.profileId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return { ok: false, error: `Failed to load drafts: ${error.message}` };
    }

    const drafts = (data ?? []).map((draft: any) => {
      const items = draft.sales_order_items ?? [];
      const total = items.reduce(
        (sum: number, item: any) => sum + Number(item.quantity_ordered ?? 0) * Number(item.unit_price ?? 0) - Number(item.discount ?? 0),
        0
      );
      return { ...draft, total_amount: total };
    });

    return { ok: true, drafts, total: drafts.length };
  }

  private async notifyOwnerOfDraft(actor: ActorContext, draftId: string, customerName: string, totalAmount: number) {
    const supabase = this.draftDependencies.createSupabaseService();

    // Find owner profile
    const { data: owner } = await supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", actor.organizationId)
      .eq("role", "owner")
      .maybeSingle();

    if (!owner) return;

    const { error } = await supabase.from("notifications").insert({
      organization_id: actor.organizationId,
      recipient_profile_id: owner.id,
      category: "draft_sale",
      title: "New draft sale pending approval",
      body: `${customerName}: ${totalAmount} awaits your approval.`,
      entity_type: "sales_order",
      entity_id: draftId,
      channel: "in_app",
      is_read: false,
    });

    if (error) {
      console.error("Owner draft-sale notification failed:", error.message);
    }
  }

  private async notifySalesmanOfApproval(actor: ActorContext, salesmanProfileId: string | null, soNumber: string, invoiceNumber: string, totalAmount: number) {
    if (!salesmanProfileId) return;
    const supabase = createSupabaseService();

    await supabase.from("notifications").insert({
      organization_id: actor.organizationId,
      recipient_profile_id: salesmanProfileId,
      category: "approval",
      title: "Draft sale approved",
      body: `${soNumber} approved → invoice ${invoiceNumber} (${totalAmount}).`,
      entity_type: "sales_order",
      entity_id: invoiceNumber,
      channel: "in_app",
      is_read: false,
    });
  }

  private async notifySalesmanOfRejection(actor: ActorContext, salesmanProfileId: string | null, soNumber: string, reason: string) {
    if (!salesmanProfileId) return;
    const supabase = createSupabaseService();

    await supabase.from("notifications").insert({
      organization_id: actor.organizationId,
      recipient_profile_id: salesmanProfileId,
      category: "approval",
      title: "Draft sale rejected",
      body: `${soNumber} was rejected: ${reason}`,
      entity_type: "sales_order",
      entity_id: soNumber,
      channel: "in_app",
      is_read: false,
    });
  }
}

export function getDraftSaleService(): DraftSaleService {
  return new DraftSaleService();
}
