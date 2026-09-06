import type { SupabaseClient } from "@supabase/supabase-js";

/** The existing database RPC commits the warehouse balance and ledger together. */
export async function saveImportedInitialStock(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
  quantity: number,
  actorProfileId: string | null,
): Promise<void> {
  if (quantity === 0) return;
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Invalid opening stock quantity.");
  if (!actorProfileId) throw new Error("Your session is missing a profile. Sign in again before importing stock.");
  const { data, error } = await supabase.rpc("adjust_inventory", {
    p_organization_id: organizationId,
    p_product_id: productId,
    p_quantity_delta: quantity,
    p_reason: "Initial stock imported from product import file",
    p_batch_number: null,
    p_expiry_date: null,
    p_created_by: actorProfileId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Stock adjustment returned no inventory record. Check the inventory ledger before retrying.");
}
