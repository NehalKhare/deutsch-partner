import { z } from "zod";

/**
 * Environment validation.
 *
 * Two rules shape this module:
 *
 * 1. Production must fail loudly when a secret is absent. A half-configured
 *    deployment that boots is worse than one that refuses to.
 * 2. Development and test must boot without production secrets, so that a
 *    contributor can run the app and the suite without provisioning anything.
 *
 * A malformed value is rejected in every mode, because wrong is not the same
 * as absent.
 */

const MIN_SECRET_LENGTH = 10;

const secret = () => z.string().min(MIN_SECRET_LENGTH).optional();

/**
 * Supabase API key formats.
 *
 * The legacy JWT `anon` and `service_role` keys are deprecated and are being
 * retired at the end of 2026, superseded by `sb_publishable_` and `sb_secret_`
 * keys. Validating the prefix costs nothing and converts two expensive
 * mistakes into a boot failure: pasting a secret key into a browser-exposed
 * variable, and starting a new project on a key format that is already going
 * away.
 */
export const SUPABASE_PUBLISHABLE_PREFIX = "sb_publishable_";
export const SUPABASE_SECRET_PREFIX = "sb_secret_";
const LEGACY_JWT_PREFIX = "eyJ";

export function supabaseKeySchema(prefix: string, label: string) {
  return z
    .string()
    .min(MIN_SECRET_LENGTH)
    .refine((value) => !value.startsWith(LEGACY_JWT_PREFIX), {
      error:
        `looks like a legacy JWT key. Supabase retires those at the end of ` +
        `2026; use a ${label} key instead`,
    })
    .refine((value) => value.startsWith(prefix), {
      error: `must be a ${label} key beginning with "${prefix}"`,
    });
}

/**
 * A provider-qualified model id, as OpenRouter states them: `vendor/model`.
 * Validated so a typo becomes a boot failure rather than a 404 on the first
 * learner turn.
 */
const MODEL_ID_PATTERN = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

const modelId = () =>
  z
    .string()
    .min(3)
    .max(160)
    .regex(MODEL_ID_PATTERN, {
      error: 'must be a provider-qualified model id, such as "vendor/model"',
    })
    .optional();

const booleanish = z
  .enum(["true", "1", "false", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Public: inlined into the browser bundle. Never put a secret here.
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKeySchema(
    SUPABASE_PUBLISHABLE_PREFIX,
    "publishable",
  ).optional(),

  // Server-only secrets.
  SUPABASE_SECRET_KEY: supabaseKeySchema(
    SUPABASE_SECRET_PREFIX,
    "secret",
  ).optional(),
  /**
   * Every model call this product makes: chat, completion, embeddings, and
   * speech in both directions. One account to fund and one key to rotate.
   */
  OPENROUTER_API_KEY: secret(),

  /**
   * Per-tier model ids, overriding the registry's defaults for this
   * environment. Absent means "use the registry". Model ids are configuration
   * because availability and pricing move; a tier is what application code
   * names, and a tier is all it names.
   */
  OPENROUTER_MODEL_REASONING: modelId(),
  OPENROUTER_MODEL_STRONG: modelId(),
  OPENROUTER_MODEL_MID: modelId(),
  OPENROUTER_MODEL_CHEAP: modelId(),
  OPENROUTER_MODEL_NANO: modelId(),
  EMBEDDING_MODEL: modelId(),
  SPEECH_TO_TEXT_MODEL: modelId(),
  TEXT_TO_SPEECH_MODEL: modelId(),

  /**
   * Salt for the pseudonymous user id in logs and the usage ledger. Optional
   * at boot and asserted at the point of use, like the Supabase secret key:
   * a deployment that never writes a ledger row does not need one.
   */
  LOG_PSEUDONYM_SALT: secret(),

  /**
   * Comma-separated learner ids allowed to see the cost dashboard. Unset
   * means nobody, which is the safe reading of an absent allowlist.
   */
  OPERATOR_USER_IDS: z.string().max(2000).optional(),

  /**
   * A euro-per-dollar rate to use until the first FX snapshot lands. Never a
   * substitute for the daily snapshot; it exists so a cold database prices
   * its first calls instead of recording them as unpriced.
   */
  FX_EUR_PER_USD_BOOTSTRAP: z.coerce.number().positive().max(100).optional(),

  APP_URL: z.url().default("http://localhost:3000"),
  APP_NAME: z.string().min(1).default("Deutsch Partner"),

  /**
   * Whether search engines and answer engines may index this deployment.
   *
   * Off unless stated: staging deploys on every green `main` to an origin
   * anybody can reach, and a staging copy that gets indexed competes with
   * production for its own name. Production sets it to true explicitly.
   * The learner app reads it for robots.txt and the robots meta tag; the
   * operator app is never indexable whatever this says.
   */
  SEO_INDEXING: booleanish,

  /**
   * Site-ownership tokens for the search consoles. Public by design — they
   * are printed into the page head — so they are not secrets, and absent
   * means the tag is simply not rendered.
   */
  GOOGLE_SITE_VERIFICATION: z.string().min(1).max(200).optional(),
  BING_SITE_VERIFICATION: z.string().min(1).max(200).optional(),

  LANGSMITH_TRACING: booleanish,
  LANGSMITH_API_KEY: secret(),
  LANGSMITH_PROJECT: z.string().min(1).default("deutsch-partner"),
  LANGSMITH_ENDPOINT: z.url().optional(),

  /**
   * OpenTelemetry over OTLP: traces, metrics and logs to whatever gateway the
   * endpoint names (Grafana Cloud's, in this deployment). Absent means
   * telemetry is off — the deployable runs identically, exporting nothing.
   * The headers carry the gateway's basic-auth credential, so they are a
   * server secret like any API key.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: secret(),
  OTEL_SERVICE_NAME: z.string().min(1).max(120).optional(),

  /**
   * A remote MCP server the Trainer's agent may borrow tools from, over
   * streamable HTTP. Unset means the Trainer runs on its local tools alone —
   * a thinner trainer, never a boot failure. The key is optional because the
   * recommended default (DeepWiki) needs none; a server that wants one gets
   * it as a bearer header, never in the URL where it would reach logs.
   */
  MCP_SERVER_URL: z.url().optional(),
  MCP_SERVER_API_KEY: secret(),

  /**
   * The repository the product-ops worker opens pull requests against, and
   * the token it uses.
   *
   * The token is fine-grained, scoped to that one repository, with contents
   * and pull-request write and nothing else. Both are optional at boot and
   * asserted where they are used: the worker is a CLI script, and a deployment
   * that never runs it does not need either. A token with no repository named
   * is a configuration mistake rather than a spare part, and is refused below.
   */
  GITHUB_TOKEN: secret(),
  GITHUB_REPOSITORY: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, {
      error: 'must be a repository as "owner/name"',
    })
    .optional(),
});

/** Keys the browser bundle is allowed to see. */
export const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

/** Secrets that must never leave the server. */
export const SERVER_ENV_KEYS = [
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "LANGSMITH_API_KEY",
  "LOG_PSEUDONYM_SALT",
  "MCP_SERVER_API_KEY",
  "GITHUB_TOKEN",
  "OTEL_EXPORTER_OTLP_HEADERS",
] as const;

type EnvKey = keyof z.infer<typeof baseSchema>;

/**
 * Required in production by the learner app: the deployable that serves a
 * browser and calls a model. Optional elsewhere so the app can still boot.
 * The other deployables pass their own list; a worker serves no browser and
 * the operator app calls no model.
 */
export const PRODUCTION_REQUIRED_KEYS: readonly EnvKey[] = [
  ...PUBLIC_ENV_KEYS,
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "LOG_PSEUDONYM_SALT",
];

export interface ParseEnvOptions {
  /** Which keys production refuses to boot without. */
  readonly productionRequired?: readonly EnvKey[];
}

const envSchemaFor = (required: readonly EnvKey[]) => baseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production") {
    for (const key of required) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "is required in production",
        });
      }
    }
  }

  if (env.LANGSMITH_TRACING && env.LANGSMITH_API_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["LANGSMITH_API_KEY"],
      message: "is required when LANGSMITH_TRACING is enabled",
    });
  }

  // A credential with no gateway to send it to is a configuration mistake:
  // whoever set the headers expected telemetry to flow.
  if (env.OTEL_EXPORTER_OTLP_HEADERS !== undefined && env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      message: "is required when OTEL_EXPORTER_OTLP_HEADERS is set",
    });
  }

  // A key with no server to send it to is a configuration mistake, not a
  // spare part: whoever set it expected authenticated MCP calls to happen.
  if (env.MCP_SERVER_API_KEY !== undefined && env.MCP_SERVER_URL === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["MCP_SERVER_URL"],
      message: "is required when MCP_SERVER_API_KEY is set",
    });
  }

  // The same reasoning, and rather more pointedly: a write-scoped token with
  // no repository named is a token nobody has decided the blast radius of.
  if (env.GITHUB_TOKEN !== undefined && env.GITHUB_REPOSITORY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["GITHUB_REPOSITORY"],
      message: "is required when GITHUB_TOKEN is set",
    });
  }
});

export type AppEnv = z.infer<typeof baseSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue}`)
        .join("\n")}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Formats an issue without ever echoing the offending value. Validation errors
 * surface in logs and CI output, so a message that quotes a rejected API key
 * leaks it (see security-observability-guardrails.md S17).
 */
export function describeIssue(issue: z.core.$ZodIssue): string {
  const key = issue.path.join(".") || "(root)";
  let message = issue.message;

  const received = "input" in issue ? issue.input : undefined;
  if (typeof received === "string" && received.length > 0) {
    message = message.split(received).join("[redacted]");
  }

  return `${key}: ${message}`;
}

/**
 * Validates a raw environment source. Unknown keys are ignored, since a real
 * `process.env` carries hundreds of unrelated entries.
 */
export function parseEnv(
  source: Record<string, string | undefined>,
  options: ParseEnvOptions = {},
): AppEnv {
  // A blank value in a .env file is "not set", not zero-length content:
  // every loader hands `KEY=` through as "", and validating that as a
  // secret would turn a placeholder line into a boot failure.
  const populated = Object.fromEntries(
    Object.entries(source).filter(
      ([, value]) => value !== undefined && value.trim() !== "",
    ),
  );
  const result = envSchemaFor(options.productionRequired ?? PRODUCTION_REQUIRED_KEYS).safeParse(
    populated,
  );

  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map(describeIssue));
  }

  return result.data;
}

/**
 * Asserts a value that is optional at boot but mandatory at the point of use,
 * such as the service role key inside a privileged client factory.
 */
export function requireEnvValue<T>(
  value: T | undefined | "",
  key: string,
): T {
  if (value === undefined || value === "") {
    throw new EnvValidationError([`${key}: is required for this operation`]);
  }
  return value;
}
