import { TypedEventEmitter } from "./event-emitter";
import { TelemetryRuntimeEventNames } from "./events";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  fields?: Record<string, unknown>;
}

export interface MetricSnapshot {
  name: string;
  kind: "counter" | "gauge" | "histogram";
  value: number;
  count: number;
  min: number;
  max: number;
  lastUpdated: string;
}

export interface SpanRecord {
  spanId: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  fields: Record<string, unknown>;
}

export interface TelemetrySnapshot {
  logs: LogEntry[];
  metrics: Record<string, MetricSnapshot>;
  spans: SpanRecord[];
  providerMetrics: Record<string, Record<string, number>>;
  sessionMetrics: Record<string, Record<string, number>>;
  latency: Record<string, { samples: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }>;
  startedAt: string;
}

const MAX_LOGS = 500;
const MAX_SPANS = 300;

class TelemetryManager {
  private emitter = new TypedEventEmitter();
  private logs: LogEntry[] = [];
  private metrics = new Map<string, MetricSnapshot>();
  private spans: SpanRecord[] = [];
  private providerMetrics = new Map<string, Record<string, number>>();
  private sessionMetrics = new Map<string, Record<string, number>>();
  private latency = new Map<string, { samples: number; totalMs: number; minMs: number; maxMs: number }>();
  private startedAt = new Date().toISOString();
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getEmitter(): TypedEventEmitter {
    return this.emitter;
  }

  log(level: LogLevel, source: string, message: string, fields?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const entry: LogEntry = { timestamp: new Date().toISOString(), level, source, message, fields };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
    }
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.LOG, {
      level,
      source,
      message,
    });
  }

  debug(source: string, message: string, fields?: Record<string, unknown>): void {
    this.log("debug", source, message, fields);
  }

  info(source: string, message: string, fields?: Record<string, unknown>): void {
    this.log("info", source, message, fields);
  }

  warn(source: string, message: string, fields?: Record<string, unknown>): void {
    this.log("warn", source, message, fields);
  }

  error(source: string, message: string, fields?: Record<string, unknown>): void {
    this.log("error", source, message, fields);
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────────

  increment(name: string, by = 1): void {
    const current = this.metrics.get(name);
    let value = by;
    if (!current) {
      value = by;
      this.metrics.set(name, {
        name,
        kind: "counter",
        value: by,
        count: 1,
        min: by,
        max: by,
        lastUpdated: new Date().toISOString(),
      });
    } else {
      current.value += by;
      current.count += 1;
      current.min = Math.min(current.min, by);
      current.max = Math.max(current.max, by);
      current.lastUpdated = new Date().toISOString();
      value = current.value;
    }
    this.emitMetric(name, value);
  }

  gauge(name: string, value: number): void {
    this.metrics.set(name, {
      name,
      kind: "gauge",
      value,
      count: 1,
      min: value,
      max: value,
      lastUpdated: new Date().toISOString(),
    });
    this.emitMetric(name, value);
  }

  histogram(name: string, value: number): void {
    const current = this.metrics.get(name);
    let tracked = value;
    if (!current) {
      this.metrics.set(name, {
        name,
        kind: "histogram",
        value,
        count: 1,
        min: value,
        max: value,
        lastUpdated: new Date().toISOString(),
      });
    } else {
      current.value = current.count === 0 ? value : (current.value * current.count + value) / (current.count + 1);
      current.count += 1;
      current.min = Math.min(current.min, value);
      current.max = Math.max(current.max, value);
      current.lastUpdated = new Date().toISOString();
      tracked = current.value;
    }
    this.emitMetric(name, tracked);
  }

  private emitMetric(name: string, value: number): void {
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.METRIC, { metric: name, value });
  }

  // ─── Tracing ──────────────────────────────────────────────────────────────────

  startSpan(name: string, fields?: Record<string, unknown>): string {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.spans.push({ spanId, name, startedAt: new Date().toISOString(), fields: fields ?? {} });
    if (this.spans.length > MAX_SPANS) {
      this.spans = this.spans.slice(this.spans.length - MAX_SPANS);
    }
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.SPAN_STARTED, { spanId, name });
    return spanId;
  }

  endSpan(spanId: string, durationMs: number): void {
    const span = this.spans.find((s) => s.spanId === spanId);
    if (span) {
      span.endedAt = new Date().toISOString();
      span.durationMs = durationMs;
    }
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.SPAN_ENDED, { spanId, name: span?.name ?? "", durationMs });
  }

  trace<T>(name: string, fn: () => Promise<T>, fields?: Record<string, unknown>): Promise<T>;
  trace<T>(name: string, fn: () => T, fields?: Record<string, unknown>): T;
  trace<T>(name: string, fn: () => Promise<T> | T, fields?: Record<string, unknown>): Promise<T> | T {
    const spanId = this.startSpan(name, fields);
    const started = Date.now();
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then((value) => {
          this.endSpan(spanId, Date.now() - started);
          return value;
        });
      }
      this.endSpan(spanId, Date.now() - started);
      return result;
    } catch (err) {
      this.endSpan(spanId, Date.now() - started);
      throw err;
    }
  }

  // ─── Provider metrics ─────────────────────────────────────────────────────────

  recordProviderMetric(providerId: string, metric: string, value: number): void {
    const map = this.providerMetrics.get(providerId) || {};
    map[metric] = (map[metric] ?? 0) + value;
    this.providerMetrics.set(providerId, map);
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.PROVIDER_METRIC, {
      providerId,
      metric,
      value,
    });
  }

  recordSessionMetric(sessionId: string, metric: string, value: number): void {
    const map = this.sessionMetrics.get(sessionId) || {};
    map[metric] = (map[metric] ?? 0) + value;
    this.sessionMetrics.set(sessionId, map);
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.SESSION_METRIC, {
      sessionId,
      metric,
      value,
    });
  }

  recordLatency(phase: string, latencyMs: number): void {
    const current = this.latency.get(phase) || { samples: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
    current.samples += 1;
    current.totalMs += latencyMs;
    current.minMs = Math.min(current.minMs, latencyMs);
    current.maxMs = Math.max(current.maxMs, latencyMs);
    this.latency.set(phase, current);
    this.emitter.emit("telemetry", TelemetryRuntimeEventNames.LATENCY_METRIC, { phase, latencyMs });
  }

  getLatencyStats(phase: string): { samples: number; avgMs: number; minMs: number; maxMs: number } {
    const current = this.latency.get(phase);
    if (!current || current.samples === 0) {
      return { samples: 0, avgMs: 0, minMs: 0, maxMs: 0 };
    }
    return {
      samples: current.samples,
      avgMs: Math.round(current.totalMs / current.samples),
      minMs: current.minMs,
      maxMs: current.maxMs,
    };
  }

  snapshot(): TelemetrySnapshot {
    return {
      logs: [...this.logs],
      metrics: Object.fromEntries(this.metrics),
      spans: [...this.spans].slice(-MAX_SPANS),
      providerMetrics: Object.fromEntries(this.providerMetrics),
      sessionMetrics: Object.fromEntries(this.sessionMetrics),
      latency: Object.fromEntries(
        Array.from(this.latency.entries()).map(([phase, v]) => [
          phase,
          { samples: v.samples, totalMs: v.totalMs, avgMs: v.samples ? Math.round(v.totalMs / v.samples) : 0, minMs: v.minMs, maxMs: v.maxMs },
        ]),
      ),
      startedAt: this.startedAt,
    };
  }

  reset(): void {
    this.logs = [];
    this.metrics.clear();
    this.spans = [];
    this.providerMetrics.clear();
    this.sessionMetrics.clear();
    this.latency.clear();
  }
}

export const telemetry = new TelemetryManager();

export const voiceEvents: TypedEventEmitter = telemetry.getEmitter();
