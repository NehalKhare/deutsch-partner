import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  PUBLIC_ENV_KEYS,
  SERVER_ENV_KEYS,
  parseEnv,
} from "../src/schema";

/**
 * A complete production environment. Individual tests delete one key at a time
 * so each assertion names exactly one missing secret.
 */
function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123def456",
    SUPABASE_SECRET_KEY: "sb_secret_abc123def456",
    OPENROUTER_API_KEY: "openrouter-key-value-long-enough",
    LOG_PSEUDONYM_SALT: "a-salt-long-enough-to-pass",
    APP_URL: "https://deutsch-partner.example",
    ...overrides,
  };
}

describe("parseEnv", () => {
  describe("production mode", () => {
    it("accepts a complete production environment", () => {
      const env = parseEnv(productionEnv());

      expect(env.NODE_ENV).toBe("production");
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://project.supabase.co");
      expect(env.SUPABASE_SECRET_KEY).toBe("sb_secret_abc123def456");
    });

    it.each([
      "SUPABASE_SECRET_KEY",
      "OPENROUTER_API_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "LOG_PSEUDONYM_SALT",
    ])("fails when the required secret %s is missing", (key) => {
      const source = productionEnv({ [key]: undefined });

      expect(() => parseEnv(source)).toThrow(EnvValidationError);
      expect(() => parseEnv(source)).toThrow(new RegExp(key));
    });

    it("lets a deployable name what it cannot run without", () => {
      // The operator app calls no model: no model key required, but the
      // allowlist is. The worker serves no browser: no publishable key.
      const ops = productionEnv({ OPENROUTER_API_KEY: undefined, OPERATOR_USER_IDS: "11111111-1111-4111-8111-111111111111" });
      expect(() =>
        parseEnv(ops, {
          productionRequired: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "LOG_PSEUDONYM_SALT", "OPERATOR_USER_IDS"],
        }),
      ).not.toThrow();
      expect(() =>
        parseEnv(productionEnv({ OPERATOR_USER_IDS: undefined }), {
          productionRequired: ["OPERATOR_USER_IDS"],
        }),
      ).toThrow(/OPERATOR_USER_IDS/);
    });

    it("reports every missing secret at once rather than one per run", () => {
      const source = productionEnv({
        SUPABASE_SECRET_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
      });

      try {
        parseEnv(source);
        expect.unreachable("expected parseEnv to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as EnvValidationError).issues).toHaveLength(2);
      }
    });
  });

  describe("development and test modes", () => {
    it.each(["development", "test"])(
      "allows missing production secrets in %s so the app can boot",
      (nodeEnv) => {
        const env = parseEnv({ NODE_ENV: nodeEnv });

        expect(env.NODE_ENV).toBe(nodeEnv);
        expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
        expect(env.OPENROUTER_API_KEY).toBeUndefined();
      },
    );

    it("still rejects a malformed value, because wrong is not the same as absent", () => {
      expect(() =>
        parseEnv({
          NODE_ENV: "development",
          NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        }),
      ).toThrow(EnvValidationError);
    });

    it("defaults NODE_ENV to development when unset", () => {
      expect(parseEnv({}).NODE_ENV).toBe("development");
    });

    it("rejects an unrecognised NODE_ENV", () => {
      expect(() => parseEnv({ NODE_ENV: "staging" })).toThrow(
        EnvValidationError,
      );
    });
  });

  describe("secret redaction", () => {
    it("never puts a rejected secret's own value in the error message", () => {
      const source = productionEnv({ OPENROUTER_API_KEY: "sk-leak" });

      try {
        parseEnv(source);
        expect.unreachable("expected parseEnv to throw");
      } catch (error) {
        const message = (error as EnvValidationError).message;
        expect(message).toContain("OPENROUTER_API_KEY");
        expect(message).not.toContain("sk-leak");
      }
    });

    it("never puts an unrelated secret's value in the error message", () => {
      const source = productionEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        SUPABASE_SECRET_KEY: "sb_secret_DO-NOT-LEAK-me",
      });

      try {
        parseEnv(source);
        expect.unreachable("expected parseEnv to throw");
      } catch (error) {
        expect((error as EnvValidationError).message).not.toContain(
          "sb_secret_DO-NOT-LEAK-me",
        );
      }
    });
  });

  describe("Supabase API key formats", () => {
    // Supabase deprecates the legacy JWT anon/service_role keys at the end of
    // 2026 in favour of sb_publishable_ / sb_secret_ keys. Validating the
    // prefix turns a class of catastrophic paste errors into a boot failure.
    const LEGACY_JWT =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature";

    it("rejects a secret key pasted into the browser-exposed slot", () => {
      const source = productionEnv({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc123def456",
      });

      expect(() => parseEnv(source)).toThrow(
        /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
      );
    });

    it("never echoes the secret it just rejected from the public slot", () => {
      const source = productionEnv({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc123def456",
      });

      try {
        parseEnv(source);
        expect.unreachable("expected parseEnv to throw");
      } catch (error) {
        expect((error as EnvValidationError).message).not.toContain(
          "sb_secret_abc123def456",
        );
      }
    });

    it("rejects a publishable key pasted into the secret slot", () => {
      expect(() =>
        parseEnv(productionEnv({ SUPABASE_SECRET_KEY: "sb_publishable_abc" })),
      ).toThrow(/SUPABASE_SECRET_KEY/);
    });

    it.each([
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      ["SUPABASE_SECRET_KEY"],
    ])("rejects a legacy JWT key in %s", (key) => {
      const source = productionEnv({ [key]: LEGACY_JWT });

      expect(() => parseEnv(source)).toThrow(new RegExp(key));
      expect(() => parseEnv(source)).toThrow(/legacy/i);
    });
  });

  describe("LangSmith tracing", () => {
    it("is disabled by default", () => {
      expect(parseEnv({}).LANGSMITH_TRACING).toBe(false);
    });

    it.each(["true", "1"])("accepts %s as enabled", (value) => {
      const env = parseEnv({
        LANGSMITH_TRACING: value,
        LANGSMITH_API_KEY: "langsmith-key-long-enough",
      });

      expect(env.LANGSMITH_TRACING).toBe(true);
    });

    it("requires an API key when tracing is enabled", () => {
      expect(() => parseEnv({ LANGSMITH_TRACING: "true" })).toThrow(
        /LANGSMITH_API_KEY/,
      );
    });

    it("does not require an API key when tracing is disabled", () => {
      expect(() => parseEnv({ LANGSMITH_TRACING: "false" })).not.toThrow();
    });

    it("defaults the project name", () => {
      expect(parseEnv({}).LANGSMITH_PROJECT).toBe("deutsch-partner");
    });
  });

  describe("the Trainer's MCP server", () => {
    it("is absent by default, which is a thinner trainer rather than an error", () => {
      const env = parseEnv({});

      expect(env.MCP_SERVER_URL).toBeUndefined();
      expect(env.MCP_SERVER_API_KEY).toBeUndefined();
    });

    it("accepts a keyless server, because the recommended default needs none", () => {
      const env = parseEnv({ MCP_SERVER_URL: "https://mcp.deepwiki.com/mcp" });

      expect(env.MCP_SERVER_URL).toBe("https://mcp.deepwiki.com/mcp");
    });

    it("accepts a server with a key", () => {
      const env = parseEnv({
        MCP_SERVER_URL: "https://mcp.example.com/mcp",
        MCP_SERVER_API_KEY: "mcp-key-long-enough",
      });

      expect(env.MCP_SERVER_API_KEY).toBe("mcp-key-long-enough");
    });

    it("rejects a key with no server to send it to", () => {
      // Whoever set the key expected authenticated MCP calls to happen.
      expect(() => parseEnv({ MCP_SERVER_API_KEY: "mcp-key-long-enough" })).toThrow(
        /MCP_SERVER_URL/,
      );
    });

    it("rejects a malformed server URL", () => {
      expect(() => parseEnv({ MCP_SERVER_URL: "not a url" })).toThrow(
        /MCP_SERVER_URL/,
      );
    });
  });

  describe("OpenTelemetry", () => {
    it("is off by default: no endpoint, no headers, no service name", () => {
      const env = parseEnv({});

      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
      expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
      expect(env.OTEL_SERVICE_NAME).toBeUndefined();
    });

    it("accepts a gateway with its credential", () => {
      const env = parseEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic dXNlcjpwYXNz",
        OTEL_SERVICE_NAME: "worker",
      });

      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp",
      );
      expect(env.OTEL_SERVICE_NAME).toBe("worker");
    });

    it("rejects a credential with no gateway to send it to", () => {
      expect(() =>
        parseEnv({ OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic dXNlcjpwYXNz" }),
      ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    });

    it("rejects a malformed endpoint", () => {
      expect(() => parseEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" })).toThrow(
        /OTEL_EXPORTER_OTLP_ENDPOINT/,
      );
    });

    it("counts the headers among the server-only secrets", () => {
      expect(SERVER_ENV_KEYS).toContain("OTEL_EXPORTER_OTLP_HEADERS");
    });
  });

  describe("blank values", () => {
    // A `KEY=` line in a .env file arrives as "", and it means "not set" —
    // a placeholder must never validate as content or fail as too short.
    it("treats an empty value as unset", () => {
      const env = parseEnv({
        MCP_SERVER_URL: "https://mcp.deepwiki.com/mcp",
        MCP_SERVER_API_KEY: "",
        OPENROUTER_API_KEY: "   ",
      });

      expect(env.MCP_SERVER_API_KEY).toBeUndefined();
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
    });
  });

  describe("defaults", () => {
    it("defaults APP_URL and APP_NAME for local development", () => {
      const env = parseEnv({});

      expect(env.APP_URL).toBe("http://localhost:3000");
      expect(env.APP_NAME).toBe("Deutsch Partner");
    });
  });

  it("ignores unrelated keys present in a real process.env", () => {
    expect(() => parseEnv({ PATH: "/usr/bin", HOME: "/root" })).not.toThrow();
  });
});

describe("environment key partitioning", () => {
  it("marks every browser-exposed key with the NEXT_PUBLIC_ prefix", () => {
    for (const key of PUBLIC_ENV_KEYS) {
      expect(key.startsWith("NEXT_PUBLIC_")).toBe(true);
    }
  });

  it("never gives a server-only key the NEXT_PUBLIC_ prefix", () => {
    for (const key of SERVER_ENV_KEYS) {
      expect(key.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("keeps the two sets disjoint", () => {
    const publicKeys = new Set<string>(PUBLIC_ENV_KEYS);
    for (const key of SERVER_ENV_KEYS) {
      expect(publicKeys.has(key)).toBe(false);
    }
  });
});
