import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { buildOrganizationContext } from "@/lib/identity/api-context";
import { requireSalesTool } from "@/lib/sales/authorization";
import { canViewAllSales } from "@/lib/sales/access";
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

    const permission = await requireSalesTool(request, "returns");
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
    const customerId = String(body?.customerId ?? "");
    const requestKey =
      typeof body?.requestKey === "string" && body.requestKey.length > 0 ? body.requestKey : null;
    // A PostgREST error for a column that does not exist yet
    // (Postgres 42703): the `request_key` column lands with the S7
    // SQL (`src/lib/migrations/returns_expenses_idempotency.sql`,
    // UMAIR runs it disposable-first). Until then, dedup is
    // degraded and the insert below retries without the key.
    const isUndefinedColumnError = (error: unknown): boolean =>
      (error as { code?: unknown } | null)?.code === "42703" ||
      /column .*request_key.* does not exist/i.test(
        (error as { message?: unknown } | null)?.message != null
          ? String((error as { message: unknown }).message)
          : "",
      );

    // Slice S7 — the fingerprint is an md5 of the canonical return
    // body (the normalized lines + party + linked invoice + date +
    // reason). The replay check below compares it, so the same key
    // with different contents is a 400 instead of a silent replay.
    const fingerprint = createHash("md5")
      .update(
        JSON.stringify({
          customerId,
          salesTransactionId,
          returnDate: body?.returnDate || null,
          reason: typeof body?.reason === "string" ? body.reason.trim() || null : null,
          lines,
        }),
      )
      .digest("hex");

    // Slice S7 — idempotency (same discipline as the sale queue):
    // the client request key is the row's `request_key`. A replay of
    // the same key returns the original return instead of a second
    // return (or a second stock restoration). The check runs BEFORE
    // the quantity guard below — a replay must not re-run a guard,
    // since the quantity is already returned.
    if (requestKey) {
      const { data: existing, error: existingError } = await supabase
        .from("sales_returns")
        .select("id, return_number, request_fingerprint")
        .eq("organization_id", organizationId)
        .eq("request_key", requestKey)
        .maybeSingle();
      if (!existingError && existing) {
        if (existing.request_fingerprint && existing.request_fingerprint !== fingerprint) {
          return NextResponse.json(
            { ok: false, error: "Request key was already used for a different return" },
            { status: 400 },
          );
        }
        return NextResponse.json({
          ok: true,
          returnId: existing.id,
          returnNumber: existing.return_number,
          replayed: true,
        });
      }
      if (existingError && !isUndefinedColumnError(existingError)) {
        return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
      }
      // An undefined-column error means the S7 SQL has not run yet
      // — fall through to the plain insert (no key stored, no dedup
      // until the SQL runs).
    }

    const { data: customer } = await supabase.from("customers").select("id").eq("id", customerId).eq("organization_id", organizationId).maybeSingle();
    if (!customer) return NextResponse.json({ ok: false, error: "Customer not found in this organization" }, { status: 400 });

    const productIds = [...new Set(lines.map((line) => String(line.product_id)))];
    const { data: products, error: productsError } = await supabase.from("products").select("id, units_per_pack").eq("organization_id", organizationId).in("id", productIds);
    if (productsError) return NextResponse.json({ ok: false, error: productsError.message }, { status: 500 });
    if ((products ?? []).length !== productIds.length) return NextResponse.json({ ok: false, error: "One or more products do not belong to this organization" }, { status: 400 });
    const unitsPerPack = new Map((products ?? []).map((product) => [String(product.id), Number(product.units_per_pack ?? 0)]));
    const toMainUnits = (productId: unknown, quantity: unknown, unitMode: unknown) => {
      const pack = unitsPerPack.get(String(productId)) ?? 0;
      return unitMode === "subunit" && pack > 0 ? Number(quantity ?? 0) / pack : Number(quantity ?? 0);
    };

    // Guard: returned quantity per product may never exceed what was sold on
    // the referenced invoice, minus anything already returned.
    if (salesTransactionId) {
      const { data: transaction } = await supabase.from("sales_transactions").select("id, customer_id").eq("id", salesTransactionId).eq("organization_id", organizationId).maybeSingle();
      if (!transaction || String(transaction.customer_id) !== customerId) {
        return NextResponse.json({ ok: false, error: "The selected invoice does not belong to this customer" }, { status: 400 });
      }
      const { data: soldItems, error: soldError } = await supabase
        .from("sales_items")
        .select("product_id, quantity, unit_mode")
        .eq("sales_transaction_id", salesTransactionId);

      if (soldError) {
        return NextResponse.json({ ok: false, error: soldError.message }, { status: 500 });
      }

      const { data: returnedItems, error: returnedError } = await supabase
        .from("sales_return_items")
        .select("product_id, quantity, unit_mode, sales_returns!inner(sales_transaction_id)")
        .eq("sales_returns.sales_transaction_id", salesTransactionId)
        .neq("sales_returns.status", "cancelled");

      if (returnedError) {
        return NextResponse.json({ ok: false, error: returnedError.message }, { status: 500 });
      }

      const soldByProduct = new Map<string, number>();
      for (const item of soldItems ?? []) {
        const key = String(item.product_id);
        soldByProduct.set(key, (soldByProduct.get(key) ?? 0) + toMainUnits(item.product_id, item.quantity, item.unit_mode));
      }

      const returnedByProduct = new Map<string, number>();
      for (const item of returnedItems ?? []) {
        const key = String(item.product_id);
        returnedByProduct.set(key, (returnedByProduct.get(key) ?? 0) + toMainUnits(item.product_id, item.quantity, item.unit_mode));
      }

      const quantityErrors: string[] = [];
      const requestedQtyByProduct = new Map<string, number>();
      for (const line of lines) {
        const productId = String(line.product_id);
        requestedQtyByProduct.set(
          productId,
          (requestedQtyByProduct.get(productId) ?? 0) + toMainUnits(line.product_id, line.quantity, line.unit_mode)
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

    const returnInsert = {
      organization_id: organizationId,
      return_number: returnNumber,
      customer_id: customerId,
      sales_transaction_id: salesTransactionId,
      return_date: body?.returnDate || null,
      reason: typeof body?.reason === "string" ? body.reason.trim() || null : null,
      status: "confirmed",
      created_by_profile_id: actor.profileId,
      // Slice S7 — the client request key (see the replay check
      // above). Omitted while the S7 SQL has not run yet.
      ...(requestKey ? { request_key: requestKey, request_fingerprint: fingerprint } : {}),
    };
    let { data: returnData, error: returnError } = await supabase
      .from("sales_returns")
      .insert(returnInsert)
      .select("id")
      .single();

    if (returnError && requestKey && isUndefinedColumnError(returnError)) {
      // Transitional fallback: the `request_key` column does not
      // exist yet — retry the insert without the key (and without
      // the fingerprint, which lands in the same SQL) so the return
      // still saves (dedup is degraded until the SQL runs).
      const { request_key: _requestKey, request_fingerprint: _requestFingerprint, ...insertWithoutKey } = returnInsert;
      void _requestKey;
      void _requestFingerprint;
      ({ data: returnData, error: returnError } = await supabase
        .from("sales_returns")
        .insert(insertWithoutKey)
        .select("id")
        .single());
    }

    if (returnError && requestKey && (returnError as { code?: unknown }).code === "23505") {
      // A concurrent replay already inserted this key: return the
      // original return instead of a second one.
      const { data: existing } = await supabase
        .from("sales_returns")
        .select("id, return_number")
        .eq("organization_id", organizationId)
        .eq("request_key", requestKey)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          ok: true,
          returnId: existing.id,
          returnNumber: existing.return_number,
          replayed: true,
        });
      }
    }

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
