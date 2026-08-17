import { NextRequest, NextResponse } from "next/server";
import { createSupabaseUserClient } from "@/lib/supabase/server";
import { resolveActor, buildOrganizationContext } from "@/lib/identity/api-context";
import {
  validateProductInput,
  normalizeOptionalText,
} from "@/lib/products/validation";

export const runtime = "nodejs";

const getAccessToken = (request: NextRequest): string => {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
};

// Server-side validation for the product form. Mirrors the client-side rules
// (src/lib/products/validation.ts) and the database constraints
// (src/lib/products/schema.sql). Run before insert/update to catch
// duplicates the client cannot see and rules the client may have bypassed.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const excludeProductId = body?.excludeProductId ?? null;

    const { actor, error, status } = await resolveActor(request);
    if (error || !actor) {
      return NextResponse.json({ ok: false, error }, { status: status ?? 401 });
    }

    const organizationContext = buildOrganizationContext(actor);
    const organizationId = organizationContext.actor.organizationId;

    const input = {
      name: body?.name,
      sku: body?.sku,
      barcode: body?.barcode,
      unitType: body?.unitType ?? "",
      subunitType: body?.subunitType ?? null,
      unitsPerPack: body?.unitsPerPack,
      minimumStockLevel: body?.minimumStockLevel,
      reorderLevel: body?.reorderLevel,
      lastPurchasePrice: body?.lastPurchasePrice,
      defaultPurchasePrice: body?.defaultPurchasePrice,
      defaultSellingPrice: body?.defaultSellingPrice,
    };

    const validation = validateProductInput(input);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.errors.join(". ") }, { status: 400 });
    }

    const name = normalizeOptionalText(body?.name) ?? "";
    const sku = normalizeOptionalText(body?.sku);
    const barcode = normalizeOptionalText(body?.barcode);
    const brandId = typeof body?.brandId === "string" && body.brandId ? body.brandId : null;

    const supabase = createSupabaseUserClient(getAccessToken(request));

    // Duplicate name within (organization, brand) — mirrors
    // products_org_brand_name_uidx / products_org_nullbrand_name_uidx.
    // The exclusion filter is only applied when editing an existing product
    // (excludeProductId is null for new records — never send a placeholder
    // id, as "-1" is not a valid uuid and PostgREST would reject the query).
    let nameQuery = supabase
      .from("products")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("name", name);
    if (excludeProductId) {
      nameQuery = nameQuery.neq("id", excludeProductId);
    }

    const scopedNameQuery = brandId
      ? nameQuery.eq("brand_id", brandId)
      : nameQuery.is("brand_id", null);

    const { data: nameMatches, error: nameError } = await scopedNameQuery.maybeSingle();

    if (nameError) {
      return NextResponse.json(
        { ok: false, error: `Duplicate name check failed: ${nameError.message}` },
        { status: 500 }
      );
    }
    if (nameMatches) {
      return NextResponse.json(
        { ok: false, error: `A product named "${name}" with this brand already exists.` },
        { status: 409 }
      );
    }

    // Duplicate SKU / barcode within the organization — mirrors
    // products_org_sku_uidx / products_org_barcode_uidx.
    if (sku) {
      let skuQuery = supabase
        .from("products")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("sku", sku);
      if (excludeProductId) {
        skuQuery = skuQuery.neq("id", excludeProductId);
      }
      const { data: skuMatches, error: skuError } = await skuQuery.maybeSingle();

      if (skuError) {
        return NextResponse.json(
          { ok: false, error: `Duplicate SKU check failed: ${skuError.message}` },
          { status: 500 }
        );
      }
      if (skuMatches) {
        return NextResponse.json(
          { ok: false, error: `SKU "${sku}" is already used by another product.` },
          { status: 409 }
        );
      }
    }

    if (barcode) {
      let barcodeQuery = supabase
        .from("products")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("barcode", barcode);
      if (excludeProductId) {
        barcodeQuery = barcodeQuery.neq("id", excludeProductId);
      }
      const { data: barcodeMatches, error: barcodeError } = await barcodeQuery.maybeSingle();

      if (barcodeError) {
        return NextResponse.json(
          { ok: false, error: `Duplicate barcode check failed: ${barcodeError.message}` },
          { status: 500 }
        );
      }
      if (barcodeMatches) {
        return NextResponse.json(
          { ok: false, error: `Barcode "${barcode}" is already used by another product.` },
          { status: 409 }
        );
      }
    }

    return NextResponse.json({ ok: true, normalized: { name, sku, barcode } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Product validation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
