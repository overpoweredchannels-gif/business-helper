import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { buildOrganizationContext } from "@/lib/identity/api-context";
import { requirePermission } from "@/lib/identity/authorization";
import { validateSalesReturnInput } from "@/lib/sales/validation";
import { generateInvoiceNumberWithClient } from "@/lib/invoices/invoice-number-service";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

// Server-side sales return endpoint. Mirrors the client-side rules
// (src/lib/sales/validation.ts) and adds the quantity guard: a line can never
// return more than the quantity sold on the referenced invoice minus what has
// already been returned (partial-return support). Stock restoration is handled
// atomically by the inventory_sync_sale_return_item trigger in the Phase 4
// migration / src/lib/sales/schema.sql (movement_type 'return_in').

interface ReturnLinePayload {
  productId: string | number;
  quantity: string | number;
  unitPrice?: string | number | null;
  discount?: string | number | null;
  unitMode?: "main" | "subunit" | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const permission = await requirePermission(request, "sales_create");
    if (!permission.allowed || !permission.actor) {
      return NextResponse.json(
        { ok: false, error: permission.reason ?? "Forbidden" },
        { status: 403 }
      );
    }

    const actor = permission.actor;
    const organizationContext = buildOrganizationContext(actor);
    const organizationId = organizationContext.actor.organizationId;

    const rawLines: ReturnLinePayload[] = Array.isArray(body?.lines) ? body.lines : [];
    const lines = rawLines.map((line) => ({
      product_id: line?.productId,
      quantity: line?.quantity,
      unit_price: line?.unitPrice,
      discount: line?.discount,
      unit_mode: line?.unitMode === "subunit" ? "subunit" : "main",
      batch_number: line?.batchNumber,
      expiry_date: line?.expiryDate,
    }));

    const validation = validateSalesReturnInput({
      customer_id: body?.customerId,
      return_date: body?.returnDate,
      reason: body?.reason,
      lines,
    });

    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.errors.join(" ") }, { status: 400 });
    }

    const supabase = createSupabaseUserClient(getAccessToken(request));
    const salesTransactionId = body?.salesTransactionId || null;

    // Guard: returned quantity per product may never exceed what was sold on
    // the referenced invoice, minus anything already returned.
    if (salesTransactionId) {
      const { data: soldItems, error: soldError } = await supabase
        .from("sales_items")
        .select("product_id, quantity")
        .eq("sales_transaction_id", salesTransactionId);

      if (soldError) {
        return NextResponse.json({ ok: false, error: soldError.message }, { status: 500 });
      }

      const { data: returnedItems, error: returnedError } = await supabase
        .from("sales_return_items")
        .select("product_id, quantity, sales_returns!inner(sales_transaction_id)")
        .eq("sales_returns.sales_transaction_id", salesTransactionId)
        .neq("sales_returns.status", "cancelled");

      if (returnedError) {
        return NextResponse.json({ ok: false, error: returnedError.message }, { status: 500 });
      }

      const soldByProduct = new Map<string, number>();
      for (const item of soldItems ?? []) {
        const key = String(item.product_id);
        soldByProduct.set(key, (soldByProduct.get(key) ?? 0) + Number(item.quantity || 0));
      }

      const returnedByProduct = new Map<string, number>();
      for (const item of returnedItems ?? []) {
        const key = String(item.product_id);
        returnedByProduct.set(key, (returnedByProduct.get(key) ?? 0) + Number(item.quantity || 0));
      }

      const quantityErrors: string[] = [];
      const requestedQtyByProduct = new Map<string, number>();
      for (const line of lines) {
        const productId = String(line.product_id);
        requestedQtyByProduct.set(
          productId,
          (requestedQtyByProduct.get(productId) ?? 0) + Number(line.quantity || 0)
        );
      }
      for (const [productId, requested] of requestedQtyByProduct) {
        const sold = soldByProduct.get(productId) ?? 0;
        const alreadyReturned = returnedByProduct.get(productId) ?? 0;
        const returnable = sold - alreadyReturned;
        if (returnable <= 0) {
          quantityErrors.push(`Product ${productId} has no returnable quantity on this invoice.`);
        } else if (requested > returnable) {
          quantityErrors.push(
            `Product ${productId}: cannot return ${requested} — only ${returnable} units remain returnable on this invoice.`
          );
        }
      }
      if (quantityErrors.length > 0) {
        return NextResponse.json({ ok: false, error: quantityErrors.join(" ") }, { status: 400 });
      }
    }

    const returnNumber = await generateInvoiceNumberWithClient(supabase, organizationId, "sales_return");

    const { data: returnData, error: returnError } = await supabase
      .from("sales_returns")
      .insert({
        organization_id: organizationId,
        return_number: returnNumber,
        customer_id: body?.customerId,
        sales_transaction_id: salesTransactionId,
        return_date: body?.returnDate || null,
        reason: typeof body?.reason === "string" ? body.reason.trim() || null : null,
        status: "confirmed",
        created_by_profile_id: actor.profileId,
      })
      .select("id")
      .single();

    if (returnError) {
      return NextResponse.json({ ok: false, error: returnError.message }, { status: 400 });
    }

    const returnId = returnData?.id;
    if (!returnId) {
      return NextResponse.json({ ok: false, error: "Failed to create sales return" }, { status: 500 });
    }

    const itemsToInsert = lines.map((line) => ({
        sales_return_id: returnId,
        organization_id: organizationId,
        product_id: line.product_id,
        quantity: Number(line.quantity),
        unit_price: line.unit_price != null ? Number(line.unit_price) : null,
        discount: line.discount != null ? Number(line.discount) : 0,
        unit_mode: line.unit_mode,
        batch_number: line.batch_number || null,
        expiry_date: line.expiry_date || null,
    }));

    const { error: itemsError } = await supabase.from("sales_return_items").insert(itemsToInsert);
    if (itemsError) {
      await supabase.from("sales_returns").delete().eq("id", returnId);
      return NextResponse.json({ ok: false, error: itemsError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, returnId, returnNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create sales return";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
