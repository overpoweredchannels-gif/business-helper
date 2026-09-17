type AiProviderName = "gemini" | "openai" | "groq" | "xai" | "zai";

type ProviderAttempt = {
  provider: string;
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
};

type RouterInput = {
  task: string;
  prompt: string;
  jsonMode?: boolean;
  temperature?: number;
  expectedJsonShapeDescription?: string;
};

type RouterResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  text?: string;
  json?: any;
  raw?: any;
  attempts: ProviderAttempt[];
  error?: string;
};

const supportedProviders: AiProviderName[] = ["gemini", "openai", "groq", "xai", "zai"];
const fallbackStatuses = new Set([429, 404, 500, 502, 503, 504]);

const envText = (key: string) => {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
};

const uniqueTexts = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const text = value.trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
};

const timeoutMs = () => {
  const parsed = Number(envText("AI_PROVIDER_TIMEOUT_MS"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
};

const maxRetries = () => {
  const parsed = Number(envText("AI_MAX_RETRIES_PER_PROVIDER"));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 2) : 0;
};

const providerOrder = (): AiProviderName[] => {
  const configured = (envText("AI_PROVIDER_ORDER") || "gemini,openai,groq")
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is AiProviderName =>
      supportedProviders.includes(provider as AiProviderName)
    );
  return uniqueTexts(configured) as AiProviderName[];
};

const getModelsForProvider = (provider: AiProviderName) => {
  if (provider === "gemini") {
    if (!envText("GEMINI_API_KEY")) return [];
    return uniqueTexts([
      envText("GEMINI_PRIMARY_MODEL") || envText("GEMINI_MARKET_MODEL") || "gemini-flash-latest",
      envText("GEMINI_FALLBACK_MODEL"),
    ]);
  }

  if (provider === "openai") {
    if (!envText("EXPLABS_API_KEY")) return [];
    return ["gpt-5.6-luna"];
  }

  if (provider === "groq") {
    if (!envText("GROQ_API_KEY")) return [];
    return uniqueTexts([
      envText("GROQ_PRIMARY_MODEL") || envText("GROQ_MODEL") || "llama-3.3-70b-versatile",
      envText("GROQ_FALLBACK_MODEL") || "llama-3.1-8b-instant",
    ]);
  }

  if (provider === "xai") {
    if (!envText("XAI_API_KEY")) return [];
    return uniqueTexts([
      envText("XAI_PRIMARY_MODEL") || envText("XAI_MODEL") || "grok-4.5",
      envText("XAI_FALLBACK_MODEL"),
    ]);
  }

  if (provider === "zai") {
    if (!envText("ZAI_API_KEY") || !envText("ZAI_BASE_URL")) return [];
    return uniqueTexts([
      envText("ZAI_PRIMARY_MODEL") || envText("ZAI_MODEL"),
      envText("ZAI_FALLBACK_MODEL"),
    ]);
  }

  return [];
};

const safeLimitedText = (value: unknown, maxLength = 800) => {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const stripJsonFences = (text: string) => {
  const cleanText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return cleanText;
};

const parseJsonFromText = (text: string) => {
  const cleanText = stripJsonFences(text);
  try {
    return JSON.parse(cleanText);
  } catch {
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI response could not be parsed as JSON.");
    return JSON.parse(jsonMatch[0]);
  }
};

const parseResponseText = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return { text: safeLimitedText(text, 2000) };
  }
};

const extractProviderError = (status: number, text: string) => {
  const parsed = parseResponseText(text);
  const message =
    safeLimitedText(parsed?.error?.message, 700) ||
    safeLimitedText(parsed?.message, 700) ||
    safeLimitedText(parsed?.error, 700) ||
    safeLimitedText(text, 700);
  const statusText = safeLimitedText(parsed?.error?.status, 100);
  const code = parsed?.error?.code === undefined ? "" : safeLimitedText(parsed.error.code, 80);
  return [message || "Provider returned an error without a readable message.", statusText, code ? `Code: ${code}` : ""]
    .filter(Boolean)
    .join(" | ");
};

const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const extractOpenAiResponseText = (raw: any) => {
  if (typeof raw?.output_text === "string" && raw.output_text.trim()) return raw.output_text.trim();
  const pieces: string[] = [];
  const visit = (value: any) => {
    if (!value) return;
    if (typeof value === "string") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.text === "string") pieces.push(value.text);
      if (typeof value.content === "string") pieces.push(value.content);
      if (value.text && typeof value.text.value === "string") pieces.push(value.text.value);
      if (value.content) visit(value.content);
    }
  };
  visit(raw?.output);
  return pieces.map((piece) => piece.trim()).filter(Boolean).join("\n").trim();
};

const extractChatCompletionText = (raw: any) => {
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => safeLimitedText(part?.text ?? part?.content, 4000))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
};

const callGemini = async (model: string, prompt: string, jsonMode: boolean, temperature: number) => {
  const generationConfig: Record<string, unknown> = { temperature };
  if (jsonMode) generationConfig.responseMimeType = "application/json";

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": envText("GEMINI_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  );

  const responseText = await response.text();
  const raw = parseResponseText(responseText);
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: extractProviderError(response.status, responseText), raw };
  }

  const finishReason = safeLimitedText(raw?.candidates?.[0]?.finishReason, 100);
  if (!raw?.candidates?.[0] || ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION"].includes(finishReason)) {
    return {
      ok: false as const,
      status: response.status,
      error: "Provider returned an empty or blocked response.",
      raw,
    };
  }

  return {
    ok: true as const,
    status: response.status,
    text: safeLimitedText(raw?.candidates?.[0]?.content?.parts?.[0]?.text, 50000),
    raw,
  };
};

const callOpenAiResponses = async (model: string, prompt: string, temperature: number) => {
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${envText("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: prompt, temperature }),
  });

  const responseText = await response.text();
  const raw = parseResponseText(responseText);
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: extractProviderError(response.status, responseText), raw };
  }

  return { ok: true as const, status: response.status, text: extractOpenAiResponseText(raw), raw };
};

const callExperientialChatCompletions = async (model: string, prompt: string, temperature: number) => {
  const response = await fetchWithTimeout("https://api.experientiallabs.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + envText("EXPLABS_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
    }),
  });

  const responseText = await response.text();
  const raw = parseResponseText(responseText);
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: extractProviderError(response.status, responseText), raw };
  }

  return { ok: true as const, status: response.status, text: extractChatCompletionText(raw), raw };
};

const callChatCompletions = async (
  provider: Exclude<AiProviderName, "gemini" | "openai">,
  model: string,
  prompt: string,
  temperature: number
) => {
  const config = {
    groq: {
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: envText("GROQ_API_KEY"),
    },
    xai: {
      url: "https://api.x.ai/v1/chat/completions",
      key: envText("XAI_API_KEY"),
    },
    zai: {
      url: `${envText("ZAI_BASE_URL").replace(/\/+$/, "")}/chat/completions`,
      key: envText("ZAI_API_KEY"),
    },
  }[provider];

  const response = await fetchWithTimeout(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
    }),
  });

  const responseText = await response.text();
  const raw = parseResponseText(responseText);
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: extractProviderError(response.status, responseText), raw };
  }

  return { ok: true as const, status: response.status, text: extractChatCompletionText(raw), raw };
};

const callProvider = async (
  provider: AiProviderName,
  model: string,
  prompt: string,
  jsonMode: boolean,
  temperature: number
) => {
  if (provider === "gemini") return callGemini(model, prompt, jsonMode, temperature);
  if (provider === "openai") return callExperientialChatCompletions(model, prompt, temperature);
  return callChatCompletions(provider, model, prompt, temperature);
};

export async function callAiProviderRouter({
  task,
  prompt,
  jsonMode = false,
  temperature = 0.2,
  expectedJsonShapeDescription,
}: RouterInput): Promise<RouterResult> {
  const attempts: ProviderAttempt[] = [];
  const cleanPrompt = [
    `Task: ${task}`,
    expectedJsonShapeDescription ? `Expected JSON shape:\n${expectedJsonShapeDescription}` : "",
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  for (const provider of providerOrder()) {
    const models = getModelsForProvider(provider);
    for (const model of models) {
      const tries = maxRetries() + 1;
      for (let tryIndex = 0; tryIndex < tries; tryIndex += 1) {
        try {
          const result = await callProvider(provider, model, cleanPrompt, jsonMode, temperature);
          if (!result.ok) {
            attempts.push({ provider, model, ok: false, status: result.status, error: result.error });
            if (!fallbackStatuses.has(result.status ?? 0)) break;
            continue;
          }

          const text = safeLimitedText(result.text, 50000);
          if (!text) {
            attempts.push({ provider, model, ok: false, status: result.status, error: "Provider returned empty text." });
            continue;
          }

          if (jsonMode) {
            try {
              const parsedJson = parseJsonFromText(text);
              attempts.push({ provider, model, ok: true, status: result.status });
              return { ok: true, provider, model, text, json: parsedJson, raw: result.raw, attempts };
            } catch (error) {
              attempts.push({
                provider,
                model,
                ok: false,
                status: result.status,
                error: error instanceof Error ? error.message : "AI response could not be parsed as JSON.",
              });
              continue;
            }
          }

          attempts.push({ provider, model, ok: true, status: result.status });
          return { ok: true, provider, model, text, raw: result.raw, attempts };
        } catch (error) {
          const message = error instanceof Error
            ? error.name === "AbortError"
              ? "Provider request timed out."
              : error.message
            : "Provider request failed.";
          attempts.push({ provider, model, ok: false, error: safeLimitedText(message, 700) });
          continue;
        }
      }
    }
  }

  const configuredProviders = providerOrder().join(", ") || "none";
  return {
    ok: false,
    attempts,
    error: attempts.length
      ? "AI providers are temporarily unavailable. Please try again."
      : `No configured AI providers were available from provider order: ${configuredProviders}.`,
  };
}
