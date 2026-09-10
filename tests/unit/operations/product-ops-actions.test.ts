import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiters } from "@/lib/api/rate-limit";

/**
 * The operator's actions.
 *
 * These are the entry points, not the page. An action is reachable by anyone
 * who can post to this deployment and has never rendered the page whose
 * operator check it would be inheriting, so what is tested here is that each
 * one refuses on its own — silently, without saying whether there was anything
 * to refuse, and before touching the store.
 *
 * The second thing tested is attribution. A privileged action recorded against
 * nobody is the one row this audit trail cannot afford, so an unset
 * observability salt refuses the action rather than filing it anonymously.
 */

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const HASH = "0123456789abcdef0123456789abcdef";
const PROPOSAL = "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const RUN = "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f";

const currentUser = vi.fn();
const operatorIds = vi.fn(() => [OPERATOR]);
const pseudonym = vi.fn(() => HASH);
const startRun = vi.fn();
const getProposal = vi.fn();
const getRun = vi.fn();
const findProposalForRun = vi.fn();
const deleteRun = vi.fn();
const applyReview = vi.fn();
const driveRun = vi.fn(async (_deps: unknown, _runId: unknown) => ({}));
const refresh = vi.fn();
const scheduled: Array<() => Promise<unknown>> = [];
const logged: Array<{ event: string; fields: Record<string, unknown> }> = [];

const logger = {
  debug: vi.fn(),
  info: (event: string, fields: Record<string, unknown> = {}) => {
    logged.push({ event, fields });
  },
  warn: (event: string, fields: Record<string, unknown> = {}) => {
    logged.push({ event, fields });
  },
  error: (event: string, fields: Record<string, unknown> = {}) => {
    logged.push({ event, fields });
  },
};

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("next/server", () => ({
  after: (work: () => Promise<unknown>) => {
    scheduled.push(work);
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireAuthenticatedUserId: () => currentUser(),
}));
vi.mock("@/lib/auth/operator", () => ({
  isOperator: (id: string | null) => id !== null && operatorIds().includes(id),
}));
vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: () => pseudonym(),
  createProductOpsGraph: () => ({
    runs: { startRun, getProposal, getRun, findProposalForRun, deleteRun },
    workflow: { runs: { startRun, getProposal }, gateway: {}, logger },
    logger,
  }),
}));
vi.mock("@/lib/product-ops/workflow", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/product-ops/workflow")
  >("@/lib/product-ops/workflow");

  return {
    ...actual,
    applyReview: (deps: unknown, request: unknown) => applyReview(deps, request),
  };
});
vi.mock("@/lib/product-ops/graph/graph", () => ({
  driveRunGraph: (deps: unknown, runId: unknown) => driveRun(deps, runId),
}));

const { advanceRunAction, removeRunAction, reviewProposalAction, startScanAction } = await import(
  "@/app/(app)/operations/product/actions"
);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiters();
  scheduled.length = 0;
  logged.length = 0;
  currentUser.mockResolvedValue(OPERATOR);
  operatorIds.mockReturnValue([OPERATOR]);
  pseudonym.mockReturnValue(HASH);
  startRun.mockResolvedValue({
    ok: true,
    data: { id: RUN, runType: "manual_market_scan" },
  });
  getProposal.mockResolvedValue({ ok: true, data: { id: PROPOSAL, runId: RUN } });
  applyReview.mockResolvedValue({
    ok: true,
    data: {
      review: { status: "approved", priorityScore: 78 },
      advance: { status: "advanced", stage: "prd", outcome: null, costEur: 0, detail: null },
      runId: RUN,
    },
  });
});

describe("a learner who is not an operator", () => {
  beforeEach(() => {
    currentUser.mockResolvedValue(LEARNER);
  });

  it("cannot start a scan, and is not told why", async () => {
    await expect(
      startScanAction(form({ brief: "healthcare German" })),
    ).resolves.toBeUndefined();

    expect(startRun).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
    // Not even a revalidation: nothing about the response should differ.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cannot nudge a run", async () => {
    await advanceRunAction(form({ runId: RUN }));

    expect(scheduled).toEqual([]);
  });

  it("cannot approve a proposal", async () => {
    await reviewProposalAction(form({ proposalId: PROPOSAL, action: "approve" }));

    expect(applyReview).not.toHaveBeenCalled();
  });
});

describe("an operator", () => {
  it("starts a run with the brief they typed", async () => {
    await startScanAction(form({ brief: "healthcare German" }));

    expect(startRun).toHaveBeenCalledWith({
      runType: "manual_market_scan",
      operatorIdHash: HASH,
      requestId: null,
      brief: "healthcare German",
    });
  });

  it("falls back to a general scan when the field is blank", async () => {
    await startScanAction(form({ brief: "   " }));

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ brief: expect.stringMatching(/German/i) }),
    );
  });

  it("records the run as an audit event under their pseudonym", async () => {
    await startScanAction(form({ brief: "healthcare German" }));

    const audit = logged.find((line) => line.event === "productops.run_started");
    expect(audit?.fields.audit).toBe(true);
    // The pseudonym, never the learner id: this history has to survive an
    // account deletion.
    expect(audit?.fields.userIdHash).toBe(HASH);
    expect(JSON.stringify(logged)).not.toContain(OPERATOR);
  });

  it("drives the run after the response rather than during it", async () => {
    await startScanAction(form({ brief: "healthcare German" }));

    // Nothing has run yet: a scan is several model calls and the page should
    // not be holding a request open for them.
    expect(driveRun).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    await scheduled[0]();
    expect(driveRun).toHaveBeenCalledTimes(1);
  });

  it("is rate limited, and the refusal is as silent as any other", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await startScanAction(form({ brief: "healthcare German" }));
    }
    startRun.mockClear();

    await startScanAction(form({ brief: "healthcare German" }));

    expect(startRun).not.toHaveBeenCalled();
  });

  it("records a review and drives the run on when the decision moved it", async () => {
    await reviewProposalAction(
      form({ proposalId: PROPOSAL, action: "approve", priority: "", comment: "" }),
    );

    expect(applyReview).toHaveBeenCalledWith(
      expect.anything(),
      {
        proposalId: PROPOSAL,
        action: "approve",
        newPriority: null,
        comment: null,
        operatorIdHash: HASH,
      },
    );
    expect(scheduled).toHaveLength(1);
  });

  it("drives nothing when the decision left the run where it was", async () => {
    applyReview.mockResolvedValue({
      ok: true,
      data: {
        review: { status: "pending_review", priorityScore: 78 },
        advance: { status: "waiting", stage: "human_review", outcome: null, costEur: 0, detail: null },
        runId: RUN,
      },
    });

    await reviewProposalAction(
      form({ proposalId: PROPOSAL, action: "comment", comment: "Not yet." }),
    );

    expect(scheduled).toEqual([]);
    expect(refresh).toHaveBeenCalled();
  });

  it("passes a priority change through as a number", async () => {
    await reviewProposalAction(
      form({ proposalId: PROPOSAL, action: "reprioritise", priority: "40" }),
    );

    expect(applyReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ newPriority: 40 }),
    );
  });

  it("refuses a priority that is not a number at all", async () => {
    await reviewProposalAction(
      form({ proposalId: PROPOSAL, action: "reprioritise", priority: "lots" }),
    );

    expect(applyReview).not.toHaveBeenCalled();
  });

  it("refuses a review action outside the closed set", async () => {
    await reviewProposalAction(
      form({ proposalId: PROPOSAL, action: "merge_it_now" }),
    );

    expect(applyReview).not.toHaveBeenCalled();
  });

  it("refuses a proposal id that is not an id", async () => {
    await reviewProposalAction(form({ proposalId: "../../etc", action: "approve" }));

    expect(applyReview).not.toHaveBeenCalled();
  });
});

describe("when the observability salt is unset", () => {
  it("refuses rather than file a privileged action against nobody", async () => {
    pseudonym.mockImplementation(() => {
      throw new Error("LOG_PSEUDONYM_SALT: is required for this operation");
    });

    await startScanAction(form({ brief: "healthcare German" }));

    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("removing a run", () => {
  const failedRun = {
    id: RUN,
    status: "failed",
    currentStage: "failed",
    errorCode: "no_findings",
  };

  beforeEach(() => {
    resetRateLimiters();
    currentUser.mockResolvedValue(OPERATOR);
    getRun.mockReset();
    findProposalForRun.mockReset();
    deleteRun.mockReset();
    deleteRun.mockResolvedValue({ ok: true, data: undefined });
  });

  it("is a silent no-op for a learner who is not an operator", async () => {
    currentUser.mockResolvedValue(LEARNER);

    await removeRunAction(form({ runId: RUN }));

    expect(getRun).not.toHaveBeenCalled();
    expect(deleteRun).not.toHaveBeenCalled();
  });

  it("removes a failed run with no proposal, and records who did", async () => {
    getRun.mockResolvedValue({ ok: true, data: failedRun });
    findProposalForRun.mockResolvedValue({ ok: true, data: null });

    await removeRunAction(form({ runId: RUN }));

    expect(deleteRun).toHaveBeenCalledWith(RUN);
    expect(
      logged.find((line) => line.event === "productops.run_removed")?.fields,
    ).toMatchObject({ audit: true, runId: RUN, userIdHash: HASH });
  });

  it("refuses to remove a run that is still moving", async () => {
    getRun.mockResolvedValue({ ok: true, data: { ...failedRun, status: "running" } });

    await removeRunAction(form({ runId: RUN }));

    expect(deleteRun).not.toHaveBeenCalled();
  });

  it("refuses to remove a run a proposal hangs off", async () => {
    getRun.mockResolvedValue({ ok: true, data: failedRun });
    findProposalForRun.mockResolvedValue({ ok: true, data: { id: PROPOSAL } });

    await removeRunAction(form({ runId: RUN }));

    expect(deleteRun).not.toHaveBeenCalled();
  });

  it("refuses a run id that is not an id", async () => {
    await removeRunAction(form({ runId: "nope" }));

    expect(getRun).not.toHaveBeenCalled();
  });
});
