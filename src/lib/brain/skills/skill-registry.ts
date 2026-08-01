import { SkillResult, SkillContext } from "../contracts/skills";
import { MemoryStore } from "../memory/business-memory";
import { PreferenceStore } from "../learning/preference-store";
import * as healthScore from "./health-score";
import * as analytics from "./analytics";
import * as kpi from "./kpi";
import * as forecast from "./forecast";
import * as reorderAdvice from "./reorder-advice";
import * as recommendationEngine from "./recommendation-engine";

export type SkillExecutor = (input: Record<string, unknown>, context: SkillContext) => SkillResult<unknown>;

interface SkillEntry {
  id: string;
  name: string;
  version: string;
  execute: SkillExecutor;
}

const registry = new Map<string, SkillEntry>();

function register(entry: SkillEntry): void {
  registry.set(entry.id, entry);
}

register({ id: "health_score", name: "Health Score", version: "1.0", execute: healthScore.execute as SkillExecutor });
register({ id: "analytics", name: "Sales Analytics", version: "1.0", execute: analytics.execute as SkillExecutor });
register({ id: "kpi", name: "KPI Calculator", version: "1.0", execute: kpi.execute as SkillExecutor });
register({ id: "forecast", name: "Forecast Engine", version: "1.0", execute: forecast.execute as SkillExecutor });
register({ id: "reorder_advice", name: "Reorder Advice", version: "1.0", execute: reorderAdvice.execute as SkillExecutor });
register({ id: "recommendation_engine", name: "Recommendation Engine", version: "1.0", execute: recommendationEngine.execute as SkillExecutor });

export const SKILL_IDS = Array.from(registry.keys());
export const SKILL_NAMES = Array.from(registry.values()).map((s) => s.name);

export function getSkill(id: string): SkillEntry | undefined {
  return registry.get(id);
}

export function executeSkill(id: string, input: Record<string, unknown>, memory: MemoryStore, preferences: PreferenceStore): SkillResult<unknown> {
  const skill = registry.get(id);
  if (!skill) {
    return {
      skillId: id, version: "0", success: false,
      data: null, error: { code: "SKILL_NOT_FOUND", message: `Skill "${id}" not found`, detail: `Available: ${SKILL_IDS.join(", ")}`, recoverable: false },
      warnings: [{ code: "SKILL_NOT_FOUND", message: `Skill "${id}" not registered`, severity: "warning", affectedData: "" }],
      metrics: { executionTimeMs: 0, inputSize: 0, outputSize: 0 },
    };
  }
  const context: SkillContext = {
    memory,
    preferences,
    requestId: `auto_${Date.now()}`,
    invokedAt: new Date().toISOString(),
  };
  return skill.execute(input, context);
}

export function listSkills(): Array<{ id: string; name: string; version: string }> {
  return Array.from(registry.values()).map(({ id, name, version }) => ({ id, name, version }));
}
