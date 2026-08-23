import { createSupabaseService } from "@/lib/supabase/server";

const INVALID_SALE_STATUSES = new Set(["cancelled", "void"]);

export type AssignedCustomer = {
  id: string;
  customer_name: string;
  shop_name: string | null;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  area: string | null;
  city: string | null;
  address: string | null;
  assigned_territory_id: string | null;
};

export type SalesmanAssignmentScope = {
  employee: Record<string, unknown>;
  territory: Record<string, unknown> | null;
  route: Record<string, unknown> | null;
  stops: Array<Record<string, unknown>>;
  customers: AssignedCustomer[];
  eligibleCustomerIds: string[];
};

export function resolveEligibleCustomerIds(input: {
  assignedTerritoryId: string | null;
  directCustomerIds: string[];
  routeCustomerIds: string[];
  customerTerritoryById: Map<string, string | null>;
}): string[] {
  const candidates = new Set([...input.directCustomerIds, ...input.routeCustomerIds]);
  return [...candidates].filter((customerId) => {
    if (!input.assignedTerritoryId) return true;
    return input.customerTerritoryById.get(customerId) === input.assignedTerritoryId;
  });
}

export function routeCustomersForAssignmentScope(directCustomerIds: string[], routeCustomerIds: string[]): string[] {
  return directCustomerIds.length > 0 ? [] : routeCustomerIds;
}

export async function loadSalesmanAssignmentScope(input: {
  organizationId: string;
  profileId?: string;
  employeeId?: string;
}): Promise<SalesmanAssignmentScope | null> {
  const supabase = createSupabaseService();
  let employeeQuery = supabase
    .from("employees")
    .select("id, profile_id, employee_id, full_name, phone, email, designation, department, joining_date, status, photo_url, assigned_territory_id, assigned_route_id, is_active")
    .eq("organization_id", input.organizationId);
  employeeQuery = input.employeeId
    ? employeeQuery.eq("id", input.employeeId)
    : employeeQuery.eq("profile_id", input.profileId ?? "");
  const { data: employee, error: employeeError } = await employeeQuery.maybeSingle();
  if (employeeError) throw new Error(`Employee lookup failed: ${employeeError.message}`);
  if (!employee) return null;

  const [territoryResult, routeResult, directCustomersResult] = await Promise.all([
    employee.assigned_territory_id
      ? supabase
          .from("territories")
          .select("id, name, description, center_lat, center_lng, radius_km, is_active")
          .eq("organization_id", input.organizationId)
          .eq("id", employee.assigned_territory_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    employee.assigned_route_id
      ? supabase
          .from("sales_routes")
          .select("id, name, description, territory_id, route_frequency, is_active, assigned_salesman_id")
          .eq("organization_id", input.organizationId)
          .eq("id", employee.assigned_route_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("customers")
      .select("id, customer_name, shop_name, contact_person, phone, whatsapp, area, city, address, assigned_territory_id")
      .eq("organization_id", input.organizationId)
      .eq("assigned_salesman_id", employee.id)
      .eq("is_active", true)
      .order("customer_name", { ascending: true }),
  ]);
  const setupError = territoryResult.error ?? routeResult.error ?? directCustomersResult.error;
  if (setupError) throw new Error(`Assignment lookup failed: ${setupError.message}`);

  const route = routeResult.data;
  const { data: stops, error: stopsError } = route
    ? await supabase
        .from("sales_route_stops")
        .select("id, route_id, customer_id, stop_order, label, address, latitude, longitude")
        .eq("organization_id", input.organizationId)
        .eq("route_id", route.id)
        .order("stop_order", { ascending: true })
    : { data: [], error: null };
  if (stopsError) throw new Error(`Route stops lookup failed: ${stopsError.message}`);

  const directCustomers = (directCustomersResult.data ?? []) as AssignedCustomer[];
  const directCustomerIds = directCustomers.map((customer) => String(customer.id));
  const routeCustomerIds = [...new Set((stops ?? []).map((stop) => stop.customer_id).filter(Boolean).map(String))];
  // Explicit customer assignments represent a selected subset. When no
  // explicit subset exists, the complete assigned route is the sale scope.
  const effectiveRouteCustomerIds = routeCustomersForAssignmentScope(directCustomerIds, routeCustomerIds);
  const missingRouteIds = effectiveRouteCustomerIds.filter((id) => !directCustomerIds.includes(id));
  const { data: routeCustomers, error: routeCustomersError } = missingRouteIds.length
    ? await supabase
        .from("customers")
        .select("id, customer_name, shop_name, contact_person, phone, whatsapp, area, city, address, assigned_territory_id")
        .eq("organization_id", input.organizationId)
        .eq("is_active", true)
        .in("id", missingRouteIds)
    : { data: [], error: null };
  if (routeCustomersError) throw new Error(`Route customers lookup failed: ${routeCustomersError.message}`);

  const candidateCustomers = [...directCustomers, ...((routeCustomers ?? []) as AssignedCustomer[])];
  const customerById = new Map(candidateCustomers.map((customer) => [String(customer.id), customer]));
  const customerTerritoryById = new Map(
    candidateCustomers.map((customer) => [String(customer.id), customer.assigned_territory_id ? String(customer.assigned_territory_id) : null]),
  );
  const eligibleCustomerIds = resolveEligibleCustomerIds({
    assignedTerritoryId: employee.assigned_territory_id ? String(employee.assigned_territory_id) : null,
    directCustomerIds,
    routeCustomerIds: effectiveRouteCustomerIds,
    customerTerritoryById,
  });
  const customers = eligibleCustomerIds
    .map((id) => customerById.get(id))
    .filter((customer): customer is AssignedCustomer => Boolean(customer))
    .sort((left, right) => left.customer_name.localeCompare(right.customer_name));

  return {
    employee,
    territory: territoryResult.data,
    route,
    stops: stops ?? [],
    customers,
    eligibleCustomerIds,
  };
}

type SalesTransaction = {
  id: string;
  customer_id: string | null;
  invoice_number: string;
  total_amount: number | null;
  status: string | null;
  sale_date: string | null;
  created_at: string;
  payment_type: string | null;
  customers: { customer_name?: string | null; shop_name?: string | null } | null;
};

export async function buildSalesmanWorkspace(input: {
  organizationId: string;
  profileId?: string;
  employeeId?: string;
}) {
  const scope = await loadSalesmanAssignmentScope(input);
  if (!scope) return null;
  const employeeProfileId = String(scope.employee.profile_id ?? "");
  const supabase = createSupabaseService();
  const { data: salesData, error: salesError } = employeeProfileId
    ? await supabase
        .from("sales_transactions")
        .select("id, customer_id, invoice_number, total_amount, status, sale_date, created_at, payment_type, customers(customer_name, shop_name)")
        .eq("organization_id", input.organizationId)
        .eq("created_by_profile_id", employeeProfileId)
        .order("sale_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (salesError) throw new Error(`Sales overview failed: ${salesError.message}`);

  const sales = ((salesData ?? []) as unknown as SalesTransaction[]).filter(
    (sale) => !INVALID_SALE_STATUSES.has(String(sale.status ?? "")),
  );
  const saleIds = sales.map((sale) => sale.id);
  const { data: itemData, error: itemError } = saleIds.length
    ? await supabase
        .from("sales_items")
        .select("sales_transaction_id, product_id, quantity, selling_price, discount, products(name, sku)")
        .in("sales_transaction_id", saleIds)
    : { data: [], error: null };
  if (itemError) throw new Error(`Product ranking failed: ${itemError.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStartDate = new Date(`${today}T00:00:00Z`);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekStartDate.getUTCDay());
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const amount = (sale: SalesTransaction) => Number(sale.total_amount ?? 0);
  const saleDate = (sale: SalesTransaction) => String(sale.sale_date ?? sale.created_at).slice(0, 10);
  const sum = (rows: SalesTransaction[]) => rows.reduce((total, sale) => total + amount(sale), 0);

  const byDateMap = new Map<string, { date: string; total: number; count: number }>();
  const byCustomerMap = new Map<string, { customer_id: string; name: string; total: number; count: number }>();
  for (const sale of sales) {
    const date = saleDate(sale);
    const day = byDateMap.get(date) ?? { date, total: 0, count: 0 };
    day.total += amount(sale);
    day.count += 1;
    byDateMap.set(date, day);

    const customerId = String(sale.customer_id ?? "unassigned");
    const name = sale.customers?.shop_name ?? sale.customers?.customer_name ?? "Unassigned customer";
    const customer = byCustomerMap.get(customerId) ?? { customer_id: customerId, name, total: 0, count: 0 };
    customer.total += amount(sale);
    customer.count += 1;
    byCustomerMap.set(customerId, customer);
  }

  const byProductMap = new Map<string, { product_id: string; name: string; quantity: number; total: number }>();
  for (const rawItem of itemData ?? []) {
    const item = rawItem as unknown as {
      product_id: string | number;
      quantity: number | null;
      selling_price: number | null;
      discount: number | null;
      products: { name?: string | null; sku?: string | null } | null;
    };
    const productId = String(item.product_id);
    const product = byProductMap.get(productId) ?? {
      product_id: productId,
      name: item.products?.name ?? item.products?.sku ?? `Product ${productId}`,
      quantity: 0,
      total: 0,
    };
    const quantity = Number(item.quantity ?? 0);
    product.quantity += quantity;
    product.total += quantity * Number(item.selling_price ?? 0) - Number(item.discount ?? 0);
    byProductMap.set(productId, product);
  }

  return {
    ...scope,
    sales: {
      total: sum(sales),
      today: sum(sales.filter((sale) => saleDate(sale) === today)),
      thisWeek: sum(sales.filter((sale) => saleDate(sale) >= weekStart)),
      thisMonth: sum(sales.filter((sale) => saleDate(sale) >= monthStart)),
      count: sales.length,
      byDate: [...byDateMap.values()].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 30),
      byCustomer: [...byCustomerMap.values()].sort((left, right) => right.total - left.total),
      byProduct: [...byProductMap.values()].sort((left, right) => right.total - left.total),
      recent: sales.slice(0, 10),
    },
  };
}
