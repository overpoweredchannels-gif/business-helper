import fs from "node:fs";
import path from "node:path";
import { callAiProviderRouter } from "../src/lib/ai/provider-router";

// Load .env.local manually if present
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const envConfig = fs.readFileSync(envLocalPath, "utf-8");
  for (const line of envConfig.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    }
  }
}

async function main() {
  process.env.AI_PROVIDER_ORDER = "openai";
  process.env.OPENAI_PRIMARY_MODEL = "gpt-5.6-luna";

  console.log("Making live test call to Experiential gateway with model gpt-5.6-luna...");
  const result = await callAiProviderRouter({
    task: "gateway live check",
    prompt: "Hello! Please confirm you are online and working via Experiential gateway in one short sentence.",
  });

  if (!result.ok) {
    console.error("Test call failed:", result.error, result.attempts);
    process.exitCode = 1;
    return;
  }

  console.log("--- TEST CALL RESULT ---");
  console.log("Provider:", result.provider);
  console.log("Model:", result.model);
  console.log("Reply:", result.text);
  console.log("Token Usage:", JSON.stringify(result.raw?.usage || {}, null, 2));
}

main().catch(console.error);
