"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createLearnerSupport, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { operatorForAction } from "@/lib/auth/require-operator";
import { findLearnerByPseudonym, type Lookup, type SupportFormState } from "@/lib/learner-directory";

/**
 * Finding one learner: by pseudonym, by account id, or by the exact email
 * they wrote in from.
 *
 * Audited, because an answer about whether an address has an account is
 * itself personal data — and rate limited for the same reason. The log says
 * how the operator searched and whether it matched, never what they typed.
 */

const MESSAGES: Readonly<Record<Exclude<Lookup["status"], "found">, string>> = {
  not_found: "No learner matches that.",
  invalid: "Enter a pseudonym, an account id or an email address.",
  too_many: "Too many accounts to search this way. Use the account id.",
  unavailable: "The lookup could not be completed. Try again.",
};

export async function findLearnerAction(
  _previous: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  const operator = await operatorForAction("/learners/find");
  if (operator === null) return { status: "error", message: MESSAGES.unavailable };

  const decision = await limiterFor("ops_learner_lookup").check(operator.hash);
  if (!decision.allowed) return { status: "error", message: MESSAGES.unavailable };

  const query = String(formData.get("query") ?? "").trim();
  const { learners, accounts, logger } = createLearnerSupport();

  let method: "pseudonym" | "id" | "email";
  let found: Lookup;
  if (/^[0-9a-f]{32}$/.test(query)) {
    method = "pseudonym";
    found = await findLearnerByPseudonym(learners, query, pseudonymFor);
  } else if (z.uuid().safeParse(query).success) {
    method = "id";
    found = { status: "found", learnerId: query.toLowerCase() };
  } else {
    method = "email";
    found = await accounts.findByEmail(query);
  }

  logger.info("learner.lookup", {
    audit: true,
    userIdHash: operator.hash,
    method,
    found: found.status === "found",
  });

  if (found.status !== "found") return { status: "error", message: MESSAGES[found.status] };

  redirect(`/learners/${found.learnerId}`);
}
