/**
 * Structured logging.
 *
 * One JSON object per line, an event name rather than a sentence, and a
 * redaction pass that runs on the way out rather than at each call site.
 *
 * The redaction is deliberately conservative and key-based. Anything named
 * like a credential or like something a learner said is replaced before the
 * line is serialised, so a field added later to a log call cannot quietly turn
 * observability into a data leak (security-observability-guardrails.md S17,
 * S18). Fields the guardrails actively prefer — request, trace, span, thread,
 * message and the pseudonymous user hash — pass through untouched, because
 * they are the whole point of having them.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export const REDACTED = "[redacted]";

/** How much of a free-text field survives. Enough to debug, not enough to store. */
const MAX_FIELD_LENGTH = 300;

/**
 * Two families, both matched on the key rather than the value.
 *
 * Credentials, because a logged key is a leaked key. And content, because a
 * learner's sentence is personal data that has no business in an operational
 * log line — the identifiers above are there so it does not need to be.
 */
const SENSITIVE_KEY =
  /(api[_-]?key|secret|token|password|passwd|authorization|auth[_-]?header|cookie|credential|session)/i;

const CONTENT_KEY =
  /(^|_|\b)(content|message|utterance|transcript|prompt|completion|reply|answer|question|email|text|body)($|_|\b)/i;

/** Names that read like content but are identifiers, and are wanted in logs. */
const IDENTIFIER_KEY = /^(messageId|promptName|promptVersion|promptFingerprint)$/;

/**
 * Splits camelCase so a key matches segment by segment. Without this,
 * `userMessage` sails past a word-boundary pattern that catches `message`,
 * which is exactly the field most worth catching.
 */
function segments(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2");
}

function redactValue(value: unknown): unknown {
  if (typeof value !== "string") return value;

  return value.length > MAX_FIELD_LENGTH
    ? `${value.slice(0, MAX_FIELD_LENGTH)}…`
    : value;
}

export function redact(fields: LogFields): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (IDENTIFIER_KEY.test(key)) {
      safe[key] = value;
      continue;
    }

    const normalised = segments(key);

    safe[key] =
      SENSITIVE_KEY.test(normalised) || CONTENT_KEY.test(normalised)
        ? REDACTED
        : redactValue(value);
  }

  return safe;
}

export interface LoggerOptions {
  /** Where a finished line goes. Defaults to stdout via console. */
  readonly sink?: (line: string) => void;
  readonly level?: LogLevel;
  /** Fields stamped onto every line: service, environment, and the like. */
  readonly base?: LogFields;
}

/** Serialises without throwing on a cycle or a value that cannot be encoded. */
function encode(payload: Record<string, unknown>): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(payload, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    if (typeof value === "bigint") return value.toString();
    return value;
  });
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = SEVERITY[options.level ?? "debug"];
  const sink = options.sink ?? ((line: string) => console.log(line));
  const base = options.base ? redact(options.base) : {};

  const emit = (level: LogLevel, event: string, fields?: LogFields) => {
    if (SEVERITY[level] < threshold) return;

    try {
      sink(encode({ level, event, ...base, ...redact(fields ?? {}) }));
    } catch {
      // A logger that can break the request it is describing is worse than a
      // logger that occasionally loses a line.
    }
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** For code paths that take a logger but are not being observed. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The same logger with more fields stamped on every line.
 *
 * A function over the interface rather than a method on it, so the many
 * places that hand in a four-method object as a logger keep working, and so
 * a fake in a test is still four functions.
 */
export function withFields(logger: Logger, fields: LogFields): Logger {
  const merged = (extra?: LogFields): LogFields => ({ ...fields, ...extra });
  return {
    debug: (event, extra) => logger.debug(event, merged(extra)),
    info: (event, extra) => logger.info(event, merged(extra)),
    warn: (event, extra) => logger.warn(event, merged(extra)),
    error: (event, extra) => logger.error(event, merged(extra)),
  };
}
