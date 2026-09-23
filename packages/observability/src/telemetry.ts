import { metrics, trace, type Meter, type Tracer } from "@opentelemetry/api";
import { SeverityNumber, type AnyValueMap, type Logger as OtelLogger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import type { LogLevel } from "./logger";

/**
 * OpenTelemetry, assembled by hand: a tracer, a meter and a log emitter over
 * OTLP, or their no-op twins when no endpoint is configured.
 *
 * Assembled rather than taken from @opentelemetry/sdk-node because sdk-node
 * exists to orchestrate auto-instrumentation, and there is none here: every
 * span and every metric in this codebase is deliberate, named after the job
 * or the queue it describes, and carries error codes rather than error
 * messages — the same closed-set rule the logger enforces (guardrails S17).
 *
 * Nothing registers globally. The providers live in the returned object, so a
 * test hands in nothing and gets silence, and two of these in one process
 * cannot fight over a global.
 */

export interface TelemetryOptions {
  readonly serviceName: string;
  /** The OTLP gateway base URL. Absent means telemetry is off. */
  readonly endpoint?: string;
  /** `Key=Value,Key=Value`, as the OTLP env convention spells headers. */
  readonly headers?: string;
  readonly environment?: string;
  /** How often metrics leave the process. */
  readonly exportIntervalMs?: number;
}

export type TelemetryLogEmitter = (
  level: LogLevel,
  event: string,
  fields: Record<string, unknown>,
) => void;

export interface Telemetry {
  readonly enabled: boolean;
  readonly tracer: Tracer;
  readonly meter: Meter;
  /** Absent when telemetry is off, so the logger skips the bridge entirely. */
  readonly logEmitter?: TelemetryLogEmitter;
  /** Flushes and stops the exporters. Resolves within a bounded time. */
  shutdown(): Promise<void>;
}

const SEVERITY: Readonly<Record<LogLevel, SeverityNumber>> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/** `Key=Value,Key=Value` into a record, decoding percent-encoded values. */
export function parseOtlpHeaders(headers: string | undefined): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const pair of (headers ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const key = pair.slice(0, at).trim();
    let value = pair.slice(at + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // A literal percent sign is not an encoding.
    }
    if (key) parsed[key] = value;
  }
  return parsed;
}

const SHUTDOWN_TIMEOUT_MS = 5_000;

function bounded(work: Promise<unknown>): Promise<void> {
  return new Promise((resolveShutdown) => {
    const timer = setTimeout(resolveShutdown, SHUTDOWN_TIMEOUT_MS);
    void work.finally(() => {
      clearTimeout(timer);
      resolveShutdown();
    });
  });
}

function logBridge(otelLogger: OtelLogger): TelemetryLogEmitter {
  return (level, event, fields) => {
    otelLogger.emit({
      severityNumber: SEVERITY[level],
      severityText: level,
      body: event,
      attributes: fields as AnyValueMap,
    });
  };
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  if (!options.endpoint) {
    // No global provider is ever registered, so these are the API's no-op
    // implementations: spans that record nothing, counters that count nothing.
    return {
      enabled: false,
      tracer: trace.getTracer(options.serviceName),
      meter: metrics.getMeter(options.serviceName),
      shutdown: () => Promise.resolve(),
    };
  }

  const base = options.endpoint.replace(/\/$/, "");
  const headers = parseOtlpHeaders(options.headers);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    ...(options.environment ? { "deployment.environment.name": options.environment } : {}),
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces`, headers })),
    ],
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics`, headers }),
        exportIntervalMillis: options.exportIntervalMs ?? 60_000,
      }),
    ],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${base}/v1/logs`, headers }),
      }),
    ],
  });

  return {
    enabled: true,
    tracer: tracerProvider.getTracer(options.serviceName),
    meter: meterProvider.getMeter(options.serviceName),
    logEmitter: logBridge(loggerProvider.getLogger(options.serviceName)),
    shutdown: () =>
      bounded(
        Promise.allSettled([
          tracerProvider.shutdown(),
          meterProvider.shutdown(),
          loggerProvider.shutdown(),
        ]),
      ),
  };
}

/** For code paths that take telemetry but are not being observed. */
export const nullTelemetry: Telemetry = createTelemetry({ serviceName: "null" });

/** Narrow view for callers that only ever read, never shut down. */
export type TelemetryHandle = Pick<Telemetry, "tracer" | "meter">;
