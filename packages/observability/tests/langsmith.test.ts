import { describe, expect, it } from "vitest";
import { resolveTracingConfig } from "../src/langsmith";
import { parseEnv } from "@dp/env/schema";

describe("resolveTracingConfig", () => {
  it("is disabled when tracing is off", () => {
    const config = resolveTracingConfig(parseEnv({}));

    expect(config.enabled).toBe(false);
    expect(config.apiKey).toBeUndefined();
  });

  it("is enabled with a project and key when tracing is on", () => {
    const config = resolveTracingConfig(
      parseEnv({
        LANGSMITH_TRACING: "true",
        LANGSMITH_API_KEY: "langsmith-key-long-enough",
        LANGSMITH_PROJECT: "deutsch-partner-prod",
      }),
    );

    expect(config).toMatchObject({
      enabled: true,
      project: "deutsch-partner-prod",
      apiKey: "langsmith-key-long-enough",
    });
  });

  it("does not expose the key when tracing is disabled, even if one is set", () => {
    const config = resolveTracingConfig(
      parseEnv({
        LANGSMITH_TRACING: "false",
        LANGSMITH_API_KEY: "langsmith-key-long-enough",
      }),
    );

    expect(config.enabled).toBe(false);
    expect(config.apiKey).toBeUndefined();
  });
});
