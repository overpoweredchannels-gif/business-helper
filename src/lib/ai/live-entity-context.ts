import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseService } from "@/lib/supabase/server";
import { normalizeForSearch } from "../brain/memory/fuzzy-match";
import { createConversationContext, formatConfirmationSummary, hasAllRequiredFields } from "./conversation-engine";
import { conversationRuntime } from "./conversation-runtime";
import { todayInTimezone } from "./confirmation-content";
import { describeLiveMatch, resolveLiveCandidate, searchCustomersLive, searchProductsLive } from "./entity-match";
import { formatAiMoney } from "./ai-money";

export async function loadLiveEntityRows<T>(
  client: SupabaseClient, organizationId: string, table: "products" | "customers", columns: string,
): Promise<T[] | null> {
  const rows: T[] = [];
  const size = 500;
  for (let start = 0; ; start += size) {
    const { data, error } = await client.from(table).select(columns).eq("organization_id", organizationId)
      .order("id", { ascending: true }).range(start, start + size - 1);
    if (error || !data) return null;
    rows.push(...data as T[]);
    if (data.length < size) return rows;
  }
}

export async function liveEntityContext(message: string, organizationId: string, currency: string, salePreview = false) {
  const { intent, entities } = await conversationRuntime.classifyIntent(message);
  const text = normalizeForSearch(message);
  const name = (value: unknown) => {
    if (typeof value !== "string") return "";
    const normalized = normalizeForSearch(value);
    return normalized && text.includes(normalized) ? value.trim() : "";
  };
  const productName = name(entities.product_name);
  const customerName = name(entities.customer_name);
  const unavailable = { block: "", reply: "The live catalogue search is unavailable. Please try again." };
  if (!productName && !customerName) {
    return { block: "", reply: salePreview && intent === "create_sale" ? "Which product and customer is this sale for?" : null };
  }
  try {
    const client = createSupabaseService();
    const [productRows, customerRows] = await Promise.all([
      productName ? loadLiveEntityRows<Parameters<typeof searchProductsLive>[1][number]>(
        client, organizationId, "products", "id, name, current_stock, default_selling_price, is_active") : null,
      customerName ? loadLiveEntityRows<Parameters<typeof searchCustomersLive>[1][number]>(
        client, organizationId, "customers", "id, customer_name, shop_name, credit_policy, is_active") : null,
    ]);
    const products = productRows ? searchProductsLive(productName, productRows) : null;
    const customers = customerRows ? searchCustomersLive(customerName, customerRows) : null;
    const product = resolveLiveCandidate(products ?? []);
    const customer = resolveLiveCandidate(customers ?? []);
    const block = `LIVE ENTITY SEARCH\n${JSON.stringify([
      ...(productName ? [{ kind: "product", query: productName, candidates: products?.map((row) => ({
        ...row, displayPrice: row.defaultSellingPrice == null ? null : formatAiMoney(row.defaultSellingPrice, currency),
      })) ?? null }] : []),
      ...(customerName ? [{ kind: "customer", query: customerName, candidates: customers }] : []),
    ])}`;
    if (productName && !product) return { block, reply: describeLiveMatch("product", productName, products) };
    if (customerName && !customer) return { block, reply: describeLiveMatch("customer", customerName, customers) };
    if (!salePreview || intent !== "create_sale") return { block, reply: null };
    if (!product || !customer) return { block, reply: product ? "Which customer is this sale for?" : "Which product is this sale for?" };

    const organization = await client.from("organizations").select("books_currency, regional_preferences")
      .eq("id", organizationId).maybeSingle();
    const booksCurrency = organization.data?.books_currency ?? organization.data?.regional_preferences?.accountingCurrency ?? currency;
    const context = createConversationContext("sale-preview", organizationId, null);
    context.actionType = "create_sale";
    const quantity = typeof entities.quantity === "number" && entities.quantity > 0 ? entities.quantity : null;
    const price = typeof entities.selling_price === "number" && entities.selling_price >= 0
      ? entities.selling_price : (product.defaultSellingPrice ?? 0) > 0 ? product.defaultSellingPrice : null;
    const payment = entities.payment_type === "cash" || entities.payment_type === "credit"
      ? entities.payment_type : customer.creditPolicy === "cash_only" ? "cash" : null;
    context.collectedData = {
      product_id: product.id, customer_id: customer.id, _product_name: product.name, _customer_name: customer.name,
      quantity, selling_price: price, payment_type: payment,
      invoice_date: todayInTimezone(organization.data?.regional_preferences?.timeZone ?? "Asia/Karachi"),
    };
    if (!hasAllRequiredFields(context)) {
      return { block, reply: !quantity ? "How many units?" : price == null ? "What is the selling price per unit?" : "Is this cash or credit?" };
    }
    const stock = product.currentStock;
    if (stock != null && quantity != null && quantity > stock) return { block, reply: `Only ${stock} units of ${product.name} are in stock.` };
    return {
      block,
      reply: `Sale confirmation preview\n${formatConfirmationSummary(context, { currency: booksCurrency }).replace(/\n\nShould I proceed\?$/, "")}\nStock: ${stock ?? "unavailable"}. Open Sales to submit after reviewing.`,
    };
  } catch (error) {
    console.error("Live Assistant entity search failed:", error);
    return unavailable;
  }
}
