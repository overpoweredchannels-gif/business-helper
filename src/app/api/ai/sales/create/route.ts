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
      customer_id,
      product_id,
      quantity,
      selling_price,
      payment_type,
      invoice_date,
      credit_days,
      notes,
      // Optional — profile id of the salesman recording the sale. Not
      // required (this route has no session-auth check), but when supplied
      // it is stored as created_by_profile_id for the invoice metadata
      // foundation (Part 4) and Sales Ledger "salesman" filter (Part 3).
      created_by_profile_id,
    } = body;

    const errors: string[] = [];
    if (!customer_id) errors.push("customer_id is required");
    if (!product_id) errors.push("product_id is required");
    if (!quantity || Number(quantity) <= 0) errors.push("quantity must be a positive number");
    if (selling_price === undefined || Number(selling_price) < 0) errors.push("selling_price is required and must be >= 0");
    if (!payment_type || !["cash", "credit"].includes(String(payment_type).toLowerCase())) {
      errors.push("payment_type must be 'cash' or 'credit'");
    }
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, error: errors.join("; ") }, { status: 400 });
    }

    const supabase = createSupabaseService();
    const now = new Date().toISOString();

    // Server-side, per-organization, atomically generated invoice number
    // (SAL-000001, SAL-000002, ...). Never trust a client-supplied number.
    let invoiceNumber: string;
    try {
      invoiceNumber = await new InvoiceNumberService(supabase).generateSalesInvoice(organizationId);
    } catch (numberErr) {
      const message = numberErr instanceof Error ? numberErr.message : "Failed to generate invoice number";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    const saleDate = invoice_date || now;

    const productRes = await supabase
      .from("products")
      .select("id, name, current_stock, default_selling_price")
      .eq("id", product_id)
      .eq("organization_id", organizationId)
      .single();

    if (productRes.error || !productRes.data) {
      return NextResponse.json({ ok: false, error: "Product not found" }, { status: 404 });
    }

    const product = productRes.data;
    const { data: effectivePolicy, error: policyError } = await supabase.rpc(
      "resolve_overselling_policy",
      { p_organization_id: organizationId, p_product_id: product_id }
    );
    if (policyError) {
      return NextResponse.json(
        { ok: false, error: `Failed to resolve overselling policy: ${policyError.message}` },
        { status: 500 }
      );
    }
    const oversellingAllowed = String(effectivePolicy ?? "allow") !== "block";
    if (!oversellingAllowed && Number(product.current_stock ?? 0) < Number(quantity)) {
      return NextResponse.json(
        { ok: false, error: `Insufficient stock: ${product.current_stock} available, ${quantity} requested` },
        { status: 400 }
      );
    }

    const customerRes = await supabase
      .from("customers")
      .select("id, customer_name")
      .eq("id", customer_id)
      .eq("organization_id", organizationId)
      .single();

    if (customerRes.error || !customerRes.data) {
      return NextResponse.json({ ok: false, error: "Customer not found" }, { status: 404 });
    }

    const saleTransactionRes = await supabase
      .from("sales_transactions")
      .insert({
        organization_id: organizationId,
        customer_id: customer_id,
        invoice_number: invoiceNumber,
        sale_date: saleDate,
        payment_type: String(payment_type).toLowerCase(),
        credit_due_date: payment_type === "credit" && credit_days
          ? new Date(Date.now() + Number(credit_days) * 86400000).toISOString()
          : null,
        notes: notes || null,
        total_amount: Number(quantity) * Number(selling_price),
        created_at: now,
        status: "confirmed",
        invoice_type: "sales",
        created_by_profile_id: created_by_profile_id || null,
      })
      .select("id")
      .single();

    if (saleTransactionRes.error) {
      return NextResponse.json(
        { ok: false, error: `Failed to create sale transaction: ${saleTransactionRes.error.message}` },
        { status: 500 }
      );
    }

    const saleTxId = saleTransactionRes.data.id;

    const saleItemRes = await supabase
      .from("sales_items")
      .insert({
        sales_transaction_id: saleTxId,
        product_id: product_id,
        quantity: Number(quantity),
        selling_price: Number(selling_price),
        created_at: now,
      })
      .select("id")
      .single();

    if (saleItemRes.error) {
      await supabase.from("sales_transactions").delete().eq("id", saleTxId);
      return NextResponse.json(
        { ok: false, error: `Failed to create sale item: ${saleItemRes.error.message}` },
        { status: 500 }
      );
    }

    const totalAmount = Number(quantity) * Number(selling_price);

    // Best-effort customer balance update — column may not exist
    const customerUpdateRes = await supabase
      .from("customers")
      .update({
        updated_at: now,
      })
      .eq("id", customer_id);

    if (!customerUpdateRes.error) {
      try {
        const { data: existingBalance } = await supabase
          .from("customers")
          .select("outstanding_balance")
          .eq("id", customer_id)
          .maybeSingle();

        const currentBalance = Number((existingBalance as Record<string, unknown> | null)?.outstanding_balance ?? 0);
        const newBalance = payment_type === "credit" ? currentBalance + totalAmount : currentBalance;

        await supabase
          .from("customers")
          .update({
            outstanding_balance: newBalance,
            last_sale_date: now,
            updated_at: now,
          })
          .eq("id", customer_id);
      } catch {
        // Non-critical update — sale is already recorded
      }
    }

    return NextResponse.json({
      ok: true,
      saleId: saleTxId,
      invoiceNumber,
      customerName: customerRes.data.customer_name,
      productName: product.name,
      quantity: Number(quantity),
      total: totalAmount,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
