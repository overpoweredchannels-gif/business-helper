import assert from "node:assert/strict";
import { DraftSaleService } from "../src/lib/sales/services/draft-sale-service";
import type { ActorContext } from "../src/lib/identity/types";

async function main() {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const customers = [
    { id: "unassigned", organization_id: "org-a", is_active: true, customer_name: "Unassigned" },
    { id: "foreign", organization_id: "org-b", is_active: true, customer_name: "Other tenant" },
    { id: "inactive", organization_id: "org-a", is_active: false, customer_name: "Inactive" },
  ];
  const db = { from(table: string) {
    const filters: Record<string, unknown> = {};
    const result = () => ({ data: table === "customers" ? customers.find(row => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value)) ?? null
      : table === "products" ? { id: "product", name: "Product", current_stock: 100 }
      : table === "sales_orders" ? { id: "draft", so_number: "SO-TEST" } : null, error: null });
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      insert: (value: Record<string, unknown>) => { inserted.push({ table, value }); return query; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } };
  const dependencies = {
    createSupabaseService: () => db,
    loadSalesmanAssignmentScope: async () => ({ employee: { is_active: true }, eligibleCustomerIds: [], route: null }),
    getInvoiceNumberService: () => ({ generateSalesOrder: async () => "SO-TEST" }),
    logAuditEvent: async () => undefined,
  } as unknown as ConstructorParameters<typeof DraftSaleService>[0];
  const service = new DraftSaleService(dependencies);
  const actor = { organizationId: "org-a", profileId: "employee-a", role: "salesman", isOwner: false, isActive: true, email: null } satisfies ActorContext;
  const input = { customerId: "unassigned", saleDate: "2026-09-02", items: [{ productId: "product", quantity: 2, unitPrice: 50, unitMode: "subunit" as const, bonus: 1 }] };
  const result = await service.createDraft(actor, input);
  assert.equal(result.ok, true, result.error);
  const order = inserted.find(row => row.table === "sales_orders")!.value;
  assert.equal(order.status, "pending_approval");
  assert.equal(order.created_by_profile_id, actor.profileId);
  assert.equal(order.order_date, "2026-09-02");
  for (const customerId of ["foreign", "inactive"]) {
    const before = inserted.length;
    assert.equal((await service.createDraft(actor, { ...input, customerId })).ok, false);
    assert.equal(inserted.length, before, "Invalid customer must be rejected before writes");
  }
  assert.equal((await service.createDraft(actor, { ...input, saleDate: "2026-02-31" })).ok, false);
  for (const invalid of [{ quantity: Infinity }, { unitPrice: NaN }, { unitPrice: -1 }, { discount: -1 }, { discount: 101 }, { bonus: -1 }, { bonus: Infinity }]) {
    const before = inserted.length;
    const rejected = await service.createDraft(actor, { ...input, items: [{ ...input.items[0], ...invalid }] });
    assert.equal(rejected.ok, false, `Invalid amounts must fail: ${JSON.stringify(invalid)}`);
    assert.equal(inserted.length, before, "Invalid amounts must be rejected before writes");
  }
  console.log("Unassigned organization customer allowed; foreign/inactive customers denied; approval and entered date preserved.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
