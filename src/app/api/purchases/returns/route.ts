import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { buildOrganizationContext } from "@/lib/identity/api-context";
import { requirePermission } from "@/lib/identity/authorization";
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
    const permission = await requirePermission(request, "purchases_create");
    if (!permission.allowed || !permission.actor) {
      return NextResponse.json(
        { ok: false, error: permission.reason ?? "Forbidden" },
        { status: 403 },
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
    const supplierId = String(body?.supplierId ?? "");
    const purchaseTransactionId = body?.purchaseTransactionId || null;
    const { data: supplier } = await supabase.from("suppliers").select("id").eq("id", supplierId).eq("organization_id", organizationId).maybeSingle();
    if (!supplier) return NextResponse.json({ ok: false, error: "Supplier not found in this organization" }, { status: 400 });

    if (purchaseTransactionId) {
      const { data: purchase } = await supabase.from("purchase_transactions").select("id, supplier_id").eq("id", purchaseTransactionId).eq("organization_id", organizationId).maybeSingle();
      if (!purchase || String(purchase.supplier_id) !== supplierId) {
        return NextResponse.json({ ok: false, error: "The selected purchase does not belong to this supplier" }, { status: 400 });
      }
    }

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

    if (purchaseTransactionId) {
      const [{ data: purchasedItems, error: purchasedError }, { data: returnedItems, error: returnedError }] = await Promise.all([
        supabase.from("purchase_items").select("product_id, quantity, unit_mode").eq("purchase_transaction_id", purchaseTransactionId),
        supabase.from("purchase_return_items").select("product_id, quantity, unit_mode, purchase_returns!inner(purchase_transaction_id, status)")
          .eq("purchase_returns.purchase_transaction_id", purchaseTransactionId).neq("purchase_returns.status", "cancelled"),
      ]);
      if (purchasedError || returnedError) return NextResponse.json({ ok: false, error: purchasedError?.message ?? returnedError?.message }, { status: 500 });
      const toMain = (productId: unknown, quantity: unknown, mode: unknown) => {
        const product = productsById.get(String(productId));
        const pack = Number(product?.units_per_pack ?? 0);
        return mode === "subunit" && pack > 0 ? Number(quantity ?? 0) / pack : Number(quantity ?? 0);
      };
      const purchasedByProduct = new Map<string, number>();
      const returnedByProduct = new Map<string, number>();
      for (const item of purchasedItems ?? []) purchasedByProduct.set(String(item.product_id), (purchasedByProduct.get(String(item.product_id)) ?? 0) + toMain(item.product_id, item.quantity, item.unit_mode));
      for (const item of returnedItems ?? []) returnedByProduct.set(String(item.product_id), (returnedByProduct.get(String(item.product_id)) ?? 0) + toMain(item.product_id, item.quantity, item.unit_mode));
      const quantityErrors: string[] = [];
      for (const [productId, requested] of requestedQtyByProduct) {
        const returnable = (purchasedByProduct.get(productId) ?? 0) - (returnedByProduct.get(productId) ?? 0);
        if (returnable <= 0) quantityErrors.push(`Product ${productId} has no returnable quantity on this purchase.`);
        else if (requested > returnable) quantityErrors.push(`Product ${productId}: cannot return ${requested} — only ${returnable} remains returnable.`);
      }
      if (quantityErrors.length) return NextResponse.json({ ok: false, error: quantityErrors.join(" ") }, { status: 400 });
    }

    const returnNumber = await generateInvoiceNumberWithClient(supabase, organizationId, "purchase_return");

    const { data: returnData, error: returnError } = await supabase
      .from("purchase_returns")
      .insert({
        organization_id: organizationId,
        return_number: returnNumber,
        supplier_id: supplierId,
        purchase_transaction_id: purchaseTransactionId,
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
