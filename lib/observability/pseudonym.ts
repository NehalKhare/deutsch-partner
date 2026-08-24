import { createHmac } from "node:crypto";

/**
 * The pseudonymous learner identifier used in logs and in the usage ledger.
 *
 * The ledger deliberately outlives the account it describes — financial
 * history has to survive a deletion request — so it must never hold a user id
 * that could be joined back to a person. A keyed hash gives operators a stable
 * handle for "the same learner" without giving anyone a way back to who that
 * learner is.
 *
 * Keyed, not plain: a UUID space is small enough to enumerate, so an unsalted
 * digest is a lookup table away from being the id itself. The salt is a secret
 * and is required at the point of use rather than at boot, so a deployment
 * that never writes a ledger row does not need one configured.
 */

const DIGEST_LENGTH = 32;

/**
 * Named arguments, not positional.
 *
 * Both are strings and both are opaque, so a swapped pair type-checks, runs,
 * and produces a stable-looking hash that is keyed by the wrong thing — with
 * the guard below then checking the wrong string for emptiness. That is not a
 * mistake a reviewer catches by reading a call site, so the call site is
 * shaped to make it impossible.
 */
export interface PseudonymInput {
  readonly userId: string;
  readonly salt: string;
}

export function hashUserId({ userId, salt }: PseudonymInput): string {
  if (salt.trim().length === 0) {
    throw new Error("a pseudonym salt is required; refusing to write an unsalted hash");
  }

  return createHmac("sha256", salt).update(userId).digest("hex").slice(0, DIGEST_LENGTH);
}
