import { NextRequest, NextResponse } from "next/server";
import { createSupabaseService } from "@/lib/supabase/server";
import {
  validateAdjustmentInput,
  normalizeOptionalText,
  normalizeExpiryDate,
} from "@/lib/inventory/validation";

export const runtime = "nodejs";

// Server-side stock adjustment endpoint. Mirrors the client-side rules
// (src/lib/inventory/validation.ts) and the database guards inside
// adjust_inventory() (src/lib/inventory/schema.sql):
//   - product must belong to the organization
//   - reason is required
//   - the caller must hold the can_manage_inventory permission (or be the
//     organization owner/admin) — enforced inside the RPC
//   - the adjustment can never drive stock negative
// The ledger row and products.current_stock are updated atomically in the
// database.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const organizationId = body?.organizationId;

    if (!organizationId || typeof organizationId !== "string") {
      return NextResponse.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }

    const validation = validateAdjustmentInput({
      product_id: body?.productId,
      quantity_delta: body?.quantityDelta,
      reason: body?.reason,
      batch_number: body?.batchNumber,
      expiry_date: body?.expiryDate,
    });

    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.errors.join(". ") }, { status: 400 });
    }

    const supabase = createSupabaseService();

    const { data, error } = await supabase.rpc("adjust_inventory", {
      p_organization_id: organizationId,
      p_product_id: Number(body?.productId),
      p_quantity_delta: Number(body?.quantityDelta),
      p_reason: normalizeOptionalText(body?.reason) ?? "",
      p_batch_number: normalizeOptionalText(body?.batchNumber),
      p_expiry_date: normalizeExpiryDate(body?.expiryDate),
      p_created_by:
        typeof body?.createdByProfileId === "string" ? body.createdByProfileId : null,
    });

    if (error) {
      // The RPC raises exceptions for permission/product/negative-stock
      // failures — surface the message as a client error.
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, transactionId: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stock adjustment failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
