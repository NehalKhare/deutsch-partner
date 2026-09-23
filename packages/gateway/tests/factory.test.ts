import { describe, expect, it, vi } from "vitest";

import { createGateway } from "../src/factory";
import { parseEnv } from "@dp/env/schema";
import type { DatabaseClient } from "@dp/db/types";

const client = {
  from: vi.fn(),
  rpc: vi.fn(),
} as unknown as DatabaseClient;

const env = (over: Record<string, string | undefined> = {}) =>
  parseEnv({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "openrouter-key-value-long-enough",
    ...over,
  });

describe("gateway composition", () => {
  it("assembles a gateway with every dependency in place", () => {
    const gateway = createGateway(client, env());

    expect(typeof gateway.complete).toBe("function");
    expect(typeof gateway.stream).toBe("function");
  });

  it("refuses to assemble without a provider key", () => {
    // A gateway with no key would fail on the first learner turn instead of at
    // the point where the misconfiguration is obvious.
    expect(() => createGateway(client, env({ OPENROUTER_API_KEY: undefined }))).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it("touches no database until a call is made", () => {
    createGateway(client, env());

    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
});
