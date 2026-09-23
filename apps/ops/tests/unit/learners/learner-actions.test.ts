import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiters } from "@/lib/api/rate-limit";
import { SUPPORT_FORM_IDLE } from "@/lib/learner-directory";

/**
 * The learner-support actions.
 *
 * Each is its own entry point, so each refuses on its own before touching a
 * learner. Each correction is an audit event under two pseudonyms — the
 * operator who made it and the learner it was made to — and never carries the
 * learner's words: no memory text, no utterance, no email (guardrails S24).
 * Deletion is the one irreversible act here, so it is also the one that needs
 * the learner named back to it, and it refuses to delete an operator.
 */

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const ERROR_ID = "33333333-3333-4333-8333-333333333333";
const MEMORY_ID = "44444444-4444-4444-8444-444444444444";
const OPERATOR_HASH = "0123456789abcdef0123456789abcdef";
const LEARNER_HASH = "fedcba9876543210fedcba9876543210";

const currentUser = vi.fn();
const refresh = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
const learners = {
  setMiniLevel: vi.fn(),
  clearSkippedLevels: vi.fn(),
  resetLevelPerformance: vi.fn(),
  setErrorResolved: vi.fn(),
  setMasteryThreshold: vi.fn(),
  resetDisputedCorrections: vi.fn(),
  deleteMemory: vi.fn(),
  profileIds: vi.fn(),
};
const accounts = { findByEmail: vi.fn(), get: vi.fn(), delete: vi.fn() };
const logged: Array<{ event: string; fields: Record<string, unknown> }> = [];
const record = (event: string, fields: Record<string, unknown> = {}) => {
  logged.push({ event, fields });
};
const logger = { debug: vi.fn(), info: record, warn: record, error: record };

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("@/lib/auth/operator", () => ({ isOperator: (id: string) => id === OPERATOR }));
vi.mock("@/lib/auth/require-operator", () => ({
  operatorForAction: async () => {
    const id = await currentUser();
    return id === OPERATOR ? { id, email: null, hash: OPERATOR_HASH, aal: "aal2" } : null;
  },
}));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => logger,
  pseudonymFor: (id: string) => (id === LEARNER ? LEARNER_HASH : OPERATOR_HASH),
  createLearnerSupport: () => ({ learners, accounts, logger }),
}));

const detail = await import("@/app/(ops)/learners/[learnerId]/actions");
const { findLearnerAction } = await import("@/app/(ops)/learners/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const run = <T>(promise: Promise<T>) => promise.catch((error: Error) => error.message);

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiters();
  logged.length = 0;
  currentUser.mockResolvedValue(OPERATOR);
  learners.setMiniLevel.mockResolvedValue({
    ok: true,
    data: { before: { miniLevel: 1, cefr: "A1", skipped: [] }, after: { miniLevel: 20, cefr: "A2", skipped: [] } },
  });
  learners.setErrorResolved.mockResolvedValue({ ok: true, data: { before: false, after: true, errorType: "perfekt" } });
  learners.deleteMemory.mockResolvedValue({ ok: true, data: { kind: "fact" } });
  learners.resetLevelPerformance.mockResolvedValue({ ok: true, data: { turns: 10, strongTurns: 3 } });
  learners.setMasteryThreshold.mockResolvedValue({ ok: true, data: { before: 80, after: 50 } });
  learners.resetDisputedCorrections.mockResolvedValue({ ok: true, data: { before: 4, after: 0 } });
  learners.clearSkippedLevels.mockResolvedValue({
    ok: true,
    data: { before: { miniLevel: 5, cefr: "A1", skipped: [2, 3] }, after: { miniLevel: 5, cefr: "A1", skipped: [] } },
  });
  accounts.delete.mockResolvedValue({ ok: true });
  accounts.findByEmail.mockResolvedValue({ status: "found", learnerId: LEARNER });
  learners.profileIds.mockResolvedValue({ ok: true, data: [LEARNER] });
});

describe("somebody who is not an operator", () => {
  beforeEach(() => {
    currentUser.mockResolvedValue(LEARNER);
  });

  it.each([
    ["setMiniLevelAction", { learnerId: LEARNER, miniLevel: "20" }],
    ["clearSkippedLevelsAction", { learnerId: LEARNER }],
    ["resetLevelPerformanceAction", { learnerId: LEARNER, miniLevel: "3" }],
    ["setErrorResolvedAction", { learnerId: LEARNER, errorId: ERROR_ID, resolved: "true" }],
    ["setMasteryThresholdAction", { learnerId: LEARNER, threshold: "50" }],
    ["resetDisputedCorrectionsAction", { learnerId: LEARNER }],
    ["deleteMemoryAction", { learnerId: LEARNER, memoryId: MEMORY_ID }],
    ["deleteAccountAction", { learnerId: LEARNER, confirm: "delete fedcba98" }],
  ] as const)("cannot call %s", async (name, fields) => {
    const state = await detail[name](SUPPORT_FORM_IDLE, form(fields));

    expect(state.status).toBe("error");
    for (const method of Object.values(learners)) expect(method).not.toHaveBeenCalled();
    expect(accounts.delete).not.toHaveBeenCalled();
  });

  it("cannot look anybody up", async () => {
    await findLearnerAction(SUPPORT_FORM_IDLE, form({ query: "alice@example.com" }));

    expect(accounts.findByEmail).not.toHaveBeenCalled();
  });
});

describe("an operator correcting a learner", () => {
  it("moves the mini-level and records it under both pseudonyms", async () => {
    const state = await detail.setMiniLevelAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER, miniLevel: "20" }));

    expect(learners.setMiniLevel).toHaveBeenCalledWith(LEARNER, 20);
    expect(state.status).toBe("done");
    const audit = logged.find((line) => line.event === "learner.mini_level_set");
    expect(audit?.fields).toMatchObject({
      audit: true,
      userIdHash: OPERATOR_HASH,
      learnerHash: LEARNER_HASH,
      before: { miniLevel: 1, cefr: "A1" },
      after: { miniLevel: 20, cefr: "A2" },
    });
    // Pseudonyms only: neither account id reaches the log.
    expect(JSON.stringify(logged)).not.toContain(LEARNER);
    expect(JSON.stringify(logged)).not.toContain(OPERATOR);
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a mini-level off the path before reaching the store", async () => {
    const state = await detail.setMiniLevelAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER, miniLevel: "71" }));

    expect(state.status).toBe("error");
    expect(learners.setMiniLevel).not.toHaveBeenCalled();
  });

  it("says so when there was nothing for that learner to change", async () => {
    learners.setErrorResolved.mockResolvedValue({ ok: true, data: null });

    const state = await detail.setErrorResolvedAction(
      SUPPORT_FORM_IDLE,
      form({ learnerId: LEARNER, errorId: ERROR_ID, resolved: "true" }),
    );

    expect(state).toEqual({ status: "error", message: "Nothing to change: it may already be gone." });
    expect(logged.some((line) => line.fields.audit === true && line.event.startsWith("learner."))).toBe(false);
  });

  it("marks an error resolved, logging its type and never its examples", async () => {
    await detail.setErrorResolvedAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER, errorId: ERROR_ID, resolved: "true" }));

    expect(learners.setErrorResolved).toHaveBeenCalledWith(LEARNER, ERROR_ID, true);
    expect(logged.find((line) => line.event === "learner.error_resolved")?.fields).toMatchObject({
      errorId: ERROR_ID,
      errorType: "perfekt",
      before: false,
      after: true,
    });
  });

  it("deletes a memory, logging its kind and never its text", async () => {
    await detail.deleteMemoryAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER, memoryId: MEMORY_ID }));

    expect(learners.deleteMemory).toHaveBeenCalledWith(LEARNER, MEMORY_ID);
    expect(logged.find((line) => line.event === "learner.memory_deleted")?.fields).toMatchObject({
      memoryId: MEMORY_ID,
      kind: "fact",
    });
  });

  it.each([
    ["clearSkippedLevelsAction", { learnerId: LEARNER }, "learner.skipped_levels_cleared"],
    ["resetLevelPerformanceAction", { learnerId: LEARNER, miniLevel: "3" }, "learner.level_reset"],
    ["setMasteryThresholdAction", { learnerId: LEARNER, threshold: "50" }, "learner.mastery_threshold_set"],
    ["resetDisputedCorrectionsAction", { learnerId: LEARNER }, "learner.disputed_corrections_reset"],
  ] as const)("%s is audited", async (name, fields, event) => {
    const state = await detail[name](SUPPORT_FORM_IDLE, form(fields));

    expect(state.status).toBe("done");
    expect(logged.find((line) => line.event === event)?.fields).toMatchObject({ audit: true, learnerHash: LEARNER_HASH });
  });

  it("refuses a threshold the product does not offer", async () => {
    const state = await detail.setMasteryThresholdAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER, threshold: "60" }));

    expect(state.status).toBe("error");
    expect(learners.setMasteryThreshold).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await detail.resetDisputedCorrectionsAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER }));
    }
    learners.resetDisputedCorrections.mockClear();

    const state = await detail.resetDisputedCorrectionsAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER }));

    expect(state.status).toBe("error");
    expect(learners.resetDisputedCorrections).not.toHaveBeenCalled();
  });
});

describe("an operator deleting an account", () => {
  it("deletes it once the learner is named back, and leaves the page", async () => {
    const outcome = await run(
      detail.deleteAccountAction(SUPPORT_FORM_IDLE, form({ learnerId: LEARNER, confirm: "delete fedcba98" })),
    );

    expect(accounts.delete).toHaveBeenCalledWith(LEARNER);
    expect(outcome).toBe("NEXT_REDIRECT:/learners?deleted=fedcba98");
    expect(logged.find((line) => line.event === "learner.account_deleted")?.fields).toMatchObject({
      audit: true,
      userIdHash: OPERATOR_HASH,
      learnerHash: LEARNER_HASH,
    });
  });

  it("does nothing on the wrong phrase", async () => {
    const state = await detail.deleteAccountAction(
      SUPPORT_FORM_IDLE,
      form({ learnerId: LEARNER, confirm: "delete" }),
    );

    expect(state).toEqual({ status: "error", message: "Type delete fedcba98 to confirm." });
    expect(accounts.delete).not.toHaveBeenCalled();
  });

  it("will not delete an operator", async () => {
    const state = await detail.deleteAccountAction(
      SUPPORT_FORM_IDLE,
      form({ learnerId: OPERATOR, confirm: "delete 01234567" }),
    );

    expect(state.status).toBe("error");
    expect(accounts.delete).not.toHaveBeenCalled();
  });

  it("does not claim a deletion the auth service refused", async () => {
    accounts.delete.mockResolvedValue({ ok: false });

    const state = await detail.deleteAccountAction(
      SUPPORT_FORM_IDLE,
      form({ learnerId: LEARNER, confirm: "delete fedcba98" }),
    );

    expect(state.status).toBe("error");
    expect(logged.find((line) => line.event === "learner.account_deleted")).toBeUndefined();
  });
});

describe("an operator looking a learner up", () => {
  it("goes to the learner an email belongs to, and never logs the address", async () => {
    const outcome = await run(findLearnerAction(SUPPORT_FORM_IDLE, form({ query: "Alice@Example.com" })));

    expect(accounts.findByEmail).toHaveBeenCalledWith("Alice@Example.com");
    expect(outcome).toBe(`NEXT_REDIRECT:/learners/${LEARNER}`);
    expect(logged.find((line) => line.event === "learner.lookup")?.fields).toMatchObject({
      audit: true,
      method: "email",
      found: true,
    });
    expect(JSON.stringify(logged).toLowerCase()).not.toContain("alice@example.com");
  });

  it("resolves a pseudonym by hashing profile ids", async () => {
    const outcome = await run(findLearnerAction(SUPPORT_FORM_IDLE, form({ query: LEARNER_HASH })));

    expect(outcome).toBe(`NEXT_REDIRECT:/learners/${LEARNER}`);
  });

  it("goes straight to an account id", async () => {
    const outcome = await run(findLearnerAction(SUPPORT_FORM_IDLE, form({ query: LEARNER })));

    expect(outcome).toBe(`NEXT_REDIRECT:/learners/${LEARNER}`);
    expect(accounts.findByEmail).not.toHaveBeenCalled();
  });

  it("says nobody matched, without redirecting", async () => {
    accounts.findByEmail.mockResolvedValue({ status: "not_found" });

    const state = await findLearnerAction(SUPPORT_FORM_IDLE, form({ query: "nobody@example.com" }));

    expect(state).toEqual({ status: "error", message: "No learner matches that." });
  });

  it("is rate limited, because an answer about an address is an enumeration surface", async () => {
    accounts.findByEmail.mockResolvedValue({ status: "not_found" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await findLearnerAction(SUPPORT_FORM_IDLE, form({ query: "nobody@example.com" }));
    }
    accounts.findByEmail.mockClear();

    await findLearnerAction(SUPPORT_FORM_IDLE, form({ query: "nobody@example.com" }));

    expect(accounts.findByEmail).not.toHaveBeenCalled();
  });
});
