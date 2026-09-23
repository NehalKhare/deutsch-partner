import { z } from "zod";

/**
 * Who is an operator.
 *
 * An explicit allowlist of account ids in configuration, checked on the
 * server by the operator app. Pure here: the app binds it to its environment.
 * Deliberately not a claim in the token and deliberately not a column a
 * learner's own row could carry: both would put the answer somewhere the
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
