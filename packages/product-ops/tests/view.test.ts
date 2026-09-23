import { describe, expect, it } from "vitest";

import {
  PRODUCT_OPS_STAGES,
  PROPOSAL_STATUSES,
  type BoardProposal,
  type ImplementationPlan,
  type BoardRun,
  type ProductOpsBoard,
  type ProductOpsRun,
  type ProposalStatus,
  type RunEvent,
} from "@dp/domain/product-ops";
import type { TimelineEntry } from "../src/view";
import {
  LIVE_FEED_LENGTH,
  describeTimelineEntry,
  planMarkdown,
  explainErrorCode,
  isRemovable,
  liveRunEventSchema,
  liveTimelineEventFrom,
  liveTimelineEventSchema,
  timelineEntryFrom,
  relativeTime,
  runKindLabel,
  COLUMN_STATUSES,
  QUIET_BEFORE_STALLED_MS,
  REPORT_STOPPED_FOR_MS,
  boardColumns,
  boardRunFrom,
  boardTotals,
  nextStep,
  needsWorker,
  runActivity,
  runReports,
  shouldPoll,
  stagePhrase,
  timelineEntries,
  waitingLabel,
  workerCommandFor,
} from "../src/view";

/**
 * The operator's view of the pipeline.
 *
 * Two properties are worth holding to account. Every proposal status has to
 * land in exactly one column, or a proposal disappears off the board while
 * still being in the database — the failure mode of any hand-written grouping.
 * And every stage has to say whose move it is, because a workflow with two
 * human gates and four stages only a CLI worker can run has three quite
 * different kinds of "in progress".
 */

const PROPOSAL: BoardProposal = {
  id: "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  runId: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
  title: "Medical German module",
  titleSlug: "medical-german-module",
  status: "pending_review",
  complexity: "medium",
  priorityScore: 78,
  createdAt: new Date("2026-09-10T10:00:00.000Z"),
  updatedAt: new Date("2026-09-10T10:00:00.000Z"),
  runStage: "human_review",
  runStatus: "awaiting_review",
  reviewCount: 0,
  hasPrd: false,
  hasPlan: false,
  pullRequest: null,
};

const RUN: BoardRun = {
  id: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
  runType: "manual_market_scan",
  status: "awaiting_review",
  stage: "human_review",
  errorCode: null,
  startedAt: new Date("2026-09-10T10:00:00.000Z"),
  completedAt: null,
  updatedAt: new Date("2026-09-10T10:00:00.000Z"),
};

function board(over: Partial<ProductOpsBoard> = {}): ProductOpsBoard {
  return {
    generatedAt: new Date("2026-09-10T12:00:00.000Z"),
    proposals: [PROPOSAL],
    runs: [RUN],
    ...over,
  };
}

describe("the columns", () => {
  it("gives every proposal status exactly one home", () => {
    // A status in no column is a proposal that exists and cannot be seen; a
    // status in two is one that appears twice. Both are silent.
    for (const status of PROPOSAL_STATUSES) {
      const homes = COLUMN_STATUSES.filter((claimed) => claimed === status);

      expect(homes, status).toHaveLength(1);
    }
  });

  it("claims no status that is not a status", () => {
    for (const claimed of COLUMN_STATUSES) {
      expect(PROPOSAL_STATUSES).toContain(claimed);
    }
  });

  it("puts a proposal awaiting a decision in the first column", () => {
    const [first] = boardColumns(board());

    expect(first.label).toMatch(/awaiting you/i);
    expect(first.proposals.map((proposal) => proposal.id)).toEqual([PROPOSAL.id]);
  });

  it("puts a plan awaiting approval there too", () => {
    // The second gate is as much a decision as the first, and an operator
    // should not have to know that a plan is a different kind of waiting.
    const [first] = boardColumns(
      board({ proposals: [{ ...PROPOSAL, status: "plan_ready" }] }),
    );

    expect(first.proposals).toHaveLength(1);
  });

  it("keeps a rejected proposal apart from a failed one's column-mates", () => {
    const columns = boardColumns(
      board({
        proposals: [
          { ...PROPOSAL, id: "a", status: "rejected" as ProposalStatus },
          { ...PROPOSAL, id: "b", status: "pr_open" as ProposalStatus },
        ],
      }),
    );
    const closed = columns.find((column) => column.key === "closed");
    const review = columns.find((column) => column.key === "review");

    expect(closed?.proposals.map((proposal) => proposal.id)).toEqual(["a"]);
    expect(review?.proposals.map((proposal) => proposal.id)).toEqual(["b"]);
  });
});

describe("the totals", () => {
  it("counts what is waiting on a person separately from what is running", () => {
    const totals = boardTotals(
      board({
        runs: [
          RUN,
          { ...RUN, id: "b", stage: "research", status: "running" },
          { ...RUN, id: "c", stage: "implementation", status: "running" },
          { ...RUN, id: "d", stage: "failed", status: "failed" },
        ],
      }),
    );

    expect(totals.awaitingYou).toBe(1);
    expect(totals.running).toBe(1);
    expect(totals.awaitingWorker).toBe(1);
    expect(totals.failed).toBe(1);
  });

  it("counts nothing on an empty board", () => {
    const totals = boardTotals(board({ proposals: [], runs: [] }));

    expect(totals).toMatchObject({ proposals: 0, awaitingYou: 0, failed: 0 });
  });
});

describe("whose move it is", () => {
  it("answers for every stage in the union", () => {
    for (const stage of PRODUCT_OPS_STAGES) {
      expect(waitingLabel(stage), stage).not.toBe("");
    }
  });

  it("names the person at both gates, the worker at the three write stages, and the server for planning", () => {
    expect(waitingLabel("human_review")).toBe("You");
    expect(waitingLabel("plan_review")).toBe("You");
    for (const stage of ["implementation", "verification", "pull_request"] as const) {
      expect(waitingLabel(stage), stage).toBe("The worker");
    }
    // Planning only reads, so the server does it and the run reaches the plan
    // gate without a worker.
    expect(waitingLabel("code_plan")).toBe("Running");
    expect(waitingLabel("research")).toBe("Running");
    expect(waitingLabel("completed")).toBe("Nothing");
  });

  it("says which run a worker invocation would move", () => {
    expect(needsWorker({ ...RUN, stage: "implementation" })).toBe(true);
    expect(needsWorker({ ...RUN, stage: "human_review" })).toBe(false);
    expect(needsWorker({ ...RUN, stage: "research" })).toBe(false);
  });
});

describe("the next step", () => {
  it("tells the operator to approve at the first gate and to decide on the plan at the second", () => {
    expect(nextStep(PROPOSAL)).toMatch(/approve it/i);
    // The plan is the deliverable: read it, copy it, then decide.
    expect(nextStep({ ...PROPOSAL, runStage: "plan_review" })).toMatch(
      /accept or reject/i,
    );
  });

  it("points at the worker without pretending the page can run it", () => {
    const step = nextStep({ ...PROPOSAL, runStage: "implementation" });

    expect(step).toMatch(/worker/i);
    // The command is shown beside the sentence, not inside it: it is something
    // to copy.
    expect(step).not.toContain(workerCommandFor(PROPOSAL.id));
  });

  it("distinguishes a finished run from a stopped one", () => {
    expect(
      nextStep({ ...PROPOSAL, runStage: "completed", runStatus: "completed" }),
    ).toMatch(/nothing left/i);
    expect(
      nextStep({ ...PROPOSAL, runStage: "failed", runStatus: "failed" }),
    ).toMatch(/stopped/i);
  });

  it("names the proposal in the command, so two runs are not confused", () => {
    expect(workerCommandFor(PROPOSAL.id)).toContain(PROPOSAL.id);
  });
});

describe("the timeline", () => {
  function event(over: Partial<RunEvent> = {}): RunEvent {
    return {
      id: 1,
      runId: RUN.id,
      stage: "research",
      status: "ok",
      detail: {},
      createdAt: new Date("2026-09-10T10:00:00.000Z"),
      ...over,
    };
  }

  it("tells arriving at a stage apart from finishing one", () => {
    const entries = timelineEntries([
      event({ id: 1, stage: "research", status: "ok" }),
      event({ id: 2, stage: "synthesis", status: "started" }),
    ]);

    expect(entries[0].entered).toBe(false);
    expect(entries[1].entered).toBe(true);
  });

  it("surfaces an error code and no message", () => {
    const [entry] = timelineEntries([
      event({ status: "failed", detail: { errorCode: "over_budget" } }),
    ]);

    expect(entry.errorCode).toBe("over_budget");
  });

  it("reads a cost the stage recorded and treats a missing one as free", () => {
    const [priced, free] = timelineEntries([
      event({ id: 1, detail: { costEur: 0.004 } }),
      event({ id: 2, detail: { from: "research" } }),
    ]);

    expect(priced.costEur).toBeCloseTo(0.004, 10);
    expect(free.costEur).toBe(0);
  });

  it("renders whatever else the detail carried, without recursing into it", () => {
    // detail is jsonb with no constraint. A page that assumed its shape would
    // be a page one odd row takes down.
    const [entry] = timelineEntries([
      event({
        detail: {
          costEur: 0.001,
          denied: ["package.json", "proxy.ts"],
          nested: { deep: { deeper: true } },
        },
      }),
    ]);

    const labels = entry.notes.map((note) => note.label);
    expect(labels).toContain("denied");
    expect(labels).not.toContain("costEur");
    expect(
      entry.notes.find((note) => note.label === "denied")?.value,
    ).toBe("package.json, proxy.ts");
    expect(
      entry.notes.find((note) => note.label === "nested")?.value.length,
    ).toBeLessThanOrEqual(120);
  });
});

describe("the live feed", () => {
  function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
    return {
      id: 1,
      stage: "research",
      status: "progress",
      entered: false,
      costEur: 0,
      errorCode: null,
      notes: [],
      at: new Date("2026-09-10T10:00:00.000Z"),
      ...over,
    };
  }

  const progress = (notes: Record<string, string>) =>
    entry({ notes: Object.entries(notes).map(([label, value]) => ({ label, value })) });

  it("puts a tool call into the words a person would use", () => {
    expect(describeTimelineEntry(progress({ tool: "search_market", ok: "true" }))).toBe(
      "Searched the web",
    );
    expect(describeTimelineEntry(progress({ tool: "read_file", ok: "true" }))).toBe(
      "Read a source file",
    );
  });

  it("says when a tool call failed", () => {
    expect(describeTimelineEntry(progress({ tool: "search_market", ok: "false" }))).toMatch(
      /which failed/,
    );
  });

  it("names a tool it has no words for rather than hiding it", () => {
    expect(describeTimelineEntry(progress({ tool: "brand_new_tool", ok: "true" }))).toBe(
      "Used brand_new_tool",
    );
  });

  it("says a model call happened, and no more than that", () => {
    expect(describeTimelineEntry(progress({ model: "call" }))).toBe("The model replied");
  });

  it("says when a stage is starting again after a retry", () => {
    expect(
      describeTimelineEntry(
        entry({
          status: "started",
          stage: "prd",
          notes: [
            { label: "from", value: "failed" },
            { label: "retry", value: "true" },
          ],
        }),
      ),
    ).toBe("Started drafting the PRD again");
  });

  it("brackets the progress rows with the stage in words", () => {
    expect(describeTimelineEntry(entry({ status: "started", stage: "synthesis" }))).toBe(
      "Started writing up what it found",
    );
    expect(
      describeTimelineEntry(
        entry({
          status: "ok",
          stage: "research",
          notes: [
            { label: "searches", value: "4" },
            { label: "findings", value: "3" },
            { label: "agent", value: "research" },
          ],
        }),
      ),
    ).toBe("Finished researching the market — 4 searches, 3 findings");
    expect(describeTimelineEntry(entry({ status: "already_done", stage: "prd" }))).toMatch(
      /already done/,
    );
  });

  it("explains a failure with the same words the card uses, and never a message", () => {
    const line = describeTimelineEntry(
      entry({ status: "failed", stage: "synthesis", errorCode: "timeout" }),
    );

    expect(line).toMatch(/^Stopped while writing up what it found/);
    expect(line).toContain(explainErrorCode("timeout"));
  });

  it("carries an entry over the wire and back unchanged", () => {
    const original = entry({
      id: 9,
      costEur: 0.02,
      errorCode: "over_budget",
      notes: [{ label: "tool", value: "read_prd" }],
    });

    const wire = liveTimelineEventFrom(original);
    const parsed = liveTimelineEventSchema.parse(JSON.parse(JSON.stringify(wire)));

    expect(timelineEntryFrom(parsed)).toEqual(original);
  });

  it("refuses a frame with a stage that is not a stage", () => {
    expect(
      liveTimelineEventSchema.safeParse({ ...liveTimelineEventFrom(entry()), stage: "elsewhere" })
        .success,
    ).toBe(false);
    expect(
      liveRunEventSchema.safeParse({
        stage: "research",
        status: "running",
        errorCode: null,
        updatedAt: "not a date",
      }).success,
    ).toBe(false);
  });

  it("shows a tail short enough to read at a glance", () => {
    expect(LIVE_FEED_LENGTH).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Is anything actually happening?
// ---------------------------------------------------------------------------

/**
 * The distinction this whole section exists for.
 *
 * A run sitting at a server-owned stage looks exactly the same whether a
 * background drive is working through it or the process that was driving it
 * died three days ago. The page had no way to tell those apart, so any spinner
 * it drew was a guess — and the bad case is not a missing spinner, it is a
 * spinner that turns forever on a run nobody is driving.
 *
 * The run's own updated_at is the evidence: every stage transition touches it.
 * Quiet for longer than a stage could plausibly take means stalled, and a
 * stalled run gets the Nudge button rather than an animation.
 */

const AT = new Date("2026-09-10T12:00:00.000Z");

function run(over: Partial<BoardRun> = {}): BoardRun {
  return {
    ...RUN,
    status: "running",
    stage: "research",
    startedAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/** `ms` before the moment the board was generated. */
function quietFor(ms: number): Date {
  return new Date(AT.getTime() - ms);
}

describe("whether a run is being worked on", () => {
  it("calls a freshly-moved server stage working", () => {
    expect(runActivity(run({ updatedAt: quietFor(2_000) }), AT)).toBe("working");
  });

  it("calls a server stage that has gone quiet stalled", () => {
    // The background drive died, the deployment restarted, a stage raced and
    // lost. All three look identical from here, and all three want the same
    // thing from an operator: a nudge.
    expect(
      runActivity(run({ updatedAt: quietFor(QUIET_BEFORE_STALLED_MS + 1_000) }), AT),
    ).toBe("stalled");
  });

  it("allows a stage long enough to actually run before calling it stalled", () => {
    // A reasoning-tier call plus one repair retry is the slowest stage here,
    // and updated_at only moves when a stage *finishes*. A threshold tighter
    // than the slowest stage would report every normal run as broken.
    expect(QUIET_BEFORE_STALLED_MS).toBeGreaterThanOrEqual(120_000);

    expect(
      runActivity(run({ updatedAt: quietFor(QUIET_BEFORE_STALLED_MS - 1_000) }), AT),
    ).toBe("working");
  });

  it("never calls a run at a human gate stalled, however long it waits", () => {
    // A proposal can sit unreviewed over a weekend. That is the workflow
    // working, and reporting it as a fault would train an operator to ignore
    // the one signal that means something is wrong.
    const waiting = run({
      stage: "human_review",
      status: "awaiting_review",
      updatedAt: quietFor(72 * 60 * 60 * 1000),
    });

    expect(runActivity(waiting, AT)).toBe("waiting");
  });

  it("never calls a run waiting on the worker stalled either", () => {
    const waiting = run({
      stage: "implementation",
      updatedAt: quietFor(72 * 60 * 60 * 1000),
    });

    expect(runActivity(waiting, AT)).toBe("worker");
  });

  it.each([
    ["completed", "done"],
    ["failed", "failed"],
    ["rejected", "rejected"],
  ] as const)("reports a %s run as %s", (stage, expected) => {
    expect(runActivity(run({ stage, status: stage }), AT)).toBe(expected);
  });

  it("trusts the stage over a status that disagrees with it", () => {
    // status and current_stage are two columns and nothing in the schema ties
    // them together. The stage is what the orchestrator dispatches on, so it
    // is what this reads too — one definition, not a second opinion.
    expect(runActivity(run({ stage: "failed", status: "running" }), AT)).toBe(
      "failed",
    );
  });
});

describe("what the operator is told", () => {
  it("names the stage in words a person would use", () => {
    // 'synthesis' is the orchestrator's word. Nobody watching a scan knows it.
    expect(stagePhrase("research")).toMatch(/research/i);
    expect(stagePhrase("synthesis")).not.toMatch(/synthesis/i);
  });

  it("has a phrase for every stage, so no run can render a raw enum", () => {
    for (const stage of PRODUCT_OPS_STAGES) {
      const phrase = stagePhrase(stage);

      expect(phrase.length, stage).toBeGreaterThan(0);
      expect(phrase, stage).not.toContain("_");
    }
  });

  it("says what is happening while it works", () => {
    const [report] = runReports([run()], AT);

    expect(report.activity).toBe("working");
    expect(report.message).toMatch(/research/i);
  });

  it("says a scan finished, and that it is now the operator's move", () => {
    const [report] = runReports([run({ stage: "human_review", status: "awaiting_review" })], AT);

    expect(report.activity).toBe("waiting");
    expect(report.message).toMatch(/your|you/i);
  });

  it("says only that a run stopped; the code and its explanation sit beside it", () => {
    // The card renders explainErrorCode(run.errorCode) next to this sentence,
    // so repeating the code here would print it twice — and naming the stage
    // would read as "stopped at stopped", the terminal stage being "failed".
    const [report] = runReports([run({ stage: "failed", status: "failed", errorCode: "run_budget" })], AT);

    expect(report.message).toBe("The scan stopped.");
    expect(report.message).not.toContain("run_budget");
    expect(report.message).not.toMatch(/at stopped/);
  });

  it("tells an operator what to do about a stalled run", () => {
    const [report] = runReports([run({ updatedAt: quietFor(QUIET_BEFORE_STALLED_MS + 60_000) })], AT);

    expect(report.activity).toBe("stalled");
    expect(report.message).toMatch(/nudge/i);
  });
});

describe("which runs the live region reports at all", () => {
  it("reports a run that is working", () => {
    expect(runReports([run()], AT)).toHaveLength(1);
  });

  it("reports one that stopped a moment ago, which is the point of the panel", () => {
    const justFinished = run({
      stage: "human_review",
      status: "awaiting_review",
      updatedAt: quietFor(5_000),
    });

    expect(runReports([justFinished], AT)).toHaveLength(1);
  });

  it("stops reporting a run that stopped long ago", () => {
    // Otherwise the panel becomes a second, permanent copy of the board, and
    // an operator opening the page next week is told about last week's scan
    // as though it just happened.
    const old = run({
      stage: "completed",
      status: "completed",
      updatedAt: quietFor(REPORT_STOPPED_FOR_MS + 60_000),
    });

    expect(runReports([old], AT)).toEqual([]);
  });

  it("keeps reporting a stalled run however long it has been quiet", () => {
    // A stalled run is unfinished business. It does not age out of the panel,
    // because ageing out is how it would be forgotten.
    const stalled = run({ updatedAt: quietFor(30 * 24 * 60 * 60 * 1000) });

    const [report] = runReports([stalled], AT);
    expect(report.activity).toBe("stalled");
  });

  it("puts the newest first, so a fresh scan is not below a week of history", () => {
    const older = run({ id: "old", updatedAt: quietFor(60_000) });
    const newer = run({ id: "new", updatedAt: quietFor(1_000) });

    expect(
      runReports([older, newer], AT).map((report) => report.run.id),
    ).toEqual(["new", "old"]);
  });
});

describe("whether the page should keep asking", () => {
  it("polls while something is working", () => {
    expect(shouldPoll(runReports([run()], AT))).toBe(true);
  });

  it.each([
    ["a human gate", { stage: "human_review", status: "awaiting_review" }],
    ["the worker", { stage: "implementation" }],
    ["a finished run", { stage: "completed", status: "completed" }],
    ["a failed run", { stage: "failed", status: "failed" }],
  ] as const)("stops polling at %s", (_label, over) => {
    expect(shouldPoll(runReports([run(over)], AT))).toBe(false);
  });

  it("stops polling a stalled run, rather than refreshing forever", () => {
    // This is what bounds the polling: nothing else counts attempts or sets a
    // deadline. A working run that stops moving becomes stalled by the
    // server's own clock, and the next refresh is the last one.
    const stalled = run({ updatedAt: quietFor(QUIET_BEFORE_STALLED_MS + 1_000) });

    expect(shouldPoll(runReports([stalled], AT))).toBe(false);
  });

  it("polls when any one of several runs is working", () => {
    const runs = [
      run({ id: "a", stage: "completed", status: "completed" }),
      run({ id: "b" }),
    ];

    expect(shouldPoll(runReports(runs, AT))).toBe(true);
  });

  it("does not poll an empty board", () => {
    expect(shouldPoll(runReports([], AT))).toBe(false);
  });
});

describe("reporting on the one run a detail page read", () => {
  it("projects a full run row onto the board's view of it", () => {
    // The detail page has the same blind spot the board did: approving a
    // proposal hands work back to the server for three background stages. It
    // reads the whole run rather than the board, so it needs a projection
    // rather than a second definition of what a run is doing.
    const full: ProductOpsRun = {
      id: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
      runType: "manual_market_scan",
      status: "running",
      currentStage: "prd",
      operatorIdHash: "a".repeat(64),
      requestId: null,
      brief: "German learning for English speakers",
      errorCode: null,
      startedAt: quietFor(30_000),
      completedAt: null,
      createdAt: quietFor(30_000),
      updatedAt: quietFor(5_000),
    };

    const [report] = runReports([boardRunFrom(full)], AT);

    expect(report.activity).toBe("working");
    expect(report.message).toMatch(/prd/i);
  });

  it("carries the timestamp the staleness check depends on", () => {
    // The one field that would break silently: a projection dropping it would
    // leave every run looking freshly moved, and the spinner would never stop.
    const moved = quietFor(QUIET_BEFORE_STALLED_MS + 1_000);
    const full: ProductOpsRun = {
      id: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
      runType: "feature_implementation",
      status: "running",
      currentStage: "prd",
      operatorIdHash: "a".repeat(64),
      requestId: null,
      brief: null,
      errorCode: null,
      startedAt: moved,
      completedAt: null,
      createdAt: moved,
      updatedAt: moved,
    };

    expect(boardRunFrom(full).updatedAt).toEqual(moved);
    expect(runActivity(boardRunFrom(full), AT)).toBe("stalled");
  });
});

describe("the plan as Markdown", () => {
  const plan: ImplementationPlan = {
    filesToModify: ["learning/curriculum.ts"],
    filesToCreate: [],
    databaseChanges: [],
    apiChanges: [],
    uiChanges: [],
    tests: ["tests/unit/learning/medical.test.ts"],
    dependencies: [],
    risks: ["Scope"],
  };
  const breakdown = {
  summary: "Ship the vocabulary set first, then the scenario pack on top of it.",
  overallSize: "l",
  phases: [
    {
      name: "Vocabulary",
      goal: "A learner can drill the clinical terms.",
      requirements: [
        { id: "R1", title: "Clinical vocabulary set", description: "Twenty terms with articles and plurals in the vocabulary table.", size: "s", dependsOn: [] },
        { id: "R2", title: "Module card", description: "The module appears on the curriculum page.", size: "xs", dependsOn: ["R1"] },
      ],
    },
    {
      name: "Scenarios",
      goal: "A learner can rehearse a handover.",
      requirements: [
        { id: "R3", title: "Handover scenario", description: "One scenario using the set.", size: "m", dependsOn: ["R1"] },
      ],
    },
  ],
  technicalGuidance: [
    {
      topic: "Scenario storage",
      current: "Scenarios live in Postgres with pgvector embeddings, ingested offline.",
      recommendation: "Keep it; one more scenario is one more row.",
      pros: ["No new moving part"],
      cons: ["Offline ingestion is a manual step"],
    },
  ],
} as const;

  it("renders the file lists alone when there is no breakdown", () => {
    const text = planMarkdown("Medical German", plan);

    expect(text).toContain("# Implementation plan: Medical German");
    expect(text).toContain("- `learning/curriculum.ts`");
    expect(text).not.toContain("## Phases");
  });

  it("puts the breakdown first, as a table per phase and the guidance after", () => {
    const text = planMarkdown("Medical German", plan, breakdown as never);

    expect(text.indexOf("## Summary")).toBeLessThan(text.indexOf("## Files to modify"));
    expect(text).toContain("Overall size: **L**");
    expect(text).toContain("### Phase 1: Vocabulary");
    expect(text).toContain("| R2 | Module card | XS | R1 |");
    expect(text).toContain("| R1 | Clinical vocabulary set | S | — |");
    expect(text).toContain("### Scenario storage");
    expect(text).toContain("- **Now:** Scenarios live in Postgres");
    expect(text).toContain("- **Against:** Offline ingestion is a manual step");
  });
});

describe("words for a run", () => {
  it("names the kind the way the page talks about it", () => {
    expect(runKindLabel(RUN)).toBe("Market scan");
    expect(runKindLabel({ ...RUN, runType: "feature_implementation" })).toBe("Implementation");
  });

  it("explains every code the workflow can record, in a sentence", () => {
    for (const code of [
      "invalid_output",
      "model_unavailable",
      "run_budget",
      "no_findings",
      "plan_not_approved",
      "all_paths_denied",
      "typecheck",
      "unavailable",
    ]) {
      const explained = explainErrorCode(code) ?? "";
      expect(explained.length, code).toBeGreaterThan(20);
      expect(explained, code).not.toBe(code);
    }
  });

  it("shows an unknown code rather than hiding it", () => {
    expect(explainErrorCode("something_new")).toContain("something_new");
    expect(explainErrorCode(null)).toBeNull();
  });

  it("says how long ago in words a person would use", () => {
    const asOf = new Date("2026-09-10T12:00:00.000Z");
    const ago = (seconds: number) => new Date(asOf.getTime() - seconds * 1000);

    expect(relativeTime(ago(10), asOf)).toBe("just now");
    expect(relativeTime(ago(180), asOf)).toBe("3 min ago");
    expect(relativeTime(ago(2 * 3600), asOf)).toBe("2 h ago");
    expect(relativeTime(ago(3 * 86400), asOf)).toBe("3 d ago");
  });

  it("lets only a run that stopped and left nothing behind be removed", () => {
    expect(isRemovable({ ...RUN, stage: "failed", status: "failed" }, false)).toBe(true);
    expect(isRemovable({ ...RUN, stage: "rejected", status: "rejected" }, false)).toBe(true);
    // A proposal hangs off it: its reviews are the audit trail.
    expect(isRemovable({ ...RUN, stage: "failed", status: "failed" }, true)).toBe(false);
    // Still moving, or finished successfully: not this button's business.
    expect(isRemovable(RUN, false)).toBe(false);
    expect(isRemovable({ ...RUN, stage: "completed", status: "completed" }, false)).toBe(false);
  });
});
