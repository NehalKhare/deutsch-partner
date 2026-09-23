"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { miniLevelSchema } from "@dp/domain/cefr";
import { masteryThresholdSchema } from "@dp/domain/learner";
import type { RepositoryResult } from "@dp/db/errors";
import type { LearnerAdminRepository } from "@dp/db/learner-admin-repository";

import { createLearnerSupport, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { isOperator } from "@/lib/auth/operator";
import { operatorForAction } from "@/lib/auth/require-operator";
import { deletionPhrase, type SupportFormState } from "@/lib/learner-directory";

/**
 * Corrections an operator makes on a learner's behalf.
 *
 * Each re-checks the operator, is rate limited, validates in the domain and
 * again in the database, and is an audit event (guardrails S24) under two
 * pseudonyms: the operator's, and the learner's — the same hash the ledger
 * carries, so a correction and the spend around it read as one history.
 * Never the account ids, and never the learner's words: an error is logged by
 * its type, a memory by its kind.
 *
 * A refusal from the gate reads the same as any failed save.
 */

const NOT_DONE: SupportFormState = { status: "error", message: "Not done. Try again." };
const NOTHING: SupportFormState = { status: "error", message: "Nothing to change: it may already be gone." };

async function admitOperator(route: string): Promise<string | null> {
  const operator = await operatorForAction(route);
  if (operator === null) return null;

  const decision = await limiterFor("ops_learner_write").check(operator.hash);
  return decision.allowed ? operator.hash : null;
}

const learnerIdSchema = z.uuid();

/**
 * The shape every correction shares: admit, validate, call, audit, refresh.
 *
 * `audit` turns the repository's answer into the fields of the log line; it
 * is where the rule "no content in the log" is kept, one correction at a time.
 */
async function correct<Input, Result>(
  route: string,
  event: string,
  formData: FormData,
  schema: z.ZodType<Input>,
  fields: (formData: FormData) => unknown,
  act: (learners: LearnerAdminRepository, learnerId: string, input: Input) => Promise<RepositoryResult<Result | null>>,
  audit: (result: Result, input: Input) => Record<string, unknown>,
  done: string,
): Promise<SupportFormState> {
  const operator = await admitOperator(route);
  if (operator === null) return NOT_DONE;

  const learnerId = learnerIdSchema.safeParse(formData.get("learnerId"));
  const input = schema.safeParse(fields(formData));
  if (!learnerId.success || !input.success) {
    return { status: "error", message: "That value is not one this learner can have." };
  }

  const { learners, logger } = createLearnerSupport();
  const learnerHash = pseudonymFor(learnerId.data);
  const outcome = await act(learners, learnerId.data, input.data);

  if (!outcome.ok) {
    logger.warn(`${event}_failed`, { userIdHash: operator, learnerHash, errorKind: outcome.error.kind });
    return NOT_DONE;
  }
  if (outcome.data === null) return NOTHING;

  logger.info(event, {
    audit: true,
    userIdHash: operator,
    learnerHash,
    ...audit(outcome.data, input.data),
  });

  refresh();
  return { status: "done", message: done };
}

const none = z.object({});
const noFields = () => ({});

export async function setMiniLevelAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/mini-level",
    "learner.mini_level_set",
    formData,
    z.object({ miniLevel: z.coerce.number().pipe(miniLevelSchema) }),
    (data) => ({ miniLevel: data.get("miniLevel") }),
    (learners, id, input) => learners.setMiniLevel(id, input.miniLevel),
    (change) => ({ before: change.before, after: change.after }),
    "Moved. The learner's next session starts there.",
  );
}

export async function clearSkippedLevelsAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/skipped",
    "learner.skipped_levels_cleared",
    formData,
    none,
    noFields,
    (learners, id) => learners.clearSkippedLevels(id),
    (change) => ({ before: change.before.skipped, after: change.after.skipped }),
    "Cleared.",
  );
}

export async function resetLevelPerformanceAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/level-reset",
    "learner.level_reset",
    formData,
    z.object({ miniLevel: z.coerce.number().pipe(miniLevelSchema) }),
    (data) => ({ miniLevel: data.get("miniLevel") }),
    (learners, id, input) => learners.resetLevelPerformance(id, input.miniLevel),
    (removed, input) => ({ miniLevel: input.miniLevel, turns: removed.turns, strongTurns: removed.strongTurns }),
    "Reset. The level's tally starts again from the next turn.",
  );
}

export async function setErrorResolvedAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/error",
    "learner.error_resolved",
    formData,
    z.object({ errorId: z.uuid(), resolved: z.enum(["true", "false"]).transform((value) => value === "true") }),
    (data) => ({ errorId: data.get("errorId"), resolved: data.get("resolved") }),
    (learners, id, input) => learners.setErrorResolved(id, input.errorId, input.resolved),
    (change, input) => ({ errorId: input.errorId, errorType: change.errorType, before: change.before, after: change.after }),
    "Saved. A recurrence reopens it.",
  );
}

export async function setMasteryThresholdAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/threshold",
    "learner.mastery_threshold_set",
    formData,
    z.object({ threshold: z.coerce.number().pipe(masteryThresholdSchema) }),
    (data) => ({ threshold: data.get("threshold") }),
    (learners, id, input) => learners.setMasteryThreshold(id, input.threshold),
    (change) => ({ before: change.before, after: change.after }),
    "Saved.",
  );
}

export async function resetDisputedCorrectionsAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/disputed",
    "learner.disputed_corrections_reset",
    formData,
    none,
    noFields,
    (learners, id) => learners.resetDisputedCorrections(id),
    (change) => ({ before: change.before, after: change.after }),
    "Reset.",
  );
}

export async function deleteMemoryAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return correct(
    "/learners/memory",
    "learner.memory_deleted",
    formData,
    z.object({ memoryId: z.uuid() }),
    (data) => ({ memoryId: data.get("memoryId") }),
    (learners, id, input) => learners.deleteMemory(id, input.memoryId),
    (removed, input) => ({ memoryId: input.memoryId, kind: removed.kind }),
    "Deleted.",
  );
}

/**
 * Deletes the learner's account, and with it every learner table.
 *
 * Through the Auth admin API: deleting the auth user is what the schema
 * cascades from. The usage ledger keeps its rows under the pseudonym, which
 * cannot be reversed, so financial history survives as the cost spec
 * requires. The operator must type the learner's pseudonym prefix back, and an
 * operator's own account is refused outright — that is the allowlist's
 * business, not a support action.
 */
export async function deleteAccountAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  const operator = await admitOperator("/learners/delete");
  if (operator === null) return NOT_DONE;

  const learnerId = learnerIdSchema.safeParse(formData.get("learnerId"));
  if (!learnerId.success) return NOT_DONE;
  if (isOperator(learnerId.data)) {
    return { status: "error", message: "This is an operator account. It is not deleted from here." };
  }

  const learnerHash = pseudonymFor(learnerId.data);
  const phrase = deletionPhrase(learnerHash);
  if (String(formData.get("confirm") ?? "").trim() !== phrase) {
    return { status: "error", message: `Type ${phrase} to confirm.` };
  }

  const { accounts, logger } = createLearnerSupport();
  const deleted = await accounts.delete(learnerId.data);

  if (!deleted.ok) {
    logger.error("learner.account_delete_failed", { userIdHash: operator, learnerHash });
    return { status: "error", message: "The auth service did not delete the account. Nothing was removed." };
  }

  logger.info("learner.account_deleted", { audit: true, userIdHash: operator, learnerHash });

  redirect(`/learners?deleted=${learnerHash.slice(0, 8)}`);
}
