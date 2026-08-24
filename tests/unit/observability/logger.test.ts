import { describe, expect, it } from "vitest";

import { createLogger, nullLogger, redact } from "@/lib/observability/logger";

function capture() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ sink: (line) => lines.push(line) }) };
}

const parsed = (lines: string[]) => lines.map((line) => JSON.parse(line));

describe("structured logger", () => {
  it("emits one JSON object per event", () => {
    const { lines, logger } = capture();

    logger.info("gateway.dispatch", { task: "conversation.turn", tier: "strong" });

    expect(parsed(lines)).toEqual([
      { level: "info", event: "gateway.dispatch", task: "conversation.turn", tier: "strong" },
    ]);
  });

  it("carries base fields onto every line", () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (line) => lines.push(line),
      base: { service: "gateway", environment: "test" },
    });

    logger.warn("budget.degraded", { scope: "global_daily" });

    expect(parsed(lines)[0]).toMatchObject({
      service: "gateway",
      environment: "test",
      scope: "global_daily",
    });
  });

  it("drops anything below the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), level: "warn" });

    logger.debug("noise");
    logger.info("noise");
    logger.warn("kept");
    logger.error("kept");

    expect(parsed(lines).map((line) => line.event)).toEqual(["kept", "kept"]);
  });

  it("never lets a sink failure take down the caller", () => {
    const logger = createLogger({
      sink: () => {
        throw new Error("stdout closed");
      },
    });

    expect(() => logger.info("gateway.dispatch")).not.toThrow();
  });

  it("does nothing at all when logging is off", () => {
    expect(() => nullLogger.error("gateway.failed", { detail: "x" })).not.toThrow();
  });
});

describe("redaction", () => {
  it.each([
    "apiKey",
    "api_key",
    "OPENROUTER_API_KEY",
    "authorization",
    "accessToken",
    "refresh_token",
    "password",
    "cookie",
    "secret",
  ])("redacts %s", (key) => {
    expect(redact({ [key]: "sb_secret_do-not-print" })[key]).toBe("[redacted]");
  });

  it.each(["content", "userMessage", "transcript", "utterance", "email", "prompt"])(
    "redacts %s, because observability is not a reason to store what a learner said",
    (key) => {
      expect(redact({ [key]: "Ich hätte gern einen Kaffee." })[key]).toBe("[redacted]");
    },
  );

  it("keeps the identifiers the guardrails prefer", () => {
    const fields = {
      requestId: "req-1",
      traceId: "trace-1",
      spanId: "span-1",
      threadId: "thread-1",
      messageId: "message-1",
      userIdHash: "9f86d081",
      promptName: "conversation.turn",
    };

    expect(redact(fields)).toEqual(fields);
  });

  it("redacts through the logger, not only when called directly", () => {
    const { lines, logger } = capture();

    logger.error("provider.failed", { apiKey: "sk-live-1234", task: "conversation.turn" });

    expect(lines[0]).not.toContain("sk-live-1234");
    expect(parsed(lines)[0]).toMatchObject({ apiKey: "[redacted]" });
  });

  it("truncates a long free-text field rather than dumping it", () => {
    const { lines, logger } = capture();

    logger.error("provider.failed", { detail: "x".repeat(5000) });

    expect(lines[0].length).toBeLessThan(1200);
    expect(parsed(lines)[0].detail).toMatch(/…$/);
  });

  it("survives a value that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { lines, logger } = capture();

    expect(() => logger.info("gateway.dispatch", { circular })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
