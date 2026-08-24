import { z } from "zod";

/**
 * The output contract, rendered from the schema that validates it.
 *
 * A structured prompt has to tell the model what shape to return, and the
 * obvious way to do that is to write the shape out in prose next to the Zod
 * schema. That prose then drifts: a field gets a tighter cap, an enum gains a
 * member, and the prompt keeps describing last month's contract while the
 * validator rejects this month's output. The failure looks like a bad model.
 *
 * So the description is generated from the schema itself. The prompt and the
 * validator cannot disagree, because there is only one of them.
 *
 * Terse on purpose. This block is paid for on every call of its task, and a
 * model does not need the prose that would help a person.
 */

/**
 * Conversation has no contract to state: its output is prose for a person, and
 * the only shape it has is the response policy.
 */
export const STREAMED_TEXT = "streamed_text" as const;

export type OutputContract = z.ZodTypeAny | typeof STREAMED_TEXT;

/** Beyond this a contract is unreadable to a model and expensive to send. */
const MAX_DEPTH = 4;

interface ZodInternals {
  readonly def: {
    readonly type: string;
    readonly shape?: Record<string, unknown>;
    readonly entries?: Record<string, string | number>;
    readonly element?: unknown;
    readonly innerType?: unknown;
    readonly checks?: readonly unknown[];
    readonly values?: readonly unknown[];
    readonly options?: readonly unknown[];
  };
}

const internals = (schema: unknown): ZodInternals["def"] =>
  (schema as ZodInternals).def;

/** Checks live one level down in some Zod versions and inline in others. */
function checkDefs(schema: unknown): Array<Record<string, unknown>> {
  const checks = internals(schema).checks ?? [];

  return checks.map((check) => {
    const wrapped = (check as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    return wrapped ?? (check as Record<string, unknown>);
  });
}

function findCheck(schema: unknown, name: string): Record<string, unknown> | undefined {
  return checkDefs(schema).find((check) => check.check === name);
}

function bound(schema: unknown, name: string): number | undefined {
  const value = findCheck(schema, name)?.value ?? findCheck(schema, name)?.maximum;
  return typeof value === "number" ? value : undefined;
}

function describeNumber(schema: unknown): string {
  const min = bound(schema, "greater_than");
  const max = bound(schema, "less_than");
  const integer = checkDefs(schema).some((check) => check.format === "safeint");
  const kind = integer ? "integer" : "number";

  if (min !== undefined && max !== undefined) return `${kind} ${min} to ${max}`;
  if (min !== undefined) return `${kind} ${min} or more`;
  if (max !== undefined) return `${kind} ${max} or less`;
  return kind;
}

function describeString(schema: unknown): string {
  const max = bound(schema, "max_length");
  return max === undefined ? "string" : `string, at most ${max} characters`;
}

function describeEnum(schema: unknown): string {
  const entries = internals(schema).entries ?? {};
  return `one of: ${Object.values(entries).join(" | ")}`;
}

/**
 * Renders one field. Objects and arrays recurse; anything unrecognised is
 * described as a value rather than guessed at, because a wrong description is
 * worse than a vague one.
 */
function describe(schema: unknown, depth: number): string {
  const def = internals(schema);

  switch (def.type) {
    case "optional":
      return `${describe(def.innerType, depth)} (may be omitted)`;
    case "nullable":
      return `${describe(def.innerType, depth)} or null`;
    case "default":
      return describe(def.innerType, depth);
    case "string":
      return describeString(schema);
    case "number":
      return describeNumber(schema);
    case "boolean":
      return "true or false";
    case "enum":
      return describeEnum(schema);
    case "literal":
      return `exactly ${JSON.stringify(def.values?.[0])}`;
    case "array": {
      const max = bound(schema, "max_length");
      const size = max === undefined ? "array of" : `array of at most ${max}`;
      return `${size} [${describe(def.element, depth + 1)}]`;
    }
    case "object": {
      if (depth >= MAX_DEPTH) return "object";
      // Semicolons, not commas: a field description contains commas of its
      // own, and a model reading "string, at most 500 characters, corrected"
      // cannot tell where one field ends.
      return `{ ${describeFields(def.shape ?? {}, depth + 1).join("; ")} }`;
    }
    default:
      return "value";
  }
}

function describeFields(
  shape: Record<string, unknown>,
  depth: number,
): readonly string[] {
  return Object.entries(shape).map(([key, field]) => {
    // A field's own description rides along. It is the one channel the domain
    // has for saying what a value means — "in English", "the corrected
    // German" — without the prompt layer keeping a parallel commentary that
    // drifts from the schema it annotates.
    const note = (field as { description?: string })?.description;
    return `${key}: ${describe(field, depth)}${note ? ` — ${note}` : ""}`;
  });
}

/**
 * The whole contract, as the prompt states it.
 *
 * The wording around the fields matters as much as the fields. A model that
 * returns the right shape wrapped in an explanation is a model whose output
 * has to be dug out of prose, and every extra sentence is output tokens paid
 * for on a task whose entire value is the object.
 */
export function describeContract(schema: z.ZodTypeAny): string {
  const def = internals(schema);

  if (def.type !== "object") {
    return `Return exactly this and nothing else: ${describe(schema, 0)}`;
  }

  const fields = describeFields(def.shape ?? {}, 1)
    .map((line) => `- ${line}`)
    .join("\n");

  return [
    "Return one JSON object and nothing else. No prose, no code fence, no",
    "explanation. Every field below is required.",
    "",
    fields,
  ].join("\n");
}
