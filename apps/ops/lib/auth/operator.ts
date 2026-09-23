import "server-only";

import { parseOperatorIds } from "@dp/auth/operator";

import { serverEnv } from "@/lib/env/server";

/**
 * Who may be here.
 *
 * The allowlist in configuration, bound to this app's environment. Not a
 * claim in the token and not a column a learner's own row could carry: both
 * would put the answer where the subject of the question can influence it
 * (product-ops-spec.md S2). Fails closed on an unset or malformed list.
 */
export function operatorIds(): readonly string[] {
  return parseOperatorIds(serverEnv().OPERATOR_USER_IDS);
}

export function isOperator(accountId: string | null): boolean {
  if (!accountId) return false;

  return operatorIds().includes(accountId);
}
