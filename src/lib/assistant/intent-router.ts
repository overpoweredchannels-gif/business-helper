import type { AssistantEntityStore } from "./entity-store";
import type {
  AssistantIntent,
  AssistantCommand,
  EntityRef,
  ResolvedEntities,
  ModuleKind,
} from "./types";
import type { ActionType } from "../ai/conversation-engine";
import type { FinancialQueryKind } from "../ai/financial-intelligence";

const FINANCIAL_SKIP_WORDS = /\b(sell|sold|order|buy|purchase|khareed|kharid|restock|record|book|add|register|pay|supplier|vendor|thok|wholesaler|supplies|supply|customer|client|gahak|kharidar|staff|employee|karmi|karmchari|worker|banda)\b/i;

const FINANCIAL_KEYWORDS = [
  /cash\s*(balance|position|kitna|kitni)/i,
  /bank\s*(balance|mein|main)/i,
  /khaatay/i,
  /total\s*cash/i,
  /(gross|net)\s*profit/i,
  /profit\s*(margin|by|trend)/i,
  /\bmargin\b/i,
  /\bmargins\b/i,
  /\bfaida\b/i,
  /\bmunafa\b/i,
  /\breceivable\b/i,
  /\breceivables\b/i,
  /how\s*much\s*are\s*we\s*owed/i,
  /owed\s*to\s*us/i,
  /kitna\s*baqi\s*aana/i,
  /baqi\s*aana/i,
  /baqi\s*aata/i,
  /\bpayable\b/i,
  /\bpayables\b/i,
  /how\s*much\s*do\s*we\s*owe\s*in\s*total/i,
  /kitna\s*baqi\s*dena/i,
  /kitna\s*dena\s*baqi/i,
  /total\s*payable/i,
  /(revenue|sales|profit|earning|kamaai|kamai|aamdani)\s*(by|for)/i,
  /(category|brand|product|employee|staff|salesman)\s*(revenue|profit|sales|earning|seller)/i,
  /(highest|lowest|best|top|most)\s*(revenue|profit|margin|earning|selling|sale)/i,
  /sales\s*(dropped|increased|trend)/i,
  /revenue\s*(trend|dropped|increased)/i,
  /profit\s*(trend|dropped|increased)/i,
  /(this\s*month|this\s*week|today)\s*(vs|versus|compared\s*to|than)\s*(last\s*month|last\s*week|yesterday|previous)/i,
  /financial\s*(summary|insights)/i,
  /\bexpenses\b/i,
  /\bkharcha\b/i,
  /\bkharchay\b/i,
  /top\s+products?\s+by\s+(revenue|profit|sales)/i,
  /financial\s+trends?/i,
];

function detectFinancialQuery(normalized: string): boolean {
  if (FINANCIAL_SKIP_WORDS.test(normalized)) return false;
  return FINANCIAL_KEYWORDS.some((re) => re.test(normalized));
}


const PAYMENT_PATTERNS: Array<{ type: "cash" | "credit"; re: RegExp }> = [
  { type: "cash", re: /\b(nakad|nagad|naghd|cash)\b/i },
  { type: "credit", re: /\b(udhaar|udhar|credit|card)\b/i },
];

const QUANTITY_PATTERNS: RegExp[] = [
  /(?:qty|quantity|units?|pieces?|pcs|cartons?|bundles?|kg|boxes?|packs?)\s*(?:of|:|=|is)?\s*(\d+)/i,
  /(\d+)\s*(?:units?|pieces?|pcs|cartons?|bundles?|kg|boxes?|packs?)\b/i,
];

const PRICE_PATTERNS: RegExp[] = [
  /(?:rs\.?|rupees?|pkr|price|rate|@)\s*(\d+)/i,
  /(\d+)\s*(?:rs\.?|rupees?|pkr)\b/i,
];

const CREDIT_DAYS_PATTERNS: RegExp[] = [
  /(\d+)\s*(?:days?|din|dinon)\b/i,
  /\b(?:credit\s*)?(?:days?|din|dinon)\s*(?:of|is|:|=|to)?\s*(\d+)/i,
];

const NOTES_PATTERN: RegExp = /notes?\s*(?:of|:|=|is)?\s*"([^"]+)"/i;

const CREDIT_LIMIT_PATTERN: RegExp = /(?:credit\s*)?limit\s*(?:of|is|:|=|to|rs\.?)?\s*(\d+)/i;

const CUSTOMER_TYPE_PATTERN: RegExp = /\b(wholesale|wholesaler|retail|retailer|institutional|distributor|reseller)\b/i;

const PHONE_PATTERNS: RegExp[] = [
  /(?:phone|mobile|cell|telephone|whatsapp|contact|number|no\.?)\s*(?:to|is|number|:|=)?\s*(\+?\d[\d\s-]{8,13})/i,
  /(\+?9?2?\s?3\d{2}[\s-]?\d{6,7}|\+?9?2?\s?3\d{9}|\d{11})/,
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  dozen: 12, half: 0.5,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, das: 10,
};

export interface CommandMatch {
  command: AssistantCommand;
  target?: string;
}

const COMMAND_PATTERNS: Array<{ command: AssistantCommand; re: RegExp }> = [
  { command: "undo", re: /^\s*(undo|wapis karo|waapis karo|wapas|peeche|rollback|remove that|hatao)\b/i },
  { command: "repeat", re: /^\s*(repeat|dobara|phir se|phir say|again|dubara)\b/i },
  { command: "continue", re: /^\s*(continue|jaari rakh|aage badh|proceed|next|chalo aage|continue karo)\b/i },
  { command: "cancel", re: /^\s*(cancel|rok do|band karo|stop|ruko|khatam karo|nhi chahiye)\b/i },
  { command: "resume", re: /^\s*(resume|restart|wapis shuru|start over|start again|phir se shuru)\b/i },
];

const KNOWN_AREAS = [
  "gulberg", "gulberg iii", "dha", "dha phase", "township", "johar town", "johar",
  "iqbal town", "model town", "bahria", "walled city", "defence",
];

export function detectCommand(message: string): CommandMatch | null {
  const normalized = message.trim();
  for (const { command, re } of COMMAND_PATTERNS) {
    const match = normalized.match(re);
    if (match && match.index === 0) {
      const rest = normalized.replace(re, "").trim();
      return { command, target: rest || undefined };
    }
  }
  return null;
}

export function extractNumberWords(normalized: string): number | null {
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(normalized)) return value;
  }
  return null;
}

export function extractPaymentType(normalized: string): "cash" | "credit" | null {
  for (const { type, re } of PAYMENT_PATTERNS) {
    if (re.test(normalized)) return type;
  }
  return null;
}

export function extractQuantity(normalized: string): number | null {
  for (const re of QUANTITY_PATTERNS) {
    const match = normalized.match(re);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function extractPrice(normalized: string): number | null {
  for (const re of PRICE_PATTERNS) {
    const match = normalized.match(re);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function extractCreditDays(normalized: string): number | null {
  for (const re of CREDIT_DAYS_PATTERNS) {
    const match = normalized.match(re);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function extractBareNumber(normalized: string): number | null {
  const match = normalized.match(/\b(\d+)\b/);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

const CUSTOMER_NAME_STOP = new Set([
  "add", "create", "new", "register", "update", "change", "edit", "delete", "remove",
  "banao", "bana", "karo", "karein", "hatay", "hatao", "badal", "upgrade", "khatam",
  "customer", "customers", "client", "clients", "gahak", "gaahek", "khareedar", "kharidar", "ka", "ki", "ke",
  "balance", "baki", "udhaar", "udhar", "outstanding", "owes", "owe", "overdue",
  "history", "report", "details", "profile", "info", "top", "biggest", "inactive",
  "blocked", "near", "qareeb", "limit", "credit", "days", "remaining", "phone",
  "mobile", "number", "show", "list", "tell", "find", "search", "khoj", "khojo",
  "dhoond", "who", "which", "what", "how", "where", "is", "hai", "hain", "please",
  "do", "does", "did", "the", "a", "an", "of", "for", "with", "to", "from", "in",
  "at", "on", "sir", "kitna", "kitne", "kaun", "kis", "all", "every",
  "gulberg", "gulberg iii", "dha", "dha phase", "township", "johar", "johar town",
  "iqbal town", "model town", "bahria", "walled city", "defence", "lahore",
  "and", "with", "has", "have", "are", "was", "were", "am", "money", "my",
  "their", "your", "our", "any", "some", "me", "its", "it", "us", "them", "him", "her",
]);

export function extractCustomerNameFragment(normalized: string): string | null {
  const words = normalized
    .toLowerCase()
    .split(/[^a-z0-9.]+/i)
    .filter((w) => w.length > 0 && !CUSTOMER_NAME_STOP.has(w) && !/^\d+$/.test(w));
  if (words.length === 0) return null;
  const name = words.join(" ");
  return name.length >= 2 ? name : null;
}

const SUPPLIER_NAME_STOP = new Set([
  "add", "create", "new", "register", "update", "change", "edit", "delete", "remove",
  "banao", "bana", "karo", "karein", "hatay", "hatao", "badal", "upgrade", "khatam",
  "supplier", "suppliers", "vendor", "vendors", "furnisher", "thoker", "thokar", "wholesaler",
  "balance", "baki", "udhaar", "udhar", "payable", "outstanding", "owes", "owe", "owed",
  "overdue", "debt", "qarz", "dena", "history", "report", "details", "profile", "info",
  "top", "biggest", "inactive", "blocked", "near", "qareeb", "limit", "credit", "days",
  "remaining", "payment", "payments", "paid", "money", "phone", "mobile", "number",
  "show", "list", "tell", "find", "search", "khoj", "khojo", "dhoond", "who", "which",
  "what", "how", "where", "is", "hai", "hain", "please", "do", "does", "did", "the", "a",
  "an", "of", "for", "with", "to", "from", "in", "at", "on", "sir", "kitna", "kitne",
  "kaun", "kis", "all", "every",
  "gulberg", "gulberg iii", "dha", "dha phase", "township", "johar", "johar town",
  "iqbal town", "model town", "bahria", "walled city", "defence", "lahore",
  "and", "with", "has", "have", "are", "was", "were", "am", "my",
  "their", "your", "our", "any", "some", "me", "its", "it", "us", "them", "him", "her",
  "supplies", "supply", "provide", "average", "avg", "frequency", "kitni dafa",
  "kitni baar", "last", "transaction", "invoice", "purchase", "purchases", "order",
  "orders", "supplied",
]);

export function extractSupplierNameFragment(normalized: string): string | null {
  const words = normalized
    .toLowerCase()
    .split(/[^a-z0-9.]+/i)
    .filter((w) => w.length > 0 && !SUPPLIER_NAME_STOP.has(w) && !/^\d+$/.test(w));
  if (words.length === 0) return null;
  const name = words.join(" ");
  return name.length >= 2 ? name : null;
}

export function extractCreditLimit(normalized: string): number | null {
  const match = normalized.match(CREDIT_LIMIT_PATTERN);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function extractCustomerType(normalized: string): string | null {
  const match = normalized.match(CUSTOMER_TYPE_PATTERN);
  if (!match) return null;
  const type = match[1].toLowerCase();
  if (type === "wholesale" || type === "wholesaler") return "Wholesale";
  if (type === "institutional") return "Institutional";
  if (type === "distributor") return "Distributor";
  if (type === "reseller") return "Reseller";
  return "Retail";
}

export function extractPhone(normalized: string): string | null {
  for (const re of PHONE_PATTERNS) {
    const match = normalized.match(re);
    if (match) {
      const digits = (match[1] ?? match[0]).replace(/[^\d]/g, "");
      if (digits.length >= 10 && digits.length <= 13) {
        return (match[1] ?? match[0]).trim();
      }
    }
  }
  return null;
}

export function extractNotes(normalized: string): string | null {
  const match = normalized.match(NOTES_PATTERN);
  return match ? match[1] : null;
}

export function extractArea(normalized: string): string | null {
  for (const area of KNOWN_AREAS) {
    if (normalized.includes(area)) {
      return area === "gulberg iii" ? "Gulberg III" : area === "johar town" ? "Johar Town" : area === "dha phase" ? "DHA Phase" : capitalize(area);
    }
  }
  return null;
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function findEntityInMessage(store: AssistantEntityStore, kind: "product" | "customer" | "supplier" | "employee", message: string): EntityRef | null {
  const lower = message.toLowerCase();
  const collection =
    kind === "product" ? store.store.products
    : kind === "customer" ? store.store.customers
    : kind === "supplier" ? store.store.suppliers
    : store.store.staff;
  for (const entity of collection.values()) {
    const name = entity.name.toLowerCase();
    if (name.length >= 2 && lower.includes(name)) {
      return { id: entity.id, name: entity.name };
    }
  }
  return null;
}

function classifyQueryType(normalized: string, module: ModuleKind): string | null {
  switch (module) {
    case "inventory": {
      if (/\b(expir)/.test(normalized)) return "expiring";
      if (/\b(low|kam|short)\b.*\bstock/.test(normalized)) return "low_stock";
      if (/\b(out of stock|stock out|nhi hai|empty|khatam)\b/.test(normalized)) return "out_of_stock";
      if (/\b(reorder|re-order|order level)\b/.test(normalized)) return "reorder";
      if (/\b(overstock|zayada|extra)\b/.test(normalized)) return "overstocked";
      if (/\b(value|worth|cost)\b/.test(normalized)) return "inventory_value";
      if (/\b(category|brand)\b/.test(normalized)) return "category_summary";
      if (/\b(fast moving|fast-movi|fast movi|tez)\b/.test(normalized)) return "fast_moving";
      if (/\b(slow moving|slow movi|dheema)\b/.test(normalized)) return "slow_moving";
      return "quantity_lookup";
    }
    case "staff": {
      if (/\b(on duty|duty par|on shift)\b/.test(normalized)) return "who_on_duty";
      if (/\b(off duty|not working|chhutti|leave|off today)\b/.test(normalized)) return "who_off_duty";
      if (/\b(role|position)\b/.test(normalized)) return "staff_by_role";
      if (/\b(assignments?|kahan duty|area assignment)\b/.test(normalized)) return "show_assignments";
      if (/\b(area|kis area)\b/.test(normalized)) return "assignment_by_area";
      if (/\b(active|inactive)\b/.test(normalized)) return "active_staff";
      return "find_employee";
    }
    case "location": {
      if (/\b(where is|kahan hai|kaha hai|find.*location|track)\b/.test(normalized)) return "where_is_employee";
      if (/\b(closest|near|qareeb|pas)\b/.test(normalized)) return "closest_to_area";
      if (/\b(not updated|no location|ghost)\b/.test(normalized)) return "not_updated";
      if (/\b(moving|moving now|chaltay)\b/.test(normalized)) return "currently_moving";
      if (/\b(all|everyone|sab)\b/.test(normalized)) return "all_locations";
      return "where_is_employee";
    }
    case "sales": {
      if (/\b(this week|iss haftay|this month|iss mahine|last month|last week|today|aaj|yesterday)\b/.test(normalized)) return "period";
      if (/\b(profit|munafa|loss)\b/.test(normalized)) return "profit";
      if (/\b(payment|receivable|udhaar|credit)\b/.test(normalized)) return "payments";
      if (/\b(top product|best selling|best seller)\b/.test(normalized)) return "top_products";
      if (/\b(by staff|per staff|by employee)\b/.test(normalized)) return "by_staff";
      return "summary";
    }
    case "purchases": {
      if (/\b(this week|this month|last|today|aaj)\b/.test(normalized)) return "period";
      return "summary";
    }
    case "customers": {
      if (/\b(blocked|blacklist|black listed|band)\b/.test(normalized)) return "blocked";
      if (/\b(overdue|past due|late payment|der|waqt guzar)\b/.test(normalized)) return "overdue";
      if (
        /\b(inactive|dormant|ghost|not purchased|not bought|never purchased|kabhi nahi|sust)\b/.test(normalized) ||
        /(hasn'?t|didn'?t|havent|haven't).{0,25}(purchased|bought)/.test(normalized)
      ) {
        return "inactive";
      }
      if (/\b(most profitable|profitability|profit margin)\b/.test(normalized)) return "profitable";
      if (/\b(top customer|biggest customer|largest customer|best customer|sab se bara customer)\b/.test(normalized)) return "top";
      if (/\b(highest|sab se zyada|sab se ziyada).{0,20}(balance|outstanding|udhaar|baki)\b/.test(normalized)) return "highest_outstanding";
      if (/\b(credit days|days remaining|din baki|credit period)\b/.test(normalized)) return "credit_days";
      if (/\b(near|qareeb|almost|close|paas|over).{0,25}\blimit\b/.test(normalized)) return "near_limit";
      if (/\b(credit limit|credit_limit|limit)\b/.test(normalized)) return "credit_limit";
      if (
        /\b(last|aakhri|akhir|latest)\b/.test(normalized) &&
        /\b(transaction|sale|purchase|order|khareed|invoice)\b/.test(normalized)
      ) {
        return "last_transaction";
      }
      if (/\b(frequency|kitni dafa|kitni baar|how often|baar bar)\b/.test(normalized)) return "frequency";
      if (/\b(average|avg)\b/.test(normalized)) return "avg_order";
      if (/\b(bought|khareeda|khareedi|purchased|kis ne|kisne|kis nay|kis nai)\b/.test(normalized)) return "product_sales";
      if (/\b(owes|owe|kitne log|receivable|dena hai)\b/.test(normalized)) return "all_outstanding";
      if (/\b(find|search|khoj|khojo|dhoond|look up|fuzzy)\b/.test(normalized)) return "search";
      if (/\b(phone|mobile|cell|whatsapp|number)\b/.test(normalized)) return "search";
      if (extractArea(normalized) || extractCustomerType(normalized)) return "search";
      if (/\b(show|list|kitne)\b/.test(normalized) && /\bcustomer/.test(normalized)) return "search";
      if (/\b(balance|baki|udhaar|udhar|outstanding|debit)\b/.test(normalized)) return "balance";
      if (/\b(history|report|details?|profile|info)\b/.test(normalized)) return "history";
      if (/\b(top|biggest|best|largest|sab se bara)\b/.test(normalized)) return "top";
      return "summary";
    }
    case "suppliers": {
      if (/\b(blocked|blacklist|black listed|band)\b/.test(normalized)) return "blocked";
      if (/\b(overdue|past due|late payment|der|waqt guzar)\b/.test(normalized)) return "overdue";
      if (
        /\b(inactive|dormant|ghost|not purchased|not bought|never purchased|kabhi nahi|sust)\b/.test(normalized) ||
        /(hasn'?t|didn'?t|havent|haven't).{0,25}(purchased|bought|supplied)/.test(normalized)
      ) {
        return "inactive";
      }
      if (/\b(most profitable|profitability|profit margin)\b/.test(normalized)) return "profitable";
      if (/\b(top supplier|biggest supplier|largest supplier|best supplier|sab se bara supplier|highest purchase|highest purchases)\b/.test(normalized)) return "top";
      if (/\b(highest|sab se zyada|sab se ziyada).{0,20}(payable|balance|outstanding|udhaar|baki|qarz|dena)\b/.test(normalized)) return "highest_outstanding";
      if (/\b(credit days|days remaining|din baki|credit period)\b/.test(normalized)) return "credit_days";
      if (/\b(near|qareeb|almost|close|paas|over).{0,25}\blimit\b/.test(normalized)) return "near_limit";
      if (/\b(credit limit|credit_limit|limit)\b/.test(normalized)) return "credit_limit";
      if (
        /\b(last|aakhri|akhir|latest)\b/.test(normalized) &&
        /\b(purchase|purchases|supply|order|invoice|transaction)\b/.test(normalized)
      ) {
        return "last_transaction";
      }
      if (/\b(frequency|kitni dafa|kitni baar|how often|baar bar)\b/.test(normalized)) return "frequency";
      if (/\b(average|avg)\b/.test(normalized)) return "avg_order";
      if (/\b(supplies|supplied|supply|provide|detay hain|faroh|sells us|supplier of)\b/.test(normalized)) return "product_supply";
      if (/\b(payment|payments|paid|adaigi|bhugtan)\b/.test(normalized)) return "payment_history";
      if (/\b(owe|owes|owed|payable|dena hai|qarz|kitne log|receivable)\b/.test(normalized)) return "all_outstanding";
      if (/\b(find|search|khoj|khojo|dhoond|look up)\b/.test(normalized)) return "search";
      if (/\b(phone|mobile|cell|whatsapp|number)\b/.test(normalized)) return "search";
      if (extractArea(normalized)) return "search";
      if (/\b(history|report|details?|profile|info)\b/.test(normalized)) return "history";
      if (/\b(show|list|kitne)\b/.test(normalized) && /\bsupplier/.test(normalized)) return "search";
      if (/\b(balance|baki|udhaar|udhar|payable|dena)\b/.test(normalized)) return "balance";
      if (/\b(top|biggest|best|largest|sab se bara)\b/.test(normalized)) return "top";
      return "summary";
    }
    case "financial": {
      if (/(cash\s*(balance|position)|bank\s*balance|kitna\s*cash|khaatay)/i.test(normalized)) return "cash_balance";
      if (/(receivable|how\s*much\s*are\s*we\s*owed|baqi\s*aana)/i.test(normalized)) return "receivables";
      if (/(payable|payables|how\s*much\s*do\s*we\s*owe\s*in\s*total|baqi\s*dena)/i.test(normalized)) return "payables";
      if (/(gross\s*profit|net\s*profit|profit\s*margin|margin|munafa|faida)/i.test(normalized)) return "profit_overview";
      if (/(expenses|kharcha|kharchay)/i.test(normalized)) return "expenses_overview";
      if (/(inventory\s*value|stock\s*value)/i.test(normalized)) return "inventory_value";
      if (/(revenue|sales)\s*(by|for)|(category|brand|product|employee|staff|salesman)\s*(revenue|profit|sales|earning|seller|earns)|(highest|lowest|best|top|most)\s*(revenue|profit|margin|earning|selling|sale)|top\s+products?\s+by\s+(revenue|profit|sales)/i.test(normalized)) return "revenue_analytics";
      if (/(profit\s*(by|for)|(category|brand|product|employee|staff|salesman)\s*(profit|margin)|(highest|lowest|best|top|most)\s*(profit|margin))/i.test(normalized)) return "profit_analytics";
      if (/(trends?|dropped|increased|vs\s*last|compared\s*to\s*last|financial\s+trends?)/i.test(normalized)) return "trend_analysis";
      if (/(financial\s*summary|full\s*financial\s*report)/i.test(normalized)) return "financial_summary";
      if (/(financial\s*insights|show\s*insights|recommendations)/i.test(normalized)) return "financial_insights";
      return "financial_summary"; // Default to summary if specific query not found
    }
    case "business-intelligence": {
      if (/(demand|likely to sell|bikne wale|demand prediction|products.*sell|what.*sell)/i.test(normalized)) return "demand_prediction";
      if (/(forecast|sales forecast|weekly sales|monthly sales|tomorrow.*sale|sale.*tomorrow|kal ki bikri|hafte ki bikri|mahine ki bikri)/i.test(normalized)) return "sales_forecast";
      if (/(predict|sales forecast|weekly sales|monthly sales|tomorrow.*sale|sale.*tomorrow|kal ki bikri|hafte ki bikri|mahine ki bikri)/i.test(normalized)) return "sales_forecast";
      if (/(reorder|smart reorder|reorder date|stockout|reorder prediction|when.*reorder)/i.test(normalized)) return "reorder_prediction";
      if (/(churn|customer intelligence|customer prediction|inactive customer|high.?value customer)/i.test(normalized)) return "customer_prediction";
      if (/(supplier intelligence|supplier prediction|reliable supplier|delayed supplier|supplier.*reliable|which.*supplier)/i.test(normalized)) return "supplier_prediction";
      if (/(product intelligence|product prediction|rising product|declining product|dead stock|high margin|low margin)/i.test(normalized)) return "product_prediction";
      if (/(health score|business health)/i.test(normalized)) return "health_score";
      if (/(ai recommendation|recommendation)/i.test(normalized)) return "recommendations";
      return "health_score"; // default
    }
    default:
      return null;
  }
}

const SALES_ACTION_WORDS = /(record|create|new|karo|karein|banao|bana|bhej|bech|sell|add|register|book|nayi|new sale|sale par)/i;
const PURCHASE_ACTION_WORDS = /(order|khareed|kharid|bharo|restock|replenish|create|karo|banao|bana|add|buy)/i;
const STAFF_ACTION_WORDS = /\b(assign|reassign|remove|duty par lagao|lagao|hatao|hata|change|transfer|hire|fire|settle|post)\b/i;
const STAFF_QUERY_WORDS = /\b(show|list|display|report|status|summary|kaun|kitne|kitna)\b/i;
const CUSTOMER_ACTION_WORDS = /\b(add|create|new|register|update|change|edit|delete|remove|banao|bana|karo|karein|hatay|hatao)\b/i;
const CUSTOMER_QUERY_WORDS = /\b(who|what|which|how|balance|baki|udhaar|outstanding|owes|owe|overdue|history|top|biggest|inactive|list|show|report|summary|tell|find|search|khoj|highest|profitable|blocked|near|qareeb|frequency|average|remaining|last|kitna|kitne|kaun|kis)\b/i;
const SUPPLIER_ACTION_WORDS = /\b(add|create|new|register|update|change|edit|delete|remove|banao|bana|karo|karein|hatay|hatao)\b/i;
const SUPPLIER_QUERY_WORDS = /\b(who|what|which|how|balance|baki|udhaar|udhar|payable|dena|qarz|debt|owe|owes|owed|overdue|history|top|biggest|inactive|list|show|report|summary|tell|find|search|khoj|khojo|highest|profitable|blocked|near|qareeb|frequency|average|remaining|last|kitna|kitne|kaun|kis|supplies|supply|provide|payment|payments|paid|money)\b/i;
const SUPPLIER_PURCHASE_ACTION_EXCLUDE = /(order|khareed|kharid|buy|restock|stock bhar|bharo|record|book|draft)/i;

export class IntentRouter {
  constructor(private readonly store: AssistantEntityStore) {}

  classify(message: string): AssistantIntent {
    const normalized = message.toLowerCase().trim();
    this.lastNormalized = normalized;

    const intentModule = this.detectModule(normalized);
    const isAction = this.detectAction(normalized, intentModule);
    const actionType = this.resolveActionType(intentModule, isAction);
    const queryType = isAction ? null : classifyQueryType(normalized, intentModule);

    const entities = this.extractEntities(normalized);
    const confidence = this.confidenceFor(intentModule, normalized);

    return {
      module: intentModule,
      actionType,
      queryType,
      entities,
      raw: message,
      confidence,
      unresolvedNames: [],
    };
  }

  private detectModule(normalized: string): ModuleKind {
    // Business intelligence queries (predictive/AI) – check before financial
    const biKeywords = /(forecast|predict|prediction|predicted|likely to sell|demand prediction|smart reorder|reorder prediction|churn|customer intelligence|supplier intelligence|product intelligence|health score|business health|ai recommendation|sales forecast|weekly sales|monthly sales|tomorrow.*sale|sale.*tomorrow|ai insight|business intelligence|bikne wale|kal ki bikri|hafte ki bikri|mahine ki bikri|demand|reorder date|stockout|reliable supplier|supplier reliability|reorder when|when.*reorder|which.*supplier.*reliable|supplier.*performance|customer churn|churn risk|customer intelligence|product intelligence|dead stock|rising product|declining product|seasonal product|high margin|low margin)/i;
    if (biKeywords.test(normalized)) return "business-intelligence";

    if (detectFinancialQuery(normalized)) return "financial";
    const hasArea = extractArea(normalized) !== null;
    const mentionsStaff = /(staff|employee|karmi|karmchari|worker|banda|duty|milawat|on shift|role|sallary|salary|assign|reassign|remove|hire|fire|lagao|hatao)/i.test(normalized);
    const mentionsProduct = /(stock|inventory|product|item|goods|maal|expir|reorder|low stock|kitna)/i.test(normalized);
    const mentionsLocation = /(location|where is|where|kahan|kaha|track|position|coordinate|gps)/i.test(normalized);
    const mentionsSales = /(sale|sales|revenue|earning|kamai|aamdani|profit|invoice|sell|bech|bik)/i.test(normalized);
    const mentionsPurchase = /(purchase|khareed|kharid|order|supplier|restock|stock bhar)/i.test(normalized);
    const mentionsCustomers = /(customer|client|gahak|gaahek|khareedar|kharidar|balance|baki|udhaar|udhar|outstanding|owes|owe|overdue|credit limit|credit_limit|credit days|history|frequency|average order|top customer|biggest customer|inactive|bought|khareeda|purchased|most profitable|profitable|blocked|blacklist|wholesale|retail|store|shop|dukaan|dokan|phone|mobile|transaction|buys|buying|how often|kitni dafa|kitni baar|kitni dafaa|last transaction|find|search|khoj|khojo|dhoond|\b(add|register|delete|remove|update|edit)\b)/i.test(normalized);
    const mentionsSupplier =
      /(supplier|vendor|furnisher|thoker|thokar|wholesaler|supplies|supply)/i.test(normalized) ||
      findEntityInMessage(this.store, "supplier", normalized) !== null;
    const supplierQueryIntent =
      mentionsSupplier &&
      !SUPPLIER_PURCHASE_ACTION_EXCLUDE.test(normalized) &&
      (SUPPLIER_QUERY_WORDS.test(normalized) ||
        SUPPLIER_ACTION_WORDS.test(normalized) ||
        extractArea(normalized) !== null);
    const customerSaleCollision =
      /\b(sale|sales|sell|bech|bik|invoice|revenue|profit|report|summary|purchase|purchases|stock)\b/.test(normalized) &&
      /(record|create|new|add|sell|bech|bhej|book|order|khareed|kharid|bharo|restock|buy|shop|store|by customer|by supplier)/i.test(normalized);

    if (supplierQueryIntent) return "suppliers";
    if (mentionsPurchase && mentionsSupplierWord(normalized)) return "purchases";
    if (mentionsLocation && (mentionsStaff || hasArea || mentionsTrackWord(normalized))) return "location";
    if (mentionsStaff) return "staff";
    if (mentionsProduct && mentionsStockWord(normalized)) return "inventory";
    if (mentionsCustomers && !customerSaleCollision) return "customers";
    if (mentionsSales) return "sales";
    if (mentionsPurchase) return "purchases";
    return "general";
  }

  private detectAction(normalized: string, module: ModuleKind): boolean {
    switch (module) {
      case "sales":
        return SALES_ACTION_WORDS.test(normalized) && !/\b(how much|kitna|kitni|report|summary|tell me|batao|show)\b/.test(normalized);
      case "purchases":
        return PURCHASE_ACTION_WORDS.test(normalized) && !/\b(how much|kitna|report|summary|tell me|batao|show|list)\b/.test(normalized);
      case "staff":
        return STAFF_ACTION_WORDS.test(normalized) && !STAFF_QUERY_WORDS.test(normalized);
      case "customers":
        return CUSTOMER_ACTION_WORDS.test(normalized) && !CUSTOMER_QUERY_WORDS.test(normalized);
      case "suppliers":
        return SUPPLIER_ACTION_WORDS.test(normalized) && !SUPPLIER_QUERY_WORDS.test(normalized);
      default:
        return false;
    }
  }

  private resolveActionType(module: ModuleKind, isAction: boolean): ActionType {
    if (!isAction) {
      switch (module) {
        case "inventory": return "inventory_query";
        case "staff": return "staff_query";
        case "location": return "location_query";
        case "customers": return "customer_query";
        case "suppliers": return "supplier_query";
        case "sales": case "purchases": return "business_query";
        default: return "business_query";
      }
    }
    switch (module) {
      case "sales": return "create_sale";
      case "purchases": return "create_purchase";
      case "staff": {
        const normalized = this.lastNormalized;
        if (normalized && /\b(remove|hata|hatao)\b/.test(normalized)) return "remove_staff";
        if (normalized && /\b(reassign|change|transfer)\b/.test(normalized)) return "reassign_staff";
        return "assign_staff";
      }
      case "customers": {
        const normalized = this.lastNormalized;
        if (normalized && /\b(delete|remove|hata|hatao|hatay|khatam)\b/.test(normalized)) return "delete_customer";
        if (normalized && /\b(update|change|edit|badal|upgrade)\b/.test(normalized)) return "update_customer";
        return "create_customer";
      }
      case "suppliers": {
        const normalized = this.lastNormalized;
        if (normalized && /\b(delete|remove|hata|hatao|hatay|khatam)\b/.test(normalized)) return "delete_supplier";
        if (normalized && /\b(update|change|edit|badal|upgrade)\b/.test(normalized)) return "update_supplier";
        return "create_supplier";
      }
      default: return "business_query";
    }
  }

  private lastNormalized = "";

  private extractEntities(normalized: string): ResolvedEntities {
    const entities: ResolvedEntities = {
      customer: null,
      supplier: null,
      product: null,
      employee: null,
      area: extractArea(normalized),
      role: null,
      quantity: extractQuantity(normalized),
      sellingPrice: extractPrice(normalized),
      purchasePrice: null,
      paymentType: extractPaymentType(normalized),
      creditDays: extractCreditDays(normalized),
      notes: extractNotes(normalized),
      phone: extractPhone(normalized),
      creditLimit: extractCreditLimit(normalized),
      customerType: extractCustomerType(normalized),
      queryType: null,
    };

    entities.product = findEntityInMessage(this.store, "product", normalized);
    entities.customer = findEntityInMessage(this.store, "customer", normalized);
    entities.supplier = findEntityInMessage(this.store, "supplier", normalized);
    entities.employee = findEntityInMessage(this.store, "employee", normalized);

    if (entities.quantity === null) {
      const bare = extractBareNumber(normalized);
      if (bare !== null) entities.quantity = bare;
    }

    const roleMatch = normalized.match(/\b(role|position)\s*[:\s]+([a-z ]+)/i);
    if (roleMatch) entities.role = roleMatch[2].trim();

    return entities;
  }

  private confidenceFor(module: ModuleKind, normalized: string): number {
    if (module === "general") return 0.4;
    const keywordCount = (normalized.match(/\b(sale|stock|staff|location|purchase|order|invoice|duty|product|employee|supplier|customer|revenue|profit)\b/g) || []).length;
    return Math.min(0.95, 0.6 + keywordCount * 0.1);
  }
}

function mentionsSupplierWord(normalized: string): boolean {
  return /(supplier|from|se|khareedna)/.test(normalized);
}

function mentionsTrackWord(normalized: string): boolean {
  return /(track|gps|kahan|kaha|location|near|where)/.test(normalized);
}

function mentionsStockWord(normalized: string): boolean {
  return /(stock|inventory|quantity|kitna|bache|reorder|expir)/.test(normalized);
}

export function defaultEntities(): ResolvedEntities {
  return {
    customer: null,
    supplier: null,
    product: null,
    employee: null,
    area: null,
    role: null,
    quantity: null,
    sellingPrice: null,
    purchasePrice: null,
    paymentType: null,
    creditDays: null,
    notes: null,
    phone: null,
    creditLimit: null,
    customerType: null,
    queryType: null,
  };
}
