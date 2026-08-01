export type TestResult = {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
};

export type TestSuite = {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  total: number;
  durationMs: number;
};

export type ValidationReport = {
  timestamp: string;
  environment: string;
  suites: TestSuite[];
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  verdict: "PASS" | "FAIL";
};

export function runSuite(name: string, testFns: Array<() => Promise<TestResult> | TestResult>): Promise<TestSuite> {
  return (async () => {
    const start = performance.now();
    const results: TestResult[] = [];
    for (const fn of testFns) {
      try {
        const result = await fn();
        results.push(result);
      } catch (err) {
        results.push({
          name: fn.name || "unnamed",
          passed: false,
          message: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        });
      }
    }
    const dur = performance.now() - start;
    return {
      name,
      tests: results,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      total: results.length,
      durationMs: Math.round(dur),
    };
  })();
}

export function test(name: string, fn: () => void | Promise<void>): () => Promise<TestResult> {
  return async () => {
    const start = performance.now();
    try {
      await fn();
      return { name, passed: true, message: "OK", durationMs: Math.round(performance.now() - start) };
    } catch (err) {
      return { name, passed: false, message: err instanceof Error ? err.message : String(err), durationMs: Math.round(performance.now() - start) };
    }
  };
}

export function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

export function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Error(`ASSERTION FAILED: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertApprox(actual: number, expected: number, tolerance: number, msg: string): void {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`ASSERTION FAILED: ${msg} — expected ~${expected}, got ${actual} (tolerance ${tolerance})`);
}

export function generateReport(suites: TestSuite[]): ValidationReport {
  const total = suites.reduce((s, suite) => s + suite.total, 0);
  const passed = suites.reduce((s, suite) => s + suite.passed, 0);
  const failed = suites.reduce((s, suite) => s + suite.failed, 0);
  const duration = suites.reduce((s, suite) => s + suite.durationMs, 0);
  return {
    timestamp: new Date().toISOString(),
    environment: typeof window !== "undefined" ? "browser" : "node",
    suites,
    totalTests: total,
    totalPassed: passed,
    totalFailed: failed,
    totalDurationMs: duration,
    verdict: failed === 0 ? "PASS" : "FAIL",
  };
}

export function printReport(report: ValidationReport): string {
  const lines: string[] = [
    "=".repeat(70),
    "BUSINESS BRAIN VALIDATION REPORT",
    "=".repeat(70),
    `Timestamp: ${report.timestamp}`,
    `Environment: ${report.environment}`,
    `Verdict: ${report.verdict}`,
    `Total: ${report.totalTests} | Passed: ${report.totalPassed} | Failed: ${report.totalFailed} | Duration: ${report.totalDurationMs}ms`,
    "",
  ];
  for (const suite of report.suites) {
    lines.push(`─ ${suite.name} (${suite.passed}/${suite.total} passed, ${suite.durationMs}ms)`);
    for (const t of suite.tests) {
      const icon = t.passed ? "✓" : "✗";
      lines.push(`  ${icon} ${t.name} (${t.durationMs}ms)`);
      if (!t.passed) lines.push(`    → ${t.message}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
