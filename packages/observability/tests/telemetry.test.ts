import { describe, expect, it } from "vitest";

import { createTelemetry, nullTelemetry, parseOtlpHeaders } from "../src/telemetry";

describe("telemetry without an endpoint", () => {
  const telemetry = createTelemetry({ serviceName: "worker" });

  it("is disabled, with no log bridge", () => {
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.logEmitter).toBeUndefined();
  });

  it("hands out spans that record nothing", () => {
    const span = telemetry.tracer.startSpan("job.process");

    expect(span.isRecording()).toBe(false);
    span.end();
  });

  it("hands out instruments that can be called safely", () => {
    // The no-op meter's counter swallows the call; what matters is that the
    // worker's hot path never has to check whether telemetry is on.
    const counter = telemetry.meter.createCounter("worker.jobs.processed");

    expect(() => counter.add(1, { kind: "fx.refresh" })).not.toThrow();
  });

  it("shuts down immediately", async () => {
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("is what nullTelemetry is", () => {
    expect(nullTelemetry.enabled).toBe(false);
  });
});

describe("telemetry with an endpoint", () => {
  it("builds real providers and a log bridge", () => {
    const telemetry = createTelemetry({
      serviceName: "worker",
      endpoint: "http://localhost:4318",
      headers: "Authorization=Basic dXNlcjpwYXNz",
      environment: "test",
    });

    expect(telemetry.enabled).toBe(true);
    expect(telemetry.logEmitter).toBeDefined();
    expect(telemetry.tracer.startSpan("job.process").isRecording()).toBe(true);
  });

  it("shuts down within a bounded time even when nothing answers", async () => {
    const telemetry = createTelemetry({
      serviceName: "worker",
      endpoint: "http://localhost:1", // nothing listens here
    });

    const before = Date.now();
    await telemetry.shutdown();

    expect(Date.now() - before).toBeLessThan(6_000);
  });

  it("accepts a log line without throwing", () => {
    const telemetry = createTelemetry({
      serviceName: "worker",
      endpoint: "http://localhost:4318",
    });

    expect(() =>
      telemetry.logEmitter?.("info", "worker.job_done", { kind: "fx.refresh", durationMs: 12 }),
    ).not.toThrow();
  });
});

describe("parseOtlpHeaders", () => {
  it("splits comma-separated pairs on the first equals sign", () => {
    expect(parseOtlpHeaders("Authorization=Basic abc==,X-Scope-OrgID=7")).toEqual({
      Authorization: "Basic abc==",
      "X-Scope-OrgID": "7",
    });
  });

  it("decodes a percent-encoded value, as the OTLP env convention allows", () => {
    expect(parseOtlpHeaders("Authorization=Basic%20abc")).toEqual({
      Authorization: "Basic abc",
    });
  });

  it("keeps a literal percent sign that is not an encoding", () => {
    expect(parseOtlpHeaders("X-Note=100%")).toEqual({ "X-Note": "100%" });
  });

  it("ignores malformed pairs and empty input", () => {
    expect(parseOtlpHeaders("")).toEqual({});
    expect(parseOtlpHeaders(undefined)).toEqual({});
    expect(parseOtlpHeaders("novalue,=orphan")).toEqual({});
  });
});
