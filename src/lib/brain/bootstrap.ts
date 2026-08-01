import { MemoryStore } from "./memory/business-memory";
import { MemoryWriter } from "./memory/memory-writer";
import { PreferenceStore } from "./learning/preference-store";
import { ContextRetriever, ContextBundle } from "./context/context-retriever";
import { executeSkill } from "./skills/skill-registry";
import { sanitizeMessage, sanitizeHistory } from "./sanitize";
import { checkRateLimit } from "./rate-limit";
import { logPiiSafe, filterResponse } from "./pii-filter";
import type { MemoryWriterRawData, PreferencesSnapshot } from "./contracts/memory";
import type { SkillResult } from "./contracts/skills";
import { conversationRuntime } from "@/lib/ai/conversation-runtime";

// ─── Public Interface ───

export interface ChatResult {
  ok: boolean;
  message: string;
  provider?: string;
  model?: string;
  error?: string;
}

export interface BusinessBrain {
  getContext(): ContextBundle;
  getMinimalContext(): ContextBundle;
  getBusinessContext(): string;
  executeSkill(skillId: string, input?: Record<string, unknown>): SkillResult<unknown>;
  getPreferences(): PreferencesSnapshot;
  recordInteraction(topic: string): void;
  recordPeriod(period: "today" | "week" | "month"): void;
  recordLanguage(language: "english" | "urdu" | "roman_urdu"): void;
  getMemorySnapshot(): {
    organizationId: string;
    organizationName: string;
    productCount: number;
    customerCount: number;
    supplierCount: number;
    staffCount: number;
    healthScore: { score: number; label: string };
    kpiCount: number;
    recommendationCount: number;
    memoryAgeMs: number;
    byteSize: number;
    isStale: boolean;
  };
  refreshAnalytics(): void;
  chat(message: string): Promise<ChatResult>;
}

// ─── Singleton Instance ───

let _instance: BusinessBrain | null = null;
let _store: MemoryStore | null = null;
let _writer: MemoryWriter | null = null;
let _prefs: PreferenceStore | null = null;
let _retriever: ContextRetriever | null = null;

export function getBusinessBrain(): BusinessBrain | null {
  return _instance;
}

// ─── Bootstrap ───

export function initializeBusinessBrain(data: MemoryWriterRawData): BusinessBrain {
  if (_instance) {
    _writer?.clear();
  }

  const store = new MemoryStore();
  const prefs = new PreferenceStore();
  const writer = new MemoryWriter(store, prefs);
  const retriever = new ContextRetriever(store);

  writer.writeRaw(data);

  conversationRuntime.setStore(store);
  conversationRuntime.setPrefs(prefs);

  const brain: BusinessBrain = {
    getContext: () => retriever.getFullContext(),
    getMinimalContext: () => retriever.getMinimalContext(),
    getBusinessContext: () => retriever.getBusinessContext(),
    executeSkill: (skillId: string, input?: Record<string, unknown>) =>
      executeSkill(skillId, input ?? {}, store, prefs),
    getPreferences: () => prefs.get(),
    recordInteraction: (topic: string) => {
      prefs.incrementTopic(topic);
    },
    recordPeriod: (period: "today" | "week" | "month") => {
      prefs.recordPeriodHint(period);
    },
    recordLanguage: (language: "english" | "urdu" | "roman_urdu") => {
      prefs.recordLanguage(language);
    },
    getMemorySnapshot: () => ({
      organizationId: store.meta.organizationId,
      organizationName: store.meta.organizationName,
      productCount: store.products.size,
      customerCount: store.customers.size,
      supplierCount: store.suppliers.size,
      staffCount: store.staff.size,
      healthScore: { score: store.analytics.healthScore.score, label: store.analytics.healthScore.label },
      kpiCount: store.analytics.kpis.length,
      recommendationCount: store.recommendations.active.length,
      memoryAgeMs: store.ageMs,
      byteSize: store.byteSize,
      isStale: store.isStale,
    }),
    refreshAnalytics: () => {
      writer.refreshAnalytics();
    },
    chat: async (rawMessage: string): Promise<ChatResult> => {
      try {
        const rl = checkRateLimit("brain_chat_instance", 60, 60_000);
        if (!rl.allowed) {
          return { ok: false, message: "", error: "Rate limit exceeded. Please wait before sending another message." };
        }
        const sanitized = sanitizeMessage(rawMessage);
        if (!sanitized.ok) {
          return { ok: false, message: "", error: sanitized.error };
        }
        const message = sanitized.cleaned;

        const sessionId = "default_session";
        const orgId = store.meta.organizationId;
        const profileId = store.meta.ownerName ? "owner" : null;

        // Skip runtime when no business data is loaded (gateway validation calls without data)
        const existingSession = conversationRuntime.getSession(sessionId);
        const hasNoData = !orgId || orgId === "";
        const isIdleOrMissing = !existingSession || ["idle", "completed", "cancelled"].includes(existingSession.state);

        if (hasNoData && isIdleOrMissing) {
          return { ok: true, message: message };
        }

        const runtimeResult = await conversationRuntime.processMessage(
          message,
          sessionId,
          orgId,
          profileId
        );

        if (runtimeResult.state === "idle" && runtimeResult.actionType === null) {
          return { ok: true, message: runtimeResult.response };
        }

        prefs.incrementTopic(String(runtimeResult.actionType || "chat"));
        logPiiSafe("info", "conversation_runtime", "Conversation runtime processed message", {
          state: runtimeResult.state,
          actionType: runtimeResult.actionType,
          responseLength: runtimeResult.response.length,
        });

        return { ok: true, message: runtimeResult.response };
      } catch (err) {
        logPiiSafe("error", "chat_fetch_error", "Chat fetch exception", { error: err instanceof Error ? err.message : "Unknown" });
        return {
          ok: false,
          message: "",
          error: err instanceof Error ? err.message : "Chat request failed",
        };
      }
    },
  };

  _instance = brain;
  _store = store;
  _writer = writer;
  _prefs = prefs;
  _retriever = retriever;

  return brain;
}
