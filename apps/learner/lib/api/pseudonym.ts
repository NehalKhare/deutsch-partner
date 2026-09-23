import "server-only";

import { requireEnvValue } from "@dp/env/schema";
import { hashUserId } from "@dp/observability/pseudonym";

import { serverEnv } from "@/lib/env/server";

/**
 * The pseudonymous id used in logs and the ledger. Never the learner's id.
 *
 * Its own module, apart from the composition root, because everything that
 * logs needs it and almost nothing that logs needs a model gateway.
 */
export function pseudonymFor(learnerId: string): string {
  return hashUserId({
    userId: learnerId,
    salt: requireEnvValue(serverEnv().LOG_PSEUDONYM_SALT, "LOG_PSEUDONYM_SALT"),
  });
}

/** What a log line carries when the salt is not configured. */
export const PSEUDONYM_UNAVAILABLE = "unavailable";

/**
 * The pseudonym, or a marker saying there is not one.
 *
 * Used where the log line is a side effect of something the learner asked for
 * rather than the point of it. Refusing to delete a conversation because the
 * observability salt is unset would be an outage caused by the audit trail,
 * which is the wrong way round; the event is still written, without an
 * identity and saying as much.
 *
 * The gateway keeps the strict version: a ledger row with no learner on it
 * cannot be attributed later, so there it is worth failing for.
 */
export function pseudonymOrUnavailable(learnerId: string): string {
  try {
    return pseudonymFor(learnerId);
  } catch {
    return PSEUDONYM_UNAVAILABLE;
  }
}
