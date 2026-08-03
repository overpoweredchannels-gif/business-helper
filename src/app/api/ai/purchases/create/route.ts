import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import { resolveActor, buildOrganizationContext } from "@/lib/identity/api-context";
import { InvoiceNumberService } from "@/lib/invoices/invoice-number-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { actor, error, status } = await resolveActor(req);
    if (error || !actor) {
      return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
    }

    const organizationContext = buildOrganizationContext(actor);
    const organizationId = organizationContext.actor.organizationId;

    const {
      supplier_id,
      product_id,
      quantity,
      purchase_price,
      payment_type,
      // NOTE: this is the SUPPLIER's own paper invoice reference number
      // (collected optionally in the purchase conversation flow), not our
      // system invoice number. It is stored separately as
      // supplier_invoice_number and must never become invoice_number — our
      // own invoice_number is always server-generated (Part 1).
      invoice_number: supplierInvoiceNumber,
      invoice_date,
      credit_days,
      notes,
      // Optional — profile id of the purchase officer recording the
      // purchase. Stored as created_by_profile_id for the invoice metadata
      // foundation (Part 4).
      created_by_profile_id,
    } = body;

    const errors: string[] = [];
    if (!supplier_id) errors.push("supplier_id is required");
    if (!product_id) errors.push("product_id is required");
    if (!quantity || Number(quantity) <= 0) errors.push("quantity must be a positive number");
    if (purchase_price === undefined || Number(purchase_price) < 0) errors.push("purchase_price is required and must be >= 0");
    if (!payment_type || !["cash", "credit"].includes(String(payment_type).toLowerCase())) {
      errors.push("payment_type must be 'cash' or 'credit'");
    }
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 400 });
    }

    const supabase = createSupabaseService();
    const now = new Date().toISOString();

    // Server-side, per-organization, atomically generated invoice number
    // (PUR-000001, PUR-000002, ...). Never trust a client-supplied number —
    // the client may only supply the supplier's own reference number, kept
    // separately in supplier_invoice_number.
    let invNumber: string;
    try {
      invNumber = await new InvoiceNumberService(supabase).generatePurchaseInvoice(organizationId);
    } catch (numberErr) {
      const message = numberErr instanceof Error ? numberErr.message : "Failed to generate invoice number";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    const purDate = invoice_date || now;

    const productRes = await supabase
      .from("products")
      .select("id, name, current_stock, default_purchase_price")
      .eq("id", product_id)
      .eq("organization_id", organizationId)
      .single();

    if (productRes.error || !productRes.data) {
      return NextResponse.json({ ok: false, error: "Product not found" }, { status: 404 });
    }

    const product = productRes.data;

    const supplierRes = await supabase
      .from("suppliers")
      .select("id, supplier_name")
      .eq("id", supplier_id)
      .eq("organization_id", organizationId)
      .single();

    if (supplierRes.error || !supplierRes.data) {
      return NextResponse.json({ ok: false, error: "Supplier not found" }, { status: 404 });
    }

    const purchaseTransactionRes = await supabase
      .from("purchase_transactions")
      .insert({
        organization_id: organizationId,
        supplier_id: supplier_id,
        invoice_number: invNumber,
        purchase_date: purDate,
        payment_type: String(payment_type).toLowerCase(),
        credit_due_date: payment_type === "credit" && credit_days
          ? new Date(Date.now() + Number(credit_days) * 86400000).toISOString()
          : null,
        notes: notes || null,
        total_amount: Number(quantity) * Number(purchase_price),
        created_at: now,
        status: "confirmed",
        invoice_type: "purchase",
        created_by_profile_id: created_by_profile_id || null,
        supplier_invoice_number: supplierInvoiceNumber || null,
      })
      .select("id")
      .single();

    if (purchaseTransactionRes.error) {
      return NextResponse.json(
        { ok: false, error: `Failed to create purchase transaction: ${purchaseTransactionRes.error.message}` },
        { status: 500 }
      );
    }

    const purchaseTxId = purchaseTransactionRes.data.id;

    const purchaseItemRes = await supabase
      .from("purchase_items")
      .insert({
        purchase_transaction_id: purchaseTxId,
        product_id: product_id,
        quantity: Number(quantity),
        purchase_price: Number(purchase_price),
        created_at: now,
      })
      .select("id")
      .single();

    if (purchaseItemRes.error) {
      await supabase.from("purchase_transactions").delete().eq("id", purchaseTxId);
      return NextResponse.json(
        { ok: false, error: `Failed to create purchase item: ${purchaseItemRes.error.message}` },
        { status: 500 }
      );
    }

    const totalAmount = Number(quantity) * Number(purchase_price);

    const supplierUpdateRes = await supabase
      .from("suppliers")
      .update({
        updated_at: now,
      })
      .eq("id", supplier_id);

    if (!supplierUpdateRes.error) {
      try {
        const { data: existingBalance } = await supabase
          .from("suppliers")
          .select("outstanding_balance")
          .eq("id", supplier_id)
          .maybeSingle();

        const currentBalance = Number((existingBalance as Record<string, unknown> | null)?.outstanding_balance ?? 0);
        const newBalance = payment_type === "credit" ? currentBalance + totalAmount : currentBalance;

        await supabase
          .from("suppliers")
          .update({
            outstanding_balance: newBalance,
            last_purchase_date: now,
            updated_at: now,
          })
          .eq("id", supplier_id);
      } catch {
        // Non-critical update — purchase is already recorded
      }
    }

    return NextResponse.json({
      ok: true,
      purchaseId: purchaseTxId,
      invoiceNumber: invNumber,
      supplierName: supplierRes.data.supplier_name,
      productName: product.name,
      quantity: Number(quantity),
      total: totalAmount,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
