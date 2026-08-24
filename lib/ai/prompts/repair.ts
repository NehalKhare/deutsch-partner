/**
 * The one retry instruction.
 *
 * This is prompt text, so it lives in the prompt layer rather than next to the
 * code that sends it. A repair instruction pasted at a call site is a prompt
 * nobody can version, budget, or find when the repair rate moves.
 *
 * It carries issue paths and nothing else. The payload that failed is the
 * model's rendering of the learner's own words, and sending it back is both a
 * token cost and a way for malformed output to become input.
 */

/** Enough to be actionable. A model given forty paths fixes none of them. */
const MAX_ISSUES = 8;

export function repairInstruction(issues: readonly string[]): string {
  const named = issues.slice(0, MAX_ISSUES).join(", ");

  return [
    "",
    "Your previous response could not be parsed against the contract above.",
    `Problems: ${named}.`,
    "Return the corrected JSON object only. Do not explain what went wrong.",
  ].join("\n");
}
