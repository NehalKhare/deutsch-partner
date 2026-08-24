import "server-only";

import { z } from "zod";

import { serverEnv } from "@/lib/env/server";

/**
 * Who may see the cost dashboard.
 *
 * An explicit allowlist of learner ids in configuration, checked on the
 * server. Deliberately not a claim in the token and deliberately not a column
 * a learner's own row could carry: both would put the answer somewhere the
 * subject of the question can influence.
 *
 * Fails closed. An unset or malformed allowlist means nobody is an operator,
 * which is the right answer when the alternative is everybody.
 */
const allowlistSchema = z.array(z.uuid());

/**
 * Pure, so the failure modes can be tested without an environment.
 *
 * A malformed allowlist is not a partial allowlist. One bad entry means the
 * configuration was not what somebody thought, and guessing which half they
 * meant is how an operator route quietly opens.
 */
export function parseOperatorIds(raw: string | undefined): readonly string[] {
  if (!raw) return [];

  const parsed = allowlistSchema.safeParse(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  return parsed.success ? parsed.data : [];
}

export function operatorIds(): readonly string[] {
  return parseOperatorIds(serverEnv().OPERATOR_USER_IDS);
}

export function isOperator(learnerId: string | null): boolean {
  if (!learnerId) return false;

  return operatorIds().includes(learnerId);
}
