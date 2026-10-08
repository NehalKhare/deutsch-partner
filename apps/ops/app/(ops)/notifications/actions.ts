"use server";

import { refresh } from "next/cache";

import { createOpsNotifications } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForAction } from "@/lib/auth/require-operator";
import { markTargetFromForm, markTargetSchema, type MarkTarget } from "@/lib/notifications";

/**
 * Reading the operators' inbox.
 *
 * An action is its own entry point, so each one re-checks the operator and
 * is rate limited before touching the store, and returns silently on
 * refusal — a distinguishable refusal is a way to enumerate who is an
 * operator. Marking read is a shared act with a name on it: the row records
 * the operator's pseudonym, and the audit line carries the same (guardrails
 * S24: admin activity), never an id.
 */
async function markRead(route: string, target: MarkTarget): Promise<void> {
  const operator = await operatorForAction(route);
  if (operator === null) return;

  const decision = await limiterFor("ops_notifications").check(operator.hash);
  if (!decision.allowed) return;

  const { notifications, logger } = createOpsNotifications();
  const marked = await notifications.markRead(target, operator.hash);
  if (!marked.ok) {
    logger.warn("ops.notifications_read_failed", { userIdHash: operator.hash, errorKind: marked.error.kind });
    return;
  }

  logger.info("ops.notifications_read", {
    audit: true,
    userIdHash: operator.hash,
    count: marked.data,
    all: target === "all",
  });
}

/** From the bell: a list or "all", not awaited by the menu. */
export async function markOpsNotificationsReadAction(target: unknown): Promise<void> {
  const parsed = markTargetSchema.safeParse(target);
  if (!parsed.success) return;
  await markRead("/notifications#read", parsed.data);
}

/** From the page's forms. */
export async function markOpsNotificationsReadFormAction(formData: FormData): Promise<void> {
  const target = markTargetFromForm(formData);
  if (target === null) return;
  await markRead("/notifications#read", target);
  refresh();
}
