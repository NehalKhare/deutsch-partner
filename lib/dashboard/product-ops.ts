import { z } from "zod";

import {
  productOpsStageSchema,
  eventStatusSchema,
  stageOwner,
  type BoardProposal,
  type EngineeringBreakdown,
  type ImplementationPlan,
  type TShirtSize,
  type BoardRun,
  type ProductOpsBoard,
  type ProductOpsRun,
  type ProductOpsStage,
  type ProposalStatus,
  type RunEvent,
} from "@/domain/product-ops";

/**
 * The operator's view of the pipeline.
 *
 * Pure functions over what the database function already aggregated. The
 * board arrives as one jsonb document precisely so that nothing here has to
 * query, and so that the counts on the page cannot disagree with the cards
 * beneath them.
 *
 * The one idea this file adds is *who a run is waiting for*. A workflow with
 * two human gates and a stage that only a CLI worker can run has three quite
 * different kinds of "in progress", and a board that showed them the same way
 * would be a board an operator has to interpret. Every card says whose move it
 * is, and the answer comes from the same function the orchestrator dispatches
 * on.
 */

export interface BoardColumn {
  readonly key: string;
  readonly label: string;
  /** Why this column exists, shown under its heading. */
  readonly hint: string;
  readonly statuses: readonly ProposalStatus[];
  readonly proposals: readonly BoardProposal[];
}

/**
 * The five columns, and which statuses land in each.
 *
 * Grouped by what the operator would do about them rather than by the stage
 * machinery: the first column is the only one with anything to do in it, which
 * is the point of drawing a board at all. A test asserts every status appears
 * in exactly one column, so a new status cannot quietly vanish off the page.
 */
const COLUMNS: readonly {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly statuses: readonly ProposalStatus[];
}[] = [
  {
    key: "awaiting",
    label: "Awaiting you",
    hint: "A proposal or a plan needs a decision",
    statuses: ["pending_review", "plan_ready"],
  },
  {
    key: "progress",
    label: "In progress",
    hint: "Approved and moving",
    statuses: ["approved", "prd_ready", "coding", "verifying"],
  },
  {
    key: "review",
    label: "In code review",
    hint: "A pull request is open",
    statuses: ["pr_open"],
  },
  {
    key: "done",
    label: "Plan accepted",
    hint: "The run is finished; the plan is yours to take",
    statuses: ["completed"],
  },
  {
    key: "closed",
    label: "Closed",
    hint: "Rejected, or stopped by a failure",
    statuses: ["rejected", "failed"],
  },
];

export function boardColumns(board: ProductOpsBoard): readonly BoardColumn[] {
  return COLUMNS.map((column) => ({
    ...column,
    proposals: board.proposals.filter((proposal) =>
      column.statuses.includes(proposal.status),
    ),
  }));
}

/** Every status a column claims. Exported so a test can hold the set to account. */
export const COLUMN_STATUSES: readonly ProposalStatus[] = COLUMNS.flatMap(
  (column) => column.statuses,
);

export interface BoardTotals {
  readonly proposals: number;
  /** The number that actually needs a person. The figure worth leading with. */
  readonly awaitingYou: number;
  readonly awaitingWorker: number;
  readonly running: number;
  readonly failed: number;
}

export function boardTotals(board: ProductOpsBoard): BoardTotals {
  const owners = board.runs.map((run) => stageOwner(run.stage));

  return {
    proposals: board.proposals.length,
    awaitingYou: owners.filter((owner) => owner === "operator").length,
    awaitingWorker: owners.filter((owner) => owner === "worker").length,
    running: owners.filter((owner) => owner === "server").length,
    failed: board.runs.filter((run) => run.status === "failed").length,
  };
}

/** What the operator is waiting on, in one word, for a run at this stage. */
export function waitingLabel(stage: ProductOpsStage): string {
  switch (stageOwner(stage)) {
    case "operator":
      return "You";
    case "worker":
      return "The worker";
    case "server":
      return "Running";
    case "nobody":
      return "Nothing";
  }
}

/**
 * The command that moves a run whose next stage needs a checkout.
 *
 * Shown rather than run. The four stages that touch a repository happen in a
 * CLI worker on a machine with a working tree, and putting a button here that
 * pretended otherwise would be the dishonest version of this page.
 */
export function workerCommandFor(proposalId: string): string {
  return `pnpm product:implement ${proposalId}`;
}

/** One sentence saying what happens next, or what stopped. */
export function nextStep(proposal: BoardProposal): string {
  switch (stageOwner(proposal.runStage)) {
    case "operator":
      return proposal.runStage === "plan_review"
        ? "Read the plan, copy it if you want it, then accept or reject it."
        : "Approve it to generate a PRD, or reject it.";
    case "worker":
      // The command itself is shown beside this rather than inside it: it is
      // something to copy, and a sentence is not.
      return "Run the worker, on a machine with a checkout.";
    case "server":
      return "The pipeline is working on it.";
    case "nobody":
      return proposal.runStatus === "failed"
        ? "The run stopped. The timeline says where."
        : "Nothing left to do.";
  }
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  readonly id: number;
  readonly stage: ProductOpsStage;
  readonly status: RunEvent["status"];
  /** True for the row that marks entering a stage rather than finishing one. */
  readonly entered: boolean;
  readonly costEur: number;
  /** A code, when the stage failed. Never a message. */
  readonly errorCode: string | null;
  /** The remaining detail, as label and value pairs, for display. */
  readonly notes: readonly { readonly label: string; readonly value: string }[];
  readonly at: Date;
}

const HIDDEN_DETAIL = new Set(["costEur", "errorCode", "from", "status"]);

/** A short, non-recursive rendering. Detail is jsonb and can be anything. */
function describe(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 120);

  return String(value).slice(0, 120);
}

export function timelineEntries(
  events: readonly RunEvent[],
): readonly TimelineEntry[] {
  return events.map((event) => {
    const errorCode = event.detail.errorCode;
    const cost = event.detail.costEur;

    return {
      id: event.id,
      stage: event.stage,
      status: event.status,
      // The distinction the orchestrator writes deliberately: 'started' marks
      // arriving at a stage, and an outcome marks one finishing.
      entered: event.status === "started",
      costEur: typeof cost === "number" && cost > 0 ? cost : 0,
      errorCode: typeof errorCode === "string" ? errorCode : null,
      notes: Object.entries(event.detail)
        .filter(([key, value]) => !HIDDEN_DETAIL.has(key) && value !== undefined)
        .map(([key, value]) => ({ label: key, value: describe(value) })),
      at: event.createdAt,
    };
  });
}

// ---------------------------------------------------------------------------
// The live feed
// ---------------------------------------------------------------------------

/**
 * One timeline entry as it crosses the wire to the browser.
 *
 * The event stream sends exactly what the detail page already renders — the
 * timeline entry, notes included — and nothing the timeline does not carry.
 * The browser validates every frame against this before trusting a field of
 * it: the stream is server-owned, but a schema at the edge is what makes
 * "the feed shows only what the timeline shows" a property rather than a habit.
 */
export const liveTimelineEventSchema = z.object({
  id: z.number().int(),
  stage: productOpsStageSchema,
  status: eventStatusSchema,
  entered: z.boolean(),
  costEur: z.number(),
  errorCode: z.string().nullable(),
  notes: z.array(z.object({ label: z.string(), value: z.string() })),
  at: z.iso.datetime(),
});

export type LiveTimelineEvent = z.infer<typeof liveTimelineEventSchema>;

/** Where the run now stands, sent whenever the row moves. */
export const liveRunEventSchema = z.object({
  stage: productOpsStageSchema,
  status: z.string(),
  errorCode: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

export type LiveRunEvent = z.infer<typeof liveRunEventSchema>;

export function liveTimelineEventFrom(entry: TimelineEntry): LiveTimelineEvent {
  return { ...entry, notes: [...entry.notes], at: entry.at.toISOString() };
}

export function timelineEntryFrom(event: LiveTimelineEvent): TimelineEntry {
  return { ...event, at: new Date(event.at) };
}

/** How many lines of a run's feed to show. The tail, not the transcript. */
export const LIVE_FEED_LENGTH = 8;

/**
 * Each tool, in the words a person watching would use.
 *
 * The tool names are the agents' vocabulary. A feed that printed
 * `search_market ok` would be a log, and a log is what the timeline on the
 * detail page already is. An unknown tool is named as itself, so a new tool
 * shows up rather than vanishing.
 */
const TOOL_PHRASES: Readonly<Record<string, string>> = {
  search_market: "Searched the web",
  read_findings: "Read the research findings",
  list_prior_proposals: "Checked what has already been proposed",
  search_internal_docs: "Looked through the internal docs",
  read_prd: "Read the PRD",
  list_files: "Listed files in the repository",
  read_file: "Read a source file",
  search_code: "Searched the code",
  propose_edit: "Proposed an edit",
};

/** A note, as a short aside: "4 searches, 3 findings". */
function asideFrom(notes: TimelineEntry["notes"]): string {
  const counts = notes
    .filter((note) => /^\d+$/.test(note.value))
    .map((note) => `${note.value} ${note.label}`);

  return counts.length === 0 ? "" : ` — ${counts.join(", ")}`;
}

/**
 * One line of the feed for one timeline entry.
 *
 * Progress rows are the bulk of it and are what the feed exists for: a tool
 * call named in words, or a model call, so that a minute spent waiting on the
 * reasoning tier reads as a minute the model spent rather than a minute in
 * which nothing happened. Stage rows bracket them.
 */
export function describeTimelineEntry(entry: TimelineEntry): string {
  switch (entry.status) {
    case "started":
      // A retry's entry row carries the mark; the line says so, because a
      // stage starting twice is the one thing a timeline reader would ask about.
      return entry.notes.some((note) => note.label === "retry" && note.value === "true")
        ? `Started ${stagePhrase(entry.stage)} again`
        : `Started ${stagePhrase(entry.stage)}`;
    case "progress": {
      const tool = entry.notes.find((note) => note.label === "tool")?.value;
      const ok = entry.notes.find((note) => note.label === "ok")?.value !== "false";
      if (tool !== undefined) {
        const phrase = TOOL_PHRASES[tool] ?? `Used ${tool}`;
        return ok ? phrase : `${phrase}, which failed`;
      }
      return "The model replied";
    }
    case "ok":
      return `Finished ${stagePhrase(entry.stage)}${asideFrom(entry.notes)}`;
    case "already_done":
      return `Found ${stagePhrase(entry.stage)} already done`;
    case "skipped":
      return `Skipped ${stagePhrase(entry.stage)}`;
    case "failed":
      return `Stopped while ${stagePhrase(entry.stage)}. ${explainErrorCode(entry.errorCode) ?? ""}`.trim();
    case "rejected":
      return "Rejected";
  }
}

/** Whether this run is one a worker invocation would move. */
export function needsWorker(run: BoardRun): boolean {
  return stageOwner(run.stage) === "worker";
}

// ---------------------------------------------------------------------------
// Is anything actually happening?
// ---------------------------------------------------------------------------

/**
 * How long a run may be quiet before it is called stalled rather than working.
 *
 * updated_at moves when a stage *finishes*, so this has to be longer than the
 * slowest stage — a reasoning-tier call plus one repair retry — or every
 * normal run would be reported as broken halfway through. It also bounds the
 * dashboard's polling, and does so without a counter anywhere: a run that
 * stops moving crosses this line by the server's own clock, is reported as
 * stalled, and a stalled run is not polled.
 */
export const QUIET_BEFORE_STALLED_MS = 180_000;

/**
 * How long a stopped run stays in the live region after it stops.
 *
 * The panel exists to say what just happened. Without a cutoff it would
 * become a second, permanent copy of the board, telling an operator who opens
 * the page next week about last week's scan as though it were news.
 */
export const REPORT_STOPPED_FOR_MS = 600_000;

/**
 * What a run is doing, from the point of view of somebody watching it.
 *
 * `stageOwner` answers who owns the stage, which is what the orchestrator
 * dispatches on. This is the same question asked for a different purpose, and
 * it needs one distinction the orchestrator does not: a server-owned stage
 * that is being driven and one that was abandoned are the same stage, and
 * only the clock separates them.
 */
export const RUN_ACTIVITIES = [
  "working",
  "stalled",
  "waiting",
  "worker",
  "done",
  "failed",
  "rejected",
] as const;

export type RunActivity = (typeof RUN_ACTIVITIES)[number];

/**
 * Reads the stage, not the status.
 *
 * `status` and `current_stage` are two columns with nothing in the schema
 * tying them together, and the stage is what the orchestrator dispatches on.
 * Reading the same column here means the page and the workflow cannot come to
 * different conclusions about the same row.
 */
export function runActivity(run: BoardRun, asOf: Date): RunActivity {
  switch (stageOwner(run.stage)) {
    case "operator":
      return "waiting";
    case "worker":
      return "worker";
    case "nobody":
      if (run.stage === "failed") return "failed";
      if (run.stage === "rejected") return "rejected";
      return "done";
    case "server": {
      const quietFor = asOf.getTime() - run.updatedAt.getTime();

      return quietFor > QUIET_BEFORE_STALLED_MS ? "stalled" : "working";
    }
  }
}

/**
 * The stage in words a person watching would use.
 *
 * The enum is the orchestrator's vocabulary. Nobody waiting on a scan knows
 * what synthesis is, and a status line that made them learn would be a status
 * line they stop reading.
 */
export function stagePhrase(stage: ProductOpsStage): string {
  switch (stage) {
    case "research":
      // Shares a word with the stage the Runs table prints beside this, so
      // nobody has to map "reading the market" onto "research".
      return "researching the market";
    case "synthesis":
      return "writing up what it found";
    case "human_review":
      return "waiting for your decision";
    case "prd":
      return "drafting the PRD";
    case "code_plan":
      return "planning the change";
    case "plan_review":
      return "waiting for you to approve the plan";
    case "implementation":
      return "writing the code";
    case "verification":
      return "running the checks";
    case "pull_request":
      return "opening the pull request";
    case "completed":
      return "finished";
    case "failed":
      return "stopped";
    case "rejected":
      return "rejected";
  }
}

/** A scan, an implementation run — named the way the page talks about them. */
function runNoun(run: BoardRun): string {
  return run.runType === "manual_market_scan" ? "scan" : "run";
}

/** One sentence for the live region: what is happening, or what stopped it. */
function activityMessage(run: BoardRun, activity: RunActivity): string {
  const noun = runNoun(run);

  switch (activity) {
    case "working":
      return `The ${noun} is ${stagePhrase(run.stage)}.`;
    case "stalled":
      // The actionable one. Every stage is a resume point, so the honest
      // instruction is short — and it is an instruction, not a diagnosis.
      return `The ${noun} has not moved since ${stagePhrase(run.stage)}. Nudge it to pick up where it stopped.`;
    case "waiting":
      return `The ${noun} finished its part. It is your move now — ${stagePhrase(run.stage)}.`;
    case "worker":
      return `The ${noun} is waiting on the worker, which runs on a machine with a checkout.`;
    case "done":
      return `The ${noun} is finished.`;
    case "failed":
      // The code and its explanation are rendered beside this by the card,
      // so the sentence says only what happened. The run's stage is the
      // terminal one by now, and naming it would read as "stopped at stopped".
      return `The ${noun} stopped.`;
    case "rejected":
      return `You rejected this ${noun}.`;
  }
}

export interface RunReport {
  readonly run: BoardRun;
  readonly activity: RunActivity;
  readonly message: string;
  /** How long since anything happened, against the board's own clock. */
  readonly quietForMs: number;
}

/**
 * The runs worth putting in front of an operator right now.
 *
 * Everything in flight, plus anything that stopped recently — because "it
 * stopped, and here is why" is half the point of the panel and an operator
 * should not have to go looking for it. A stalled run never ages out: it is
 * unfinished business, and ageing out is how it would be forgotten.
 */
export function runReports(
  runs: readonly BoardRun[],
  asOf: Date,
): readonly RunReport[] {
  return runs
    .map((run) => {
      const activity = runActivity(run, asOf);

      return {
        run,
        activity,
        message: activityMessage(run, activity),
        quietForMs: Math.max(0, asOf.getTime() - run.updatedAt.getTime()),
      };
    })
    .filter(
      (report) =>
        report.activity === "working" ||
        report.activity === "stalled" ||
        report.quietForMs <= REPORT_STOPPED_FOR_MS,
    )
    .toSorted((left, right) => left.quietForMs - right.quietForMs);
}

/**
 * Whether the page should ask again.
 *
 * True only while something is genuinely moving. This is the whole bound on
 * the refresh loop, and it is derived from data the server produced rather
 * than from a deadline the browser keeps — a tab left open on a run that dies
 * stops polling within one stall window, whatever the browser believes.
 */
export function shouldPoll(reports: readonly RunReport[]): boolean {
  return reports.some((report) => report.activity === "working");
}

/**
 * The board's view of a run, from the full row.
 *
 * The detail page reads the whole run rather than the board, and it has the
 * same problem the board does: approving a proposal hands work back to the
 * server, and without this the page would go quiet for three background
 * stages. Every field is already on the row, so this is a projection and not
 * a second source of truth.
 */
export function boardRunFrom(run: ProductOpsRun): BoardRun {
  return {
    id: run.id,
    runType: run.runType,
    status: run.status,
    stage: run.currentStage,
    errorCode: run.errorCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Words for what a run is, and why it stopped
// ---------------------------------------------------------------------------

/** The run's kind in the words the page uses. */
export function runKindLabel(run: BoardRun): string {
  return run.runType === "manual_market_scan" ? "Market scan" : "Implementation";
}

/**
 * What an error code means, for a person.
 *
 * A code is all a failure carries — a provider message can quote the prompt
 * back — but a code on its own is a raw enum on a screen. This is the one
 * table that turns each into a sentence an operator can act on. Unknown codes
 * fall through to the code itself, so a new one is visible rather than hidden.
 */
const ERROR_EXPLANATIONS: Readonly<Record<string, string>> = {
  invalid_output:
    "The model's reply did not match the required structure, twice. Usually a one-off; run it again.",
  model_unavailable: "No model on the tier answered. A provider outage, or the tier has no endpoint for this account.",
  timeout:
    "Every model on the tier ran out of time or came back with a passing error. Usually the provider's moment, not yours; nudge it to try again.",
  over_budget: "The run reached its euro ceiling before this stage could finish.",
  run_budget: "The run reached its euro ceiling before this stage could start.",
  tool_limit: "The agent used up its tool-call allowance without finishing.",
  no_findings: "The research turned up nothing worth recording, so there was nothing to propose from.",
  no_proposal: "The run reached a stage that needs a proposal, and there is none.",
  no_prd: "The run reached a stage that needs a PRD, and there is none.",
  no_plan: "The run reached a stage that needs a plan, and there is none.",
  plan_not_approved: "Nothing is written until a person approves the plan. It was not approved.",
  no_workspace: "This stage needs a checkout, and the server has none. Run the worker.",
  workspace_unavailable: "The worker's working tree could not be read or written.",
  all_paths_denied: "Every file the plan named is one the agent may never touch.",
  nothing_applied: "The agent proposed edits, and the validation layer refused all of them.",
  stage_failed: "The changes could not be staged in git.",
  commit_failed: "The changes could not be committed.",
  push_failed: "The branch could not be pushed.",
  pull_request_refused: "GitHub refused to open the pull request.",
  typecheck: "The project's type check failed after one repair pass. The branch is kept for a person.",
  lint: "The project's lint failed after one repair pass. The branch is kept for a person.",
  test: "The project's tests failed after one repair pass. The branch is kept for a person.",
  build: "The project's build failed after one repair pass. The branch is kept for a person.",
  unavailable: "The database could not be read or written. Nothing was decided.",
  conflict: "Another worker recorded the same thing first.",
  invalid_request: "The stage asked the model for something its prompt entry will not accept.",
};

export function explainErrorCode(code: string | null): string | null {
  if (code === null) return null;
  return ERROR_EXPLANATIONS[code] ?? `Stopped with code ${code}.`;
}

/**
 * How long ago, in words. Coarse on purpose: an operator wants "3 min ago",
 * not a timestamp to subtract in their head.
 */
export function relativeTime(at: Date, asOf: Date): string {
  const seconds = Math.max(0, Math.round((asOf.getTime() - at.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Whether a run may be removed from the board.
 *
 * Only a run that ended without producing anything a person decided on: a
 * failed or rejected run is over, and if no proposal hangs off it there is no
 * audit trail to lose. Everything else stays — a rejected proposal is a
 * decision somebody made, and history is what the reviews table is for.
 */
export function isRemovable(run: BoardRun, hasProposal: boolean): boolean {
  return (run.stage === "failed" || run.stage === "rejected") && !hasProposal;
}

// ---------------------------------------------------------------------------
// The plan, as text a person takes away
// ---------------------------------------------------------------------------

/**
 * The plan rendered as Markdown.
 *
 * Deterministic from the stored columns, so the copy an operator takes is the
 * plan a person accepted and not a restatement. The workflow ends at the
 * plan; this is its deliverable.
 */
export function planMarkdown(
  title: string,
  plan: ImplementationPlan,
  breakdown: EngineeringBreakdown | null = null,
): string {
  const list = (items: readonly string[]) =>
    items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
  const paths = (items: readonly string[]) =>
    items.length === 0 ? "- none" : items.map((item) => `- \`${item}\``).join("\n");

  return [
    `# Implementation plan: ${title}`,
    "",
    ...(breakdown === null ? [] : [...breakdownMarkdown(breakdown), ""]),
    "## Files to modify",
    paths(plan.filesToModify),
    "",
    "## Files to create",
    paths(plan.filesToCreate),
    "",
    "## Tests",
    paths(plan.tests),
    "",
    "## Database changes",
    list(plan.databaseChanges),
    "",
    "## API changes",
    list(plan.apiChanges),
    "",
    "## UI changes",
    list(plan.uiChanges),
    "",
    "## Dependencies",
    list(plan.dependencies),
    "",
    "## Risks",
    list(plan.risks),
    "",
  ].join("\n");
}

/** A size, as it is written on the card and in the Markdown. */
export function sizeLabel(size: TShirtSize): string {
  return size.toUpperCase();
}

/**
 * The engineering manager's half, as Markdown: a table per phase, then the
 * guidance. Deterministic from the stored document, like the rest.
 */
export function breakdownMarkdown(breakdown: EngineeringBreakdown): readonly string[] {
  const lines: string[] = [
    "## Summary",
    breakdown.summary,
    "",
    `Overall size: **${sizeLabel(breakdown.overallSize)}**`,
    "",
    "## Phases",
  ];

  breakdown.phases.forEach((phase, index) => {
    lines.push(
      "",
      `### Phase ${index + 1}: ${phase.name}`,
      "",
      phase.goal,
      "",
      "| ID | Requirement | Size | Depends on |",
      "| --- | --- | --- | --- |",
      ...phase.requirements.map(
        (requirement) =>
          `| ${requirement.id} | ${requirement.title} | ${sizeLabel(requirement.size)} | ${
            requirement.dependsOn.length === 0 ? "—" : requirement.dependsOn.join(", ")
          } |`,
      ),
      "",
      ...phase.requirements.map(
        (requirement) => `- **${requirement.id}** — ${requirement.description}`,
      ),
    );
  });

  lines.push("", "## Technical guidance");
  for (const guidance of breakdown.technicalGuidance) {
    lines.push(
      "",
      `### ${guidance.topic}`,
      "",
      `- **Now:** ${guidance.current}`,
      `- **Recommendation:** ${guidance.recommendation}`,
      `- **For:** ${guidance.pros.join("; ")}`,
      `- **Against:** ${guidance.cons.join("; ")}`,
    );
  }

  return lines;
}
