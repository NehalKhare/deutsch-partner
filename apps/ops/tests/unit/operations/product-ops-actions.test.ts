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
 *
 * The third is the hand-off. This process runs no stage: an action records a
 * job for the worker and a 'queued' event on the run, and nothing else.
 */

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const HASH = "0123456789abcdef0123456789abcdef";
const PROPOSAL = "5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const RUN = "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f";
const REQUEST = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const currentUser = vi.fn();
const operatorIds = vi.fn(() => [OPERATOR]);
const pseudonym = vi.fn(() => HASH);
const startRun = vi.fn();
const getProposal = vi.fn();
const getRun = vi.fn();
const findProposalForRun = vi.fn();
const deleteRun = vi.fn();
const recordEvent = vi.fn(async () => ({ ok: true, data: undefined }));
const touchRun = vi.fn(async () => ({ ok: true, data: undefined }));
const enqueue = vi.fn();
const applyReview = vi.fn();
const retryRun = vi.fn();
const refresh = vi.fn();
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
vi.mock("@/lib/auth/require-operator", () => ({
  // The gate, as the actions see it: an identity or null. Its own refusals
  // (no session, not on the allowlist, no second factor, no pseudonym) are
  // tested where it lives; here they all collapse into "null".
  operatorForAction: async () => {
    const id = await currentUser();
    if (!id || !operatorIds().includes(id)) return null;
    try {
      return { id, email: null, hash: pseudonym(), aal: "aal2" };
    } catch {
      return null;
    }
  },
}));
vi.mock("@/lib/api/composition", () => ({
  pseudonymFor: () => pseudonym(),
  actionLogger: () => logger,
  createProductOpsReader: () => ({
    runs: { startRun, getProposal, getRun, findProposalForRun, deleteRun, recordEvent, touchRun },
    jobs: { enqueue: (request: unknown) => enqueue(request) },
    feedback: {},
    logger,
  }),
}));
vi.mock("@dp/product-ops/review", async () => {
  const actual = await vi.importActual<typeof import("@dp/product-ops/review")>(
    "@dp/product-ops/review",
  );

  return {
    ...actual,
    applyReview: (deps: unknown, request: unknown) => applyReview(deps, request),
    retryRun: (deps: unknown, request: unknown) => retryRun(deps, request),
  };
});

/** The jobs the actions asked the worker for, in order. */
function enqueuedPayloads(): Array<Record<string, unknown>> {
  return enqueue.mock.calls.map((call) => (call[0] as { payload: Record<string, unknown> }).payload);
}

const {
  advanceRunAction,
  removeRunAction,
  retryRunAction,
  reviewProposalAction,
  startScanAction,
} = await import("@/app/(ops)/product/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiters();
  logged.length = 0;
  currentUser.mockResolvedValue(OPERATOR);
  operatorIds.mockReturnValue([OPERATOR]);
  pseudonym.mockReturnValue(HASH);
  startRun.mockResolvedValue({
    ok: true,
    data: { id: RUN, runType: "manual_market_scan", requestId: REQUEST, currentStage: "research" },
  });
  getRun.mockResolvedValue({
    ok: true,
    data: { id: RUN, status: "running", currentStage: "research", requestId: REQUEST },
  });
  getProposal.mockResolvedValue({ ok: true, data: { id: PROPOSAL, runId: RUN } });
  enqueue.mockResolvedValue({ ok: true, data: { id: 7, created: true, queue: "jobs" } });
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
    expect(enqueue).not.toHaveBeenCalled();
    // Not even a revalidation: nothing about the response should differ.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cannot nudge a run", async () => {
    await advanceRunAction(form({ runId: RUN }));

    expect(enqueue).not.toHaveBeenCalled();
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
      // A fresh id, so the job, the run and every event read as one story.
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
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

  it("hands the run to the worker rather than driving it here", async () => {
    await startScanAction(form({ brief: "healthcare German" }));

    // Nothing has run: this process holds no model key. A job is recorded,
    // attributed to the operator, correlated with the run's own request id.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      payload: {
        kind: "productops.drive",
        runId: RUN,
        review: null,
        correlationId: REQUEST,
        source: "ops",
      },
      requestedByHash: HASH,
    });
    // And the board can see it waiting.
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN, status: "queued", detail: { jobId: 7, correlationId: REQUEST } }),
    );
    expect(touchRun).toHaveBeenCalledWith(RUN);
    expect(logged.find((line) => line.event === "productops.enqueued")?.fields).toMatchObject({
      audit: true,
      runId: RUN,
      userIdHash: HASH,
    });
  });

  it("records no second queued event when the job was already waiting", async () => {
    enqueue.mockResolvedValue({ ok: true, data: { id: 7, created: false, queue: "jobs" } });

    await advanceRunAction(form({ runId: RUN }));

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recordEvent).not.toHaveBeenCalled();
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
    expect(enqueuedPayloads()).toEqual([
      expect.objectContaining({ kind: "productops.drive", runId: RUN, review: "approve" }),
    ]);
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

    expect(enqueue).not.toHaveBeenCalled();
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

describe("trying a run again", () => {
  beforeEach(() => {
    resetRateLimiters();
    currentUser.mockResolvedValue(OPERATOR);
    retryRun.mockReset();
    retryRun.mockResolvedValue({ status: "retried", stage: "prd" });
  });

  it("is a silent no-op for a learner who is not an operator", async () => {
    currentUser.mockResolvedValue(LEARNER);

    await retryRunAction(form({ runId: RUN }));

    expect(retryRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("moves the run back under the operator's pseudonym and hands it to the worker", async () => {
    await retryRunAction(form({ runId: RUN }));

    expect(retryRun).toHaveBeenCalledWith(expect.anything(), {
      runId: RUN,
      operatorIdHash: HASH,
    });
    expect(enqueuedPayloads()).toEqual([
      expect.objectContaining({ kind: "productops.drive", runId: RUN, correlationId: REQUEST }),
    ]);
  });

  it("enqueues nothing when the run could not be moved, and says why in the log", async () => {
    retryRun.mockResolvedValue({ status: "not_failed", stage: "prd" });

    await retryRunAction(form({ runId: RUN }));

    expect(enqueue).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(logged.find((line) => line.event === "productops.retry_refused")?.fields).toMatchObject({
      reason: "not_failed",
    });
  });

  it("refuses a run id that is not an id", async () => {
    await retryRunAction(form({ runId: "again-please" }));

    expect(retryRun).not.toHaveBeenCalled();
  });
});
