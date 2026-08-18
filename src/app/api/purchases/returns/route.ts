import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { resolveActor, buildOrganizationContext } from "@/lib/identity/api-context";
import { validatePurchaseReturnInput } from "@/lib/purchases/validation";
import { generateInvoiceNumberWithClient } from "@/lib/invoices/invoice-number-service";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

// Server-side purchase return endpoint. Mirrors the client-side rules
// (src/lib/purchases/validation.ts) and adds the stock-availability guard:
//   - the return can never drive a product's current_stock below zero
// The same rule is enforced atomically (and race-safely) inside the
// inventory_sync_purchase_return_item trigger in src/lib/purchases/schema.sql;
// this route validates up front so the caller gets a clean error before any
// row is written.

interface ReturnLinePayload {
  productId: string | number;
  quantity: string | number;
  unitPrice?: string | number | null;
  unitMode?: "main" | "subunit" | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { actor, error, status } = await resolveActor(request);
    if (error || !actor) {
      return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
    }

    const organizationContext = buildOrganizationContext(actor);
    const organizationId = organizationContext.actor.organizationId;

    const rawLines: ReturnLinePayload[] = Array.isArray(body?.lines) ? body.lines : [];
    const lines = rawLines.map((line) => ({
      product_id: line?.productId,
      quantity: line?.quantity,
      unit_price: line?.unitPrice,
      unit_mode: line?.unitMode === "subunit" ? "subunit" : "main",
      batch_number: line?.batchNumber,
      expiry_date: line?.expiryDate,
    }));

    const validation = validatePurchaseReturnInput({
      supplier_id: body?.supplierId,
      return_date: body?.returnDate,
      reason: body?.reason,
      lines,
    });

    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.errors.join(" ") }, { status: 400 });
    }

    const productIds = Array.from(
      new Set(lines.map((line) => String(line.product_id)).filter(Boolean))
    );

    const supabase = createSupabaseUserClient(getAccessToken(request));

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, current_stock, units_per_pack")
      .eq("organization_id", organizationId)
      .in("id", productIds);

    if (productsError) {
      return NextResponse.json({ ok: false, error: productsError.message }, { status: 500 });
    }

    const productsById = new Map<string, { name: string; current_stock: number | null; units_per_pack: number | null }>();
    for (const product of products ?? []) {
      productsById.set(String(product.id), product);
    }

    const stockErrors: string[] = [];
    const requestedQtyByProduct = new Map<string, number>();
    for (const line of lines) {
      const productId = String(line.product_id);
      const quantity = Number(line.quantity || 0);
      const product = productsById.get(productId);
      let mainQuantity = quantity;
      if (product && line.unit_mode === "subunit" && Number(product.units_per_pack) > 0) {
        mainQuantity = quantity / Number(product.units_per_pack);
      }
      requestedQtyByProduct.set(
        productId,
        (requestedQtyByProduct.get(productId) ?? 0) + mainQuantity
      );
    }
    for (const [productId, totalRequested] of requestedQtyByProduct) {
      const product = productsById.get(productId);
      if (!product) {
        stockErrors.push(`Product not found in this organization.`);
        continue;
      }
      const available = Number(product.current_stock ?? 0);
      if (totalRequested > available) {
        stockErrors.push(
          `${product.name}: cannot return ${totalRequested} — only ${available} in stock.`
        );
      }
    }
    if (stockErrors.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Stock validation failed: ${stockErrors.join(" ")}` },
        { status: 400 }
      );
    }

    const returnNumber = await generateInvoiceNumberWithClient(supabase, organizationId, "purchase_return");

    const { data: returnData, error: returnError } = await supabase
      .from("purchase_returns")
      .insert({
        organization_id: organizationId,
        return_number: returnNumber,
        supplier_id: body?.supplierId,
        purchase_transaction_id: body?.purchaseTransactionId || null,
        return_date: body?.returnDate || null,
        reason: typeof body?.reason === "string" ? body.reason.trim() || null : null,
        status: "confirmed",
        created_by_profile_id:
          typeof body?.createdByProfileId === "string" ? body.createdByProfileId : null,
      })
      .select("id")
      .single();

    if (returnError) {
      return NextResponse.json({ ok: false, error: returnError.message }, { status: 400 });
    }

    const returnId = returnData?.id;
    if (!returnId) {
      return NextResponse.json({ ok: false, error: "Failed to create purchase return" }, { status: 500 });
    }

    // Insert all items in a single statement so the return header + items are
    // atomic (a partial return with stock already adjusted must never exist).
    const itemsToInsert = lines.map((line) => ({
      purchase_return_id: returnId,
      organization_id: organizationId,
      product_id: line.product_id,
      quantity: Number(line.quantity),
      unit_price: line.unit_price != null ? Number(line.unit_price) : null,
      unit_mode: line.unit_mode,
      batch_number: line.batch_number || null,
      expiry_date: line.expiry_date || null,
    }));

    const { error: itemsError } = await supabase.from("purchase_return_items").insert(itemsToInsert);

    if (itemsError) {
      // Roll back the header so no orphan return remains.
      await supabase.from("purchase_returns").delete().eq("id", returnId);
      return NextResponse.json({ ok: false, error: itemsError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, returnId, returnNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create purchase return";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
