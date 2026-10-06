import type { SearchRankFields } from "@/lib/products/search-rank";

export interface SuggestionItem {
  id: string;
  label: string;
  /** Secondary line, e.g. "SKU-001 · Rs 120". Plain text only. */
  detail?: string;
}

export interface SuggestionData {
  items: SuggestionItem[];
  /** Prebuilt id → structured rank fields for the shared ranking contract. */
  rankFields: Map<string, SearchRankFields>;
}

/**
 * Moves the selected record to the front of an already-ranked list, keeping
 * the relative order of everything else. Used so that choosing one of several
 * identically named records shows the chosen record first. Returns the input
 * untouched when there is no selection or the record is absent/not first.
 */
export function pinSelectedFirst<T>(
  items: readonly T[],
  selectedId: string | null | undefined,
  idOf: (item: T) => string,
): T[] {
  if (!selectedId) return [...items];
  const index = items.findIndex((item) => idOf(item) === selectedId);
  if (index <= 0) return [...items];
  const copy = [...items];
  const [selected] = copy.splice(index, 1);
  copy.unshift(selected);
  return copy;
}

interface ProductLike {
  id: string | number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  brand_id?: string | number | null;
  category_id?: string | number | null;
  default_selling_price?: number | string | null;
}

/**
 * Builds suggestion items + rank fields for a product list in one pass.
 * Tenant/role/permission filtering stays with the caller: only pass in
 * already-authorized products.
 */
export function buildProductSuggestionData(
  products: readonly ProductLike[],
  brandNameById: ReadonlyMap<string | number, string>,
  categoryNameById: ReadonlyMap<string | number, string>,
  formatPrice: (value: number) => string,
): SuggestionData {
  const items: SuggestionItem[] = [];
  const rankFields = new Map<string, SearchRankFields>();
  for (const product of products) {
    const id = String(product.id);
    const price = product.default_selling_price == null ? null : Number(product.default_selling_price);
    items.push({
      id,
      label: product.name,
      detail: [product.sku, price != null && Number.isFinite(price) ? formatPrice(price) : null]
        .filter(Boolean)
        .join(" · "),
    });
    rankFields.set(id, {
      name: product.name,
      sku: product.sku ?? null,
      barcode: product.barcode ?? null,
      brandName: product.brand_id != null ? (brandNameById.get(product.brand_id) ?? null) : null,
      categoryName: product.category_id != null ? (categoryNameById.get(product.category_id) ?? null) : null,
    });
  }
  return { items, rankFields };
}

interface CustomerLike {
  id: string;
  customer_name: string;
  shop_name?: string | null;
  organization_name?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  shipping_address?: string | null;
  customer_type?: string | null;
}

const joinPresent = (values: Array<string | null | undefined>): string | null => {
  const joined = values.filter(Boolean).join(" ");
  return joined || null;
};

/**
 * Builds suggestion items + rank fields for a customer list in one pass.
 * The shared rank contract treats shop name as the code field (exact shop
 * match ranks first) and phone as the secondary code, with contact person,
 * organization and type next, and city/area/address lowest — so the panel
 * can find everything the section filter could find, with name matches first.
 */
export function buildCustomerSuggestionData(customers: readonly CustomerLike[]): SuggestionData {
  const items: SuggestionItem[] = [];
  const rankFields = new Map<string, SearchRankFields>();
  for (const customer of customers) {
    const id = String(customer.id);
    items.push({
      id,
      label: customer.customer_name,
      detail: [customer.shop_name, customer.phone].filter(Boolean).join(" · "),
    });
    rankFields.set(id, {
      name: customer.customer_name,
      sku: customer.shop_name ?? null,
      barcode: customer.phone ?? null,
      brandName: joinPresent([customer.contact_person, customer.organization_name, customer.customer_type, customer.whatsapp]),
      categoryName: joinPresent([customer.city, customer.area, customer.address, customer.shipping_address]),
    });
  }
  return { items, rankFields };
}
