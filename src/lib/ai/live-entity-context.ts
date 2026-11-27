import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseService } from "@/lib/supabase/server";
import { normalizeForSearch } from "../brain/memory/fuzzy-match";
import { createConversationContext, formatConfirmationSummary, hasAllRequiredFields } from "./conversation-engine";
import { conversationRuntime } from "./conversation-runtime";
import { todayInTimezone } from "./confirmation-content";
import { describeLiveMatch, resolveLiveCandidate, searchCustomersLive, searchProductsLive } from "./entity-match";
import { formatAiMoney } from "./ai-money";
import { sanitizeMessage } from "../brain/sanitize";
import type { ServerChatHistoryEntry } from "./server-chat";

type SaleField = "product" | "customer" | "quantity" | "price" | "payment";
type SaleAnswer = { field: SaleField; question: string; answer: string };
const saleQuestions = {
  product: "Which product is this sale for?",
  customer: "Which customer is this sale for?",
  quantity: "How many units?",
  price: "What is the selling price per unit?",
  payment: "Is this cash or credit?",
} satisfies Record<SaleField, string>;

function saleContinuation(message: string, history: readonly ServerChatHistoryEntry[]) {
  const answers: SaleAnswer[] = [];
  let answer = message;
  for (let index = history.length - 1; index > 0; index -= 2) {
    const question = history[index];
    const previous = history[index - 1];
    if (question.role !== "assistant" || previous.role !== "user") break;
    const field = (Object.keys(saleQuestions) as SaleField[]).find((key) => saleQuestions[key] === question.text)
      ?? /^Which (product|customer) did you mean\? /.exec(question.text)?.[1] as SaleField | undefined;
    if (!field) break;
    answers.unshift({ field, question: question.text, answer });
    answer = previous.text;
  }
  const original = answers.length ? sanitizeMessage(answer) : null;
  return original?.ok ? { message: original.cleaned, answers } : null;
}

type Candidate = NonNullable<ReturnType<typeof resolveLiveCandidate>>;

function selectOfferedCandidate(candidates: readonly Candidate[], turn: SaleAnswer): Candidate | null {
  const options = turn.question.split(/\? \d+\. |; \d+\. /).slice(1);
  const number = /^([1-9]\d*)$/.exec(turn.answer.trim());
  const label = number ? options[Number(number[1]) - 1] : null;
  const normalized = normalizeForSearch(turn.answer);
  const matches = candidates.filter((row) => {
    if (row.status !== "active") return false;
    const shown = `${row.name}${row.detail ? ` (${row.detail})` : ""}`;
    return number ? shown === label : options.includes(shown) && (
      normalizeForSearch(row.name) === normalized ||
      /^walk in(?: customer)?$/.test(normalized) && /^walk in(?: customer)?$/.test(normalizeForSearch(row.name))
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

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

export async function liveEntityContext(
  message: string, organizationId: string, currency: string, salePreview = false,
  history: readonly ServerChatHistoryEntry[] = [],
  classify = (text: string) => conversationRuntime.classifyIntent(text),
  createClient = createSupabaseService,
) {
  let { intent, entities } = await classify(message);
  const continuation = salePreview && intent !== "create_sale" ? saleContinuation(message, history) : null;
  let answers: SaleAnswer[] = [];
  if (continuation) {
    if (/^(?:cancel|cancel sale|cancel the sale|never mind|no)$/i.test(message.trim())) {
      return { block: "", reply: "Sale preview cancelled." };
    }
    const original = await classify(continuation.message);
    if (!original.ok) {
      return { block: "", reply: "Please restate the full request so I can verify it against the live catalogue." };
    }
    if (original.intent === "create_sale") {
      ({ intent, entities } = original);
      message = continuation.message;
      answers = continuation.answers;
    }
  }
  const text = normalizeForSearch(message);
  const name = (value: unknown) => {
    if (typeof value !== "string") return "";
    const normalized = normalizeForSearch(value);
    return normalized && text.includes(normalized) ? value.trim() : "";
  };
  const answerFor = (field: SaleField) => answers.findLast((turn) => turn.field === field);
  const productAnswer = answerFor("product");
  const customerAnswer = answerFor("customer");
  const entityName = (field: "product" | "customer", original: unknown) =>
    answers.findLast((turn) => turn.field === field && turn.question === saleQuestions[field])?.answer
    || name(original);
  const productName = entityName("product", entities.product_name);
  const customerName = entityName("customer", entities.customer_name);
  const unavailable = { block: "", reply: "The live catalogue search is unavailable. Please try again." };
  if (!productName && !customerName) {
    return { block: "", reply: salePreview && intent === "create_sale" ? saleQuestions.product : null };
  }
  try {
    const client = createClient();
    const [productRows, customerRows] = await Promise.all([
      productName ? loadLiveEntityRows<Parameters<typeof searchProductsLive>[1][number]>(
        client, organizationId, "products", "id, name, current_stock, default_selling_price, is_active") : null,
      customerName ? loadLiveEntityRows<Parameters<typeof searchCustomersLive>[1][number]>(
        client, organizationId, "customers", "id, customer_name, shop_name, credit_policy, is_active") : null,
    ]);
    const products = productRows ? searchProductsLive(productName, productRows) : null;
    const customers = customerRows ? searchCustomersLive(customerName, customerRows) : null;
    const resolve = (rows: Candidate[] | null, turn?: SaleAnswer) =>
      turn?.question.includes("did you mean?")
        ? selectOfferedCandidate(rows ?? [], turn)
        : resolveLiveCandidate(rows ?? []);
    const product = resolve(products, productAnswer);
    const customer = resolve(customers, customerAnswer);
    const block = `LIVE ENTITY SEARCH\n${JSON.stringify([
      ...(productName ? [{ kind: "product", query: productName, candidates: products?.map((row) => ({
        ...row, displayPrice: row.defaultSellingPrice == null ? null : formatAiMoney(row.defaultSellingPrice, currency),
      })) ?? null }] : []),
      ...(customerName ? [{ kind: "customer", query: customerName, candidates: customers }] : []),
    ])}`;
    if (productName && !product) return { block, reply: describeLiveMatch("product", productName, products) };
    if (customerName && !customer) return { block, reply: describeLiveMatch("customer", customerName, customers) };
    if (!salePreview || intent !== "create_sale") return { block, reply: null };
    if (!product || !customer) return { block, reply: product ? saleQuestions.customer : saleQuestions.product };

    const organization = await client.from("organizations").select("books_currency, regional_preferences")
      .eq("id", organizationId).maybeSingle();
    const booksCurrency = organization.data?.books_currency ?? organization.data?.regional_preferences?.accountingCurrency ?? currency;
    const context = createConversationContext("sale-preview", organizationId, null);
    context.actionType = "create_sale";
    const numberAnswer = (field: "quantity" | "price") => {
      const value = answerFor(field)?.answer.trim();
      return value && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
    };
    const quantityValue = numberAnswer("quantity") ?? entities.quantity;
    const quantity = typeof quantityValue === "number" && quantityValue > 0 ? quantityValue : null;
    const price = numberAnswer("price") ?? (typeof entities.selling_price === "number" && entities.selling_price >= 0
      ? entities.selling_price : (product.defaultSellingPrice ?? 0) > 0 ? product.defaultSellingPrice : null);
    const paymentValue = answerFor("payment")?.answer.trim().toLowerCase() ?? entities.payment_type;
    const payment = paymentValue === "cash" || paymentValue === "credit"
      ? paymentValue : customer.creditPolicy === "cash_only" ? "cash" : null;
    context.collectedData = {
      product_id: product.id, customer_id: customer.id, _product_name: product.name, _customer_name: customer.name,
      quantity, selling_price: price, payment_type: payment,
      invoice_date: todayInTimezone(organization.data?.regional_preferences?.timeZone ?? "Asia/Karachi"),
    };
    if (!hasAllRequiredFields(context)) {
      return { block, reply: !quantity ? saleQuestions.quantity : price == null ? saleQuestions.price : saleQuestions.payment };
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
