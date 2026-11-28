import type { SkillResult, SkillContext, HealthScoreOutput } from "../contracts/skills";

const VERSION = "1.0";
const SKILL_ID = "health_score";

export function execute(_input: Record<string, unknown>, context: SkillContext): SkillResult<HealthScoreOutput> {
  const startTime = performance.now();
  const health = context.memory.analytics.healthScore;
  return {
    skillId: SKILL_ID, version: VERSION, success: true,
    data: health, error: null, warnings: [],
    metrics: { executionTimeMs: performance.now() - startTime, inputSize: 0, outputSize: 1 },
  };
}
