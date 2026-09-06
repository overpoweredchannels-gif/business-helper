import assert from "node:assert/strict";
import { PurchaseService } from "../src/lib/purchases/services/purchase-service";
import { validatePurchaseTransactionInput } from "../src/lib/purchases/validation";
import type { ActorContext } from "../src/lib/identity/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const actor: ActorContext = { profileId: "actor", organizationId: "org", role: "owner", isOwner: true, isActive: true, permissions: [], email: "owner@example.test" };
const valid = { supplier_id: "supplier", purchase_date: "2026-09-06", payment_type: "credit", credit_days: 30,
  lines: [{ product_id: "product", quantity: 2, purchase_price: 150, selling_price: 175, unit_mode: "subunit" }] };
function mock(rpcError: {message: string; code?: string} | null = null) {
  const calls: Array<{name: string; args: Record<string, unknown>}> = [];
  const queries: Array<{table: string; column: string; value: unknown}> = [];
  const client = {
    from(table: string) {
      const chain = { select() { return chain; }, eq(column: string,value: unknown) { queries.push({table,column,value}); return chain; },
        maybeSingle: async () => ({ data: {id: table === "products" ? "product" : "supplier"}, error: null }) };
      return chain;
    },
    async rpc(name: string,args: Record<string,unknown>) {
      calls.push({name,args}); return {data: {transaction:{id:"tx",invoice_number:"P-50001"},items:[]},error:rpcError};
    },
  };
  return {service: PurchaseService.withSupabase(client as unknown as SupabaseClient), calls, queries};
}
async function main() {
  assert.equal(validatePurchaseTransactionInput(valid).ok,true);
  for (const invalid of [{lines:[]},{lines:[null]}, {credit_days:-1},{credit_days:1.5},{credit_days:"bad"},{credit_days:1e100},
    {lines:[{...valid.lines[0],unit_mode:"bad"}]},{lines:[{...valid.lines[0],quantity:1e308,purchase_price:1e308}]}]) {
    const m=mock(); await assert.rejects(m.service.createPurchase(actor,{...valid,...invalid})); assert.equal(m.calls.length,0);
  }
  const m=mock();
  const result=await m.service.createPurchase(actor,{...valid,created_by_profile_id:"spoof",invoice_number:"spoof",request_key:"retry"});
  assert.equal(result.transaction.id,"tx"); assert.equal(m.calls.length,1); assert.equal(m.calls[0].name,"create_purchase_atomic");
  assert.equal(m.calls[0].args.p_actor_profile_id,actor.profileId);assert.equal(m.calls[0].args.p_organization_id,actor.organizationId);
  const input=m.calls[0].args.p_input as Record<string,unknown>;
  assert.equal(input.invoice_number,undefined);assert.equal(input.created_by_profile_id,undefined);assert.equal(input.request_key,"retry");
  assert.equal((input.lines as Array<Record<string,unknown>>)[0].unit_mode,"subunit");
  assert.ok(m.queries.filter(q=>q.column==="organization_id").every(q=>q.value==="org"));
  await m.service.deletePurchase(actor,"tx");assert.equal(m.calls[1].name,"delete_purchase_atomic");assert.equal(m.calls[1].args.p_purchase_id,"tx");
  const unavailable=mock({code:"PGRST202",message:"missing"});
  await assert.rejects(unavailable.service.createPurchase(actor,valid),/database upgrade/);
  assert.equal(unavailable.calls.length,1,"Never fall back to partial writes");
  await assert.rejects(m.service.createPurchase({...actor,organizationId:""},valid),/Organization/);
  console.log("Purchase service validation, tenant scoping, actor identity, atomic RPC delegation and fail-closed migration tests passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
