import { z } from "zod";

import { nonEmptyTextSchema, unitIntervalSchema } from "@/domain/primitives";

/**
 * The product-ops domain: what the workflow's agents may return, and the two
 * rules that are deliberately not model calls.
 *
 * Everything here is the outer validation boundary for model output that goes
 * on to move a workflow, render on a review page, or decide which file gets
 * written. Three of these shapes are load-bearing for security rather than for
 * correctness: repoPathSchema is the first place a path that escapes the
 * repository is refused, the evidence url is the first place a citation that is
 * not a web address is refused, and codeEditSchema is shaped so that a
 * whole-file rewrite cannot be expressed at all.
 *
 * The .describe() annotations are prompt content: the catalogue renders them
 * into the output contract, so this file is where a machine prompt says what it
 * is actually asking for.
 */

// ---------------------------------------------------------------------------
// Values the rest of the feature agrees on
// ---------------------------------------------------------------------------

export const PRODUCT_OPS_STAGES = [
  "research",
  "synthesis",
  "human_review",
  "prd",
  "code_plan",
  "plan_review",
  "implementation",
  "verification",
  "pull_request",
  "completed",
  "failed",
  "rejected",
] as const;

export const productOpsStageSchema = z.enum(PRODUCT_OPS_STAGES);
export type ProductOpsStage = z.infer<typeof productOpsStageSchema>;

/**
 * What a stage reports back.
 *
 * already_done is not a lesser kind of success. A stage that finds its own
 * output waiting has done its job, and a retry that treated it as anything
 * else would either redo the work or stall the run.
 */
export const STAGE_OUTCOMES = ["ok", "already_done", "failed", "rejected"] as const;

export const stageOutcomeSchema = z.enum(STAGE_OUTCOMES);
export type StageOutcome = z.infer<typeof stageOutcomeSchema>;

export const RUN_TYPES = ["manual_market_scan", "feature_implementation"] as const;

export const runTypeSchema = z.enum(RUN_TYPES);
export type RunType = z.infer<typeof runTypeSchema>;

/**
 * What the run is looking for, in the operator's own words.
 *
 * The one piece of trusted framing in the whole workflow: it comes from a
 * person who is already authorised, and it is what the research queries and
 * the CPO's brief are derived from. Stored on the run rather than passed in,
 * because the orchestrator is stateless — a worker that resumes a run three
 * stages later has to be able to read what the run was for.
 *
 * Short on purpose. A brief that needs four hundred characters is two briefs.
 */
export const RUN_BRIEF_MAX = 400;

export const runBriefSchema = nonEmptyTextSchema(RUN_BRIEF_MAX);

export const PROPOSAL_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "prd_ready",
  "plan_ready",
  "coding",
  "verifying",
  "pr_open",
  "completed",
  "failed",
] as const;

export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const REVIEW_ACTIONS = [
  "approve",
  "reject",
  "reprioritise",
  "approve_plan",
  "comment",
] as const;

export const reviewActionSchema = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

export const complexitySchema = z
  .enum(["small", "medium", "large"])
  .describe(
    "engineering effort: small is a day, medium is a week, large is longer than that",
  );

export type Complexity = z.infer<typeof complexitySchema>;

// ---------------------------------------------------------------------------
// Repository paths
// ---------------------------------------------------------------------------

const MAX_PATH_LENGTH = 200;

const UNIT_SEPARATOR = 0x20;
const DELETE_CHARACTER = 0x7f;

/**
 * Whether a path carries a character that means one thing in a log and another
 * on a filesystem.
 *
 * Written as a code-point predicate rather than a character class, because a
 * character class for this contains the very bytes it is guarding against, and
 * a source file is a worse place to store them than a test fixture.
 */
function hasControlCharacter(path: string): boolean {
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (code < UNIT_SEPARATOR || code === DELETE_CHARACTER) return true;
  }

  return false;
}

/**
 * A path inside this repository, and nothing else.
 *
 * Deliberately not trimmed and deliberately not normalised. A path that needs
 * repair to be safe is a path the model got wrong, and quietly repairing it
 * here would mean the apply layer checks a string the model never proposed.
 * Every rejection below is a real escape route: a dot segment climbs out, a
 * leading slash or tilde ignores the root entirely, and a backslash is a
 * different operating system's idea of a separator.
 *
 * This is the first of three gates, not the only one. The apply layer resolves
 * the real path and checks it against the approved plan and a deny-list
 * (product-ops-spec.md section 11).
 */
export const repoPathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((path) => !hasControlCharacter(path), {
    message: "a path may not contain control characters",
  })
  .refine((path) => !path.includes("\\"), {
    message: "a path separator is a forward slash",
  })
  .refine((path) => !path.startsWith("/") && !path.startsWith("~"), {
    message: "a path must be relative to the repository root",
  })
  .refine((path) => !path.endsWith("/"), {
    message: "a path must name a file, not a directory",
  })
  .refine(
    (path) =>
      path
        .split("/")
        .every(
          (segment) => segment.length > 0 && segment !== "." && segment !== "..",
        ),
    { message: "a path may not contain empty or dot segments" },
  )
  .describe("a path relative to the repository root, using forward slashes");

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * A web address, and only a web address.
 *
 * z.url() defers to the URL parser, which is happy with any scheme it
 * recognises, javascript: included. These urls are rendered as links on an
 * operator's page, so the scheme is narrowed here rather than at the point
 * somebody remembers to.
 */
const httpUrlSchema = z
  .url()
  .max(500)
  .refine((url) => /^https?:\/\//i.test(url), {
    message: "a citation must be an http or https address",
  });

export const evidenceSchema = z.strictObject({
  url: httpUrlSchema
    .describe("the address this came from, copied from the supplied results")
    .optional(),
  finding: nonEmptyTextSchema(300).describe(
    "what this source actually says, in one line, without interpretation",
  ),
});

export type Evidence = z.infer<typeof evidenceSchema>;

// ---------------------------------------------------------------------------
// Market research
// ---------------------------------------------------------------------------

export const marketFindingSchema = z.strictObject({
  title: nonEmptyTextSchema(160).describe("the finding in one line"),
  sourceType: z
    .enum(["web", "forum", "review", "competitor", "internal"])
    .describe(
      "the kind of source; a source that fits none of these is not a finding",
    ),
  sourceUrl: httpUrlSchema.describe("the primary source address").optional(),
  // The caps below are sized so one finding fits inside the cheap tier's 600
  // output tokens at their worst case, about 500. Six of everything did not,
  // and neither did four: the model wrote valid JSON that the ceiling cut off
  // mid-array, and a cut-off object is no object at all.
  summary: nonEmptyTextSchema(300).describe(
    "what was found, in two short sentences",
  ),
  painPoints: z
    .array(nonEmptyTextSchema(120))
    .max(3)
    .describe("the specific difficulties learners describe, in their terms"),
  trends: z
    .array(nonEmptyTextSchema(120))
    .max(3)
    .describe("the movement behind them"),
  evidence: z
    .array(
      evidenceSchema.extend({
        finding: nonEmptyTextSchema(200).describe(
          "what this source actually says, in one short line, without interpretation",
        ),
      }),
    )
    .max(2)
    .describe("the two strongest citations, drawn only from the supplied results"),
  relevanceScore: unitIntervalSchema.describe(
    "how much this bears on German learning for English speakers, 0 to 1",
  ),
});

export type MarketFinding = z.infer<typeof marketFindingSchema>;

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

/**
 * The four judgements a priority is computed from.
 *
 * Asked for separately, and never as a finished score, because the review gate
 * needs a number somebody can account for. "92" is not reviewable; "wide
 * reach, severe, well evidenced, cheap" is.
 */
export const impactComponentsSchema = z.strictObject({
  reach: unitIntervalSchema.describe(
    "the share of learners this affects at all, 0 to 1",
  ),
  severity: unitIntervalSchema.describe(
    "how much it blocks the ones it affects, 0 to 1",
  ),
  evidenceStrength: unitIntervalSchema.describe(
    "how well the supplied research actually supports this, 0 to 1; weak evidence scored honestly is worth more than strong evidence asserted",
  ),
  productFit: unitIntervalSchema.describe(
    "how well it fits a German tutor for English speakers, 0 to 1",
  ),
});

export type ImpactComponents = z.infer<typeof impactComponentsSchema>;

export const productProposalSchema = z.strictObject({
  title: nonEmptyTextSchema(120).describe(
    "the feature, named as a product would name it",
  ),
  problemStatement: nonEmptyTextSchema(800).describe(
    "the learner problem, not the solution",
  ),
  targetUsers: nonEmptyTextSchema(300).describe("who specifically has this problem"),
  marketJustification: nonEmptyTextSchema(800).describe(
    "why now, grounded in the supplied research rather than in general plausibility",
  ),
  userImpact: nonEmptyTextSchema(600).describe("what changes for a learner"),
  proposedSolution: nonEmptyTextSchema(1200).describe("what to build"),
  complexity: complexitySchema,
  impact: impactComponentsSchema,
  implementationOutline: z
    .array(nonEmptyTextSchema(200))
    .min(1)
    .max(10)
    .describe("the ordered steps, one line each"),
  affectedAreas: z
    .array(nonEmptyTextSchema(120))
    .min(1)
    .max(10)
    .describe("the parts of the product this touches"),
  evidence: z
    .array(evidenceSchema)
    .min(1)
    .max(8)
    .describe("at least one citation; a proposal with no evidence is an opinion"),
});

export type ProductProposal = z.infer<typeof productProposalSchema>;

/**
 * How much each judgement counts, and how much effort discounts it.
 *
 * Severity leads because a problem that fully blocks a few learners beats a
 * mild annoyance for many, and evidence is weighted level with reach so that a
 * well-supported narrow case can outrank a speculative broad one.
 *
 * These are starting weights, tunable with evidence about which proposals
 * actually shipped and were worth shipping. They are here rather than in a
 * prompt so that changing them is a diff with a test behind it.
 */
const IMPACT_WEIGHTS: Readonly<Record<keyof ImpactComponents, number>> = {
  severity: 0.3,
  reach: 0.25,
  evidenceStrength: 0.25,
  productFit: 0.2,
};

const EFFORT_FACTOR: Readonly<Record<Complexity, number>> = {
  small: 1,
  medium: 0.85,
  large: 0.7,
};

/**
 * The priority a proposal carries, 0 to 100.
 *
 * A function rather than a prompt, per model-routing-and-cost-control.md
 * section 5's reasoning about ranking: deterministic is cheaper, reproducible,
 * testable, and explainable to the person at the review gate. Two runs over
 * the same judgements produce the same number, which is what makes a change in
 * the number mean something.
 */
export function priorityScoreFor(
  impact: ImpactComponents,
  complexity: Complexity,
): number {
  const weighted =
    impact.severity * IMPACT_WEIGHTS.severity +
    impact.reach * IMPACT_WEIGHTS.reach +
    impact.evidenceStrength * IMPACT_WEIGHTS.evidenceStrength +
    impact.productFit * IMPACT_WEIGHTS.productFit;

  return Math.round(100 * weighted * EFFORT_FACTOR[complexity]);
}

// ---------------------------------------------------------------------------
// The PRD
// ---------------------------------------------------------------------------

/**
 * Only the sections that need judgement.
 *
 * Everything else in the document — the problem, the users, the evidence, the
 * implementation areas — is a projection of the approved proposal's own
 * columns, rendered rather than generated. A model asked to restate what is
 * already stored can only introduce drift.
 */
export const prdSectionsSchema = z.strictObject({
  userStories: z
    .array(nonEmptyTextSchema(300))
    .min(1)
    .max(12)
    .describe("as a given user, I want a capability, so that an outcome follows"),
  functionalRequirements: z
    .array(nonEmptyTextSchema(300))
    .min(1)
    .max(15)
    .describe("what the system must do, each one testable"),
  acceptanceCriteria: z
    .array(nonEmptyTextSchema(300))
    .min(1)
    .max(15)
    .describe("how a reviewer decides this is finished"),
  nonGoals: z
    .array(nonEmptyTextSchema(200))
    .min(1)
    .max(8)
    .describe("what this deliberately does not do; at least one"),
});

export type PrdSections = z.infer<typeof prdSectionsSchema>;

// ---------------------------------------------------------------------------
// The implementation plan
// ---------------------------------------------------------------------------

/**
 * The plan, whose file lists become the coding agent's path allowlist once a
 * human has approved them. Every path is validated here, so a plan naming
 * something outside the repository never reaches the approval page for
 * somebody to wave through.
 */
export const implementationPlanSchema = z
  .strictObject({
    filesToModify: z
      .array(repoPathSchema)
      .max(15)
      .describe("existing files this will change"),
    filesToCreate: z.array(repoPathSchema).max(15).describe("new files"),
    databaseChanges: z
      .array(nonEmptyTextSchema(300))
      .max(8)
      .describe(
        "schema changes this needs, described rather than written: a migration is a human's decision",
      ),
    apiChanges: z.array(nonEmptyTextSchema(300)).max(8),
    uiChanges: z.array(nonEmptyTextSchema(300)).max(8),
    tests: z
      .array(repoPathSchema)
      .max(20)
      .describe("the test files this needs, which are written before the code"),
    dependencies: z
      .array(nonEmptyTextSchema(120))
      .max(8)
      .describe("packages this would add; prefer none"),
    risks: z
      .array(nonEmptyTextSchema(300))
      .max(8)
      .describe("what could go wrong, stated rather than discovered"),
  })
  .refine((plan) => plan.filesToModify.length + plan.filesToCreate.length > 0, {
    message: "a plan that touches no file is not a plan",
  });

export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;

// ---------------------------------------------------------------------------
// Code edits
// ---------------------------------------------------------------------------

const MAX_ANCHOR_LENGTH = 1_200;
const MAX_REPLACEMENT_LENGTH = 2_400;
const MAX_NEW_FILE_LENGTH = 5_000;

/**
 * One exact substitution.
 *
 * The anchor is matched literally and must occur exactly once, which the apply
 * layer enforces. Neither field is trimmed: whitespace is part of the match,
 * and a schema that normalised it would hand the apply layer a string the
 * model never proposed. A replacement may be empty — that is a deletion — but
 * an anchor may not, because an empty anchor matches everywhere and the
 * exactly-once rule would have nothing to adjudicate.
 */
export const anchoredEditSchema = z.strictObject({
  anchor: z
    .string()
    .min(1)
    .max(MAX_ANCHOR_LENGTH)
    .describe(
      "text copied verbatim from the file, long enough to occur exactly once",
    ),
  replacement: z
    .string()
    .max(MAX_REPLACEMENT_LENGTH)
    .describe("what replaces it; empty to delete the anchored text"),
});

export type AnchoredEdit = z.infer<typeof anchoredEditSchema>;

/**
 * A change to one file.
 *
 * The union is what keeps this inside the output ceiling. The reasoning tier
 * may emit at most 2000 tokens, and a source file does not fit in 2000 tokens,
 * so an existing file is changed by anchored edits and whole contents are
 * expressible only for a file that does not exist yet. That is not a
 * convention the prompt asks for; it is a shape the schema will not accept
 * otherwise.
 */
export const codeEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("modify"),
    path: repoPathSchema,
    rationale: nonEmptyTextSchema(300).describe(
      "why this file changes, in one line",
    ),
    edits: z
      .array(anchoredEditSchema)
      .min(1)
      .max(4)
      .describe("the substitutions, each anchored on text unique in the file"),
  }),
  z.strictObject({
    kind: z.literal("create"),
    path: repoPathSchema,
    rationale: nonEmptyTextSchema(300).describe("what this file is for"),
    contents: z
      .string()
      .min(1)
      .max(MAX_NEW_FILE_LENGTH)
      .describe("the complete file"),
  }),
]);

export type CodeEdit = z.infer<typeof codeEditSchema>;

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Who moves a run out of each stage.
 *
 * One definition, used twice and for the same reason both times: the
 * orchestrator dispatches on it, and the dashboard tells the operator what a
 * run is waiting for. Two tables saying this would eventually disagree, and
 * the disagreement would be a run that looks stuck on a screen while a worker
 * is quietly doing it.
 *
 * The worker stages are the three that write to a checkout. Planning only
 * reads, and the server can read a repository — its own checkout in
 * development, or whatever browser the composition root supplies — so the
 * plan is produced in the pipeline and the run ends at the gate that follows
 * it. The three write stages remain in the schema and in this union, but no
 * decision leads to them any more: accepting a plan completes the run, and the
 * plan is the deliverable a person takes away.
 */
export const OPERATOR_STAGES = ["human_review", "plan_review"] as const;

export const WORKER_STAGES = [
  "implementation",
  "verification",
  "pull_request",
] as const;

export const TERMINAL_STAGES = ["completed", "failed", "rejected"] as const;

export type OperatorStage = (typeof OPERATOR_STAGES)[number];
export type WorkerStage = (typeof WORKER_STAGES)[number];
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

/** The stages the server itself runs: everything left over. */
export type ServerStage = Exclude<
  ProductOpsStage,
  OperatorStage | WorkerStage | TerminalStage
>;

export type StageOwner = "server" | "operator" | "worker" | "nobody";

export function stageOwner(stage: ProductOpsStage): StageOwner {
  if ((TERMINAL_STAGES as readonly string[]).includes(stage)) return "nobody";
  if ((OPERATOR_STAGES as readonly string[]).includes(stage)) return "operator";
  if ((WORKER_STAGES as readonly string[]).includes(stage)) return "worker";

  return "server";
}

/**
 * Where each stage goes when it succeeds.
 *
 * A Readonly<Record<ProductOpsStage, …>> rather than a switch, so adding a
 * stage to the tuple without deciding where it leads is a type error rather
 * than a run that stops somewhere nobody chose.
 *
 * The two nulls in the middle are the whole safety property of this feature.
 * human_review and plan_review have no forward transition because nothing
 * automatic may leave them: a proposal becomes a PRD only because a person
 * approved it, and a plan is accepted only because a person accepted it. The
 * three write stages keep their edges for the schema's sake; no review leads
 * into them.
 */
const FORWARD: Readonly<Record<ProductOpsStage, ProductOpsStage | null>> = {
  research: "synthesis",
  synthesis: "human_review",
  human_review: null,
  prd: "code_plan",
  code_plan: "plan_review",
  plan_review: null,
  implementation: "verification",
  verification: "pull_request",
  pull_request: "completed",
  completed: null,
  failed: null,
  rejected: null,
};

/**
 * The stage a run moves to, or null when it stays where it is.
 *
 * Pure and total. Null means three different things that all amount to "do not
 * move": the run has finished, it is waiting for a person, or the stage has no
 * successor. The caller does not need to tell them apart, because in all three
 * cases there is nothing for a worker to do.
 */
export function nextStage(
  stage: ProductOpsStage,
  outcome: StageOutcome,
): ProductOpsStage | null {
  if (stageOwner(stage) === "nobody") return null;

  switch (outcome) {
    case "failed":
      return "failed";
    case "rejected":
      return "rejected";
    case "ok":
    case "already_done":
      return FORWARD[stage];
  }
}

/**
 * What a human decision does to the run.
 *
 * The other half of the state machine, and the only thing that may leave a
 * gate. Kept beside nextStage and in the same shape — pure, total, no I/O —
 * so that the two functions between them describe every transition this
 * workflow has, and neither an action nor a worker gets to invent one.
 *
 * Null means the run stays where it is. Commenting on a proposal and
 * reprioritising it are both decisions worth recording that are not decisions
 * to proceed, and an approval aimed at the wrong gate is not one either.
 */
export function stageAfterReview(
  stage: ProductOpsStage,
  action: ReviewAction,
): ProductOpsStage | null {
  if (action === "reject") {
    return stage === "human_review" || stage === "plan_review" ? "rejected" : null;
  }

  if (action === "approve") return stage === "human_review" ? "prd" : null;
  if (action === "approve_plan") {
    // Accepting the plan is the end of the run. The plan is what the operator
    // takes away; nothing in this workflow writes to the repository.
    return stage === "plan_review" ? "completed" : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Deterministic names
// ---------------------------------------------------------------------------

/**
 * The branch a proposal's implementation goes on.
 *
 * Derived from the proposal id and nothing else, which is what makes the push
 * idempotent: a worker that died after pushing computes the same name on
 * retry, finds the branch, and adopts it. A name carrying a counter or a
 * timestamp is how product-ops/abc-2 comes to exist.
 */
export function branchNameFor(proposalId: string): string {
  return `product-ops/${proposalId}`;
}

/**
 * Where the PRD is projected for the worker to read.
 *
 * A projection, not the record: the row in Postgres is the source of truth and
 * this file is written from it. Under .ai/ rather than docs/, so a generated
 * artifact is never mistaken for one a person wrote.
 */
export function prdPathFor(proposalId: string): string {
  return `.ai/prds/${proposalId}.md`;
}

// ---------------------------------------------------------------------------
// Stored entities
// ---------------------------------------------------------------------------
//
// What the database holds, as the rest of the application sees it. Separate
// from the model-output schemas above on purpose: a proposal the CPO produced
// has no id, no status and no priority, and a proposal that has been stored
// has all three and no impact components. Conflating them would mean every
// caller checking which kind it was holding.

/**
 * Timestamps as they actually arrive.
 *
 * primitives.timestampSchema uses z.iso.datetime(), which rejects the offset
 * and microsecond precision Postgres sends, and jsonb_build_object stringifies
 * them in its own way again. Both shapes end up as a Date here, and something
 * that is not a date at all is a decode failure rather than an Invalid Date
 * travelling onward.
 */
const databaseTimestampSchema = z
  .union([z.date(), z.string().min(1).transform((value) => new Date(value))])
  .refine((value) => !Number.isNaN(value.getTime()), {
    message: "not a timestamp",
  });

export const RUN_STATUSES = [
  "running",
  "awaiting_review",
  "completed",
  "failed",
  "rejected",
] as const;

export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** The pseudonym an operator is recorded as, never their user id. */
export const operatorIdHashSchema = nonEmptyTextSchema(64);

export const productOpsRunSchema = z.object({
  id: z.uuid(),
  runType: runTypeSchema,
  status: runStatusSchema,
  currentStage: productOpsStageSchema,
  operatorIdHash: operatorIdHashSchema,
  requestId: z.uuid().nullable(),
  /** Null for a run started before the brief existed, not for a new one. */
  brief: runBriefSchema.nullable(),
  errorCode: z.string().max(120).nullable(),
  startedAt: databaseTimestampSchema.nullable(),
  completedAt: databaseTimestampSchema.nullable(),
  createdAt: databaseTimestampSchema,
  updatedAt: databaseTimestampSchema,
});

export type ProductOpsRun = z.infer<typeof productOpsRunSchema>;

/**
 * A slug for a proposal title.
 *
 * The database's own CHECK is the same shape. It exists so that a re-run of
 * one run's synthesis stage collides on the unique index rather than filing a
 * second copy of the same idea.
 */
export const proposalSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/**
 * Turns a title into a slug, or into an empty string when there is nothing
 * sluggable left.
 *
 * Umlauts are transliterated rather than stripped, because a German product
 * proposing a German feature will produce titles containing them, and
 * "Aussprache" losing three letters to become "ussprache" is a worse
 * identifier than one nobody can read at all. An empty result is returned as
 * such rather than substituted: the caller rejects it, so a title made
 * entirely of punctuation fails loudly instead of colliding with every other
 * such title.
 */
export function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[äöüß]/g, (character) => TRANSLITERATIONS[character] ?? character)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const storedProposalSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  title: nonEmptyTextSchema(120),
  titleSlug: proposalSlugSchema,
  problemStatement: z.string(),
  marketJustification: z.string(),
  targetUsers: z.string(),
  userImpact: z.string(),
  proposedSolution: z.string(),
  complexity: complexitySchema,
  priorityScore: z.number().int().min(0).max(100),
  implementationOutline: z.array(z.string()),
  affectedAreas: z.array(z.string()),
  supportingResearch: z.array(evidenceSchema),
  internalContext: z.array(z.string()),
  status: proposalStatusSchema,
  createdAt: databaseTimestampSchema,
  updatedAt: databaseTimestampSchema,
});

export type StoredProposal = z.infer<typeof storedProposalSchema>;

export const pullRequestRecordSchema = z.object({
  id: z.uuid(),
  proposalId: z.uuid(),
  provider: z.literal("github"),
  repository: nonEmptyTextSchema(200),
  branch: nonEmptyTextSchema(200),
  prNumber: z.number().int().positive().nullable(),
  url: z.string().nullable(),
  status: z.enum(["open", "merged", "closed"]),
  createdAt: databaseTimestampSchema,
  updatedAt: databaseTimestampSchema,
});

export type PullRequestRecord = z.infer<typeof pullRequestRecordSchema>;

// --- the artifacts, as stored ----------------------------------------------

/**
 * The PRD row.
 *
 * The document is stored whole rather than re-rendered on read. Two reasons:
 * the renderer is deterministic but the sections it renders came from a model
 * at a particular version, and a hash over stored text is what lets the worker
 * check that the document it is implementing is the document a person read.
 */
export const prdRecordSchema = z.object({
  id: z.uuid(),
  proposalId: z.uuid(),
  document: nonEmptyTextSchema(60_000),
  documentHash: nonEmptyTextSchema(64),
  sections: prdSectionsSchema,
  /** Where the projection is written for the worker. Postgres remains the truth. */
  filePath: repoPathSchema,
  createdAt: databaseTimestampSchema,
  updatedAt: databaseTimestampSchema,
});

export type PrdRecord = z.infer<typeof prdRecordSchema>;

/**
 * A plan's own status, which is not the proposal's.
 *
 * Separate because the two answer different questions. The proposal's status
 * says where the idea is; the plan's says whether a person has approved this
 * particular list of files — and that list is what the apply layer checks
 * every write against, so it needs an approval of its own to point at.
 */
export const PLAN_STATUSES = ["pending_review", "approved", "rejected"] as const;

export const planStatusSchema = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof planStatusSchema>;

export const storedPlanSchema = z.object({
  id: z.uuid(),
  proposalId: z.uuid(),
  plan: implementationPlanSchema,
  status: planStatusSchema,
  createdAt: databaseTimestampSchema,
  updatedAt: databaseTimestampSchema,
});

export type StoredPlan = z.infer<typeof storedPlanSchema>;

export const codeChangeRecordSchema = z.object({
  id: z.number().int(),
  planId: z.uuid(),
  path: z.string(),
  editCount: z.number().int().min(0),
  bytesBefore: z.number().int().min(0).nullable(),
  bytesAfter: z.number().int().min(0).nullable(),
  applied: z.boolean(),
  rejectedReason: z.string().nullable(),
  createdAt: databaseTimestampSchema,
});

export type CodeChangeRecord = z.infer<typeof codeChangeRecordSchema>;

/**
 * One recorded human decision.
 *
 * The previous priority sits beside the new one because that is what makes
 * this an audit trail rather than a log of the current value: "changed from 78
 * to 40" is reviewable, and "40" is not.
 */
export const proposalReviewSchema = z.object({
  id: z.number().int(),
  proposalId: z.uuid(),
  action: reviewActionSchema,
  previousPriority: z.number().int().min(0).max(100).nullable(),
  newPriority: z.number().int().min(0).max(100).nullable(),
  comment: z.string().nullable(),
  operatorIdHash: z.string(),
  createdAt: databaseTimestampSchema,
});

export type ProposalReview = z.infer<typeof proposalReviewSchema>;

// --- the timeline -----------------------------------------------------------

/**
 * What an event row can say happened.
 *
 * A superset of the stage outcomes, by two. 'started' marks a stage that has
 * begun, and 'skipped' one that nothing asked to run — neither is an outcome a
 * stage can return, and both are worth seeing on a timeline.
 */
export const EVENT_STATUSES = [
  "started",
  "ok",
  "already_done",
  "skipped",
  "failed",
  "rejected",
  // An agent finished one tool call inside a stage. Neither an entry nor an
  // outcome: the dashboard reads it as "still working", and the idempotency
  // guards ignore it.
  "progress",
] as const;

export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const runEventSchema = z.object({
  id: z.number().int(),
  runId: z.uuid(),
  stage: productOpsStageSchema,
  status: eventStatusSchema,
  detail: z.record(z.string(), z.unknown()),
  createdAt: databaseTimestampSchema,
});

export type RunEvent = z.infer<typeof runEventSchema>;

/**
 * What a stage cost, as recorded on its own event.
 *
 * The euro figure lives in the event detail rather than in a column on the
 * run, because a run's spend is the sum of what its stages did and a column
 * would be a second place for that to be true. Zero for anything that did not
 * call a model, and zero — not a throw — for a detail that does not carry the
 * field, since an event written by an earlier version is still an event.
 */
export function stageCostEur(event: RunEvent): number {
  const recorded = event.detail.costEur;

  return typeof recorded === "number" && Number.isFinite(recorded) && recorded > 0
    ? recorded
    : 0;
}

/** What a whole run has spent, from its own timeline. */
export function runSpendEur(events: readonly RunEvent[]): number {
  return events.reduce((total, event) => total + stageCostEur(event), 0);
}

/** What a compare-and-set transition reports back. */
export const stageTransitionSchema = z.object({
  advanced: z.boolean(),
  stage: productOpsStageSchema,
});

export type StageTransition = z.infer<typeof stageTransitionSchema>;

export const reviewOutcomeSchema = z.object({
  status: proposalStatusSchema,
  priorityScore: z.number().int().min(0).max(100),
});

export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

/**
 * One card on the board.
 *
 * Assembled by the database function rather than here, so the page issues one
 * query. The nullable pullRequest is the run's outcome once it has one.
 */
export const boardProposalSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  title: z.string(),
  titleSlug: z.string(),
  status: proposalStatusSchema,
  complexity: complexitySchema,
  priorityScore: z.number().int().min(0).max(100),
  createdAt: databaseTimestampSchema,
  updatedAt: databaseTimestampSchema,
  runStage: productOpsStageSchema,
  runStatus: runStatusSchema,
  reviewCount: z.number().int().min(0),
  hasPrd: z.boolean(),
  hasPlan: z.boolean(),
  pullRequest: z
    .object({
      number: z.number().int().positive().nullable(),
      url: z.string().nullable(),
      status: z.enum(["open", "merged", "closed"]),
    })
    .nullable(),
});

export type BoardProposal = z.infer<typeof boardProposalSchema>;

export const boardRunSchema = z.object({
  id: z.uuid(),
  runType: runTypeSchema,
  status: runStatusSchema,
  stage: productOpsStageSchema,
  errorCode: z.string().nullable(),
  startedAt: databaseTimestampSchema.nullable(),
  completedAt: databaseTimestampSchema.nullable(),
  /**
   * When this run last moved, which is the only evidence that anything is
   * driving it.
   *
   * Every stage transition touches it, so quiet for longer than a stage could
   * plausibly take means the drive died. Without it a run at a server-owned
   * stage is indistinguishable from one abandoned three days ago, and a page
   * showing a spinner for the second is worse than one showing nothing.
   */
  updatedAt: databaseTimestampSchema,
});

export type BoardRun = z.infer<typeof boardRunSchema>;

export const productOpsBoardSchema = z.object({
  generatedAt: databaseTimestampSchema,
  proposals: z.array(boardProposalSchema),
  runs: z.array(boardRunSchema),
});

export type ProductOpsBoard = z.infer<typeof productOpsBoardSchema>;

// ---------------------------------------------------------------------------
// Paths the agent may never write
// ---------------------------------------------------------------------------

/**
 * The deny-list, which overrides an approved plan.
 *
 * Not redundant with the plan. The plan is model-proposed and human-approved,
 * and a human approving a plan quickly is exactly the failure mode this exists
 * for. Each entry is something whose change should be a person's deliberate
 * act rather than a consequence of a feature request:
 *
 *   .env*                   secrets
 *   supabase/migrations/**  a schema change is a decision, not a side effect
 *   .github/**              the thing that would run the agent's own code
 *   lib/ai/gateway/**       the only code allowed to reach a model
 *   lib/ai/prompts/**       what the agent is told, including by itself
 *   tests/security/**       the gates that would catch the rest of this
 *   package.json            dependencies, and the scripts that run in CI
 *   pnpm-lock.yaml          the same, resolved
 *   proxy.ts                the request guard
 *
 * Lives in the domain so the planner can report a refusal before a reviewer
 * approves it and the apply layer can enforce the same list at write time,
 * from one definition rather than two that drift.
 */
export const DENIED_PATHS: readonly RegExp[] = [
  /^\.env($|\.)/,
  /^supabase\/migrations\//,
  /^\.github\//,
  /^lib\/ai\/gateway\//,
  /^lib\/ai\/prompts\//,
  /^tests\/security\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^proxy\.ts$/,
];

/** Whether a path is refused regardless of what any plan says about it. */
export function isDeniedPath(path: string): boolean {
  return DENIED_PATHS.some((pattern) => pattern.test(path));
}

/** Every path in a plan that the apply layer would refuse. */
export function deniedPathsIn(plan: ImplementationPlan): readonly string[] {
  return [...plan.filesToModify, ...plan.filesToCreate, ...plan.tests].filter(
    isDeniedPath,
  );
}
