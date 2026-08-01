import { runSuite, generateReport, printReport, ValidationReport } from "./helpers";
import { validateBootstrap } from "./validate-bootstrap";
import { validateSkills } from "./validate-skills";
import { validateContext } from "./validate-context";
import { validateEntityResolution } from "./validate-entity-resolution";

export type { ValidationReport } from "./helpers";
export { printReport } from "./helpers";

export async function runAllValidations(): Promise<ValidationReport> {
  const suites = await Promise.all([
    validateBootstrap(),
    validateSkills(),
    validateContext(),
    validateEntityResolution(),
  ]);

  return generateReport(suites);
}

export async function runValidation(names: string[]): Promise<ValidationReport> {
  const suiteMap: Record<string, () => ReturnType<typeof runSuite>> = {
    bootstrap: validateBootstrap,
    skills: validateSkills,
    context: validateContext,
    entity: validateEntityResolution,
  };

  const selected = names
    .filter((n) => suiteMap[n])
    .map((n) => suiteMap[n]());

  const suites = await Promise.all(selected);
  return generateReport(suites);
}

export function formatAsMarkdown(report: ValidationReport): string {
  const lines: string[] = [
    `# Business Brain Validation Report`,
    ``,
    `**Timestamp:** ${report.timestamp}`,
    `**Environment:** ${report.environment}`,
    `**Verdict:** ${report.verdict}`,
    `**Results:** ${report.totalPassed}/${report.totalTests} passed (${report.totalFailed} failed)`,
    `**Duration:** ${report.totalDurationMs}ms`,
    ``,
    `---`,
    ``,
  ];

  for (const suite of report.suites) {
    const badge = suite.failed === 0 ? "✅" : "❌";
    lines.push(`## ${badge} ${suite.name}`);
    lines.push(`**${suite.passed}/${suite.total} passed** — ${suite.durationMs}ms`);
    lines.push(``);
    lines.push(`| Test | Status | Duration |`);
    lines.push(`|------|--------|----------|`);
    for (const t of suite.tests) {
      const icon = t.passed ? "✅" : "❌";
      lines.push(`| ${t.name} | ${icon} ${t.passed ? "PASS" : "FAIL"} | ${t.durationMs}ms |`);
      if (!t.passed) {
        lines.push(`| | **Error:** ${t.message} | |`);
      }
    }
    lines.push(``);
  }

  if (report.totalFailed > 0) {
    lines.push(`## ❌ Failed Tests`);
    lines.push(``);
    for (const suite of report.suites) {
      for (const t of suite.tests) {
        if (!t.passed) {
          lines.push(`- **${suite.name} > ${t.name}**: ${t.message}`);
        }
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Report generated at ${report.timestamp}*`);
  return lines.join("\n");
}
