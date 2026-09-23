/**
 * The engineering manager's brief.
 *
 * The one piece of framing the breakdown call sends as its message. The PRD,
 * the plan and the architecture notes travel as fenced knowledge, because
 * they are documents and because the message block is capped; this is the
 * instruction that says what to do with them. Prompt text, so it lives here.
 */
export function engineeringBreakdownBrief(): string {
  return [
    "Act as the engineering manager for this change. The PRD, the approved file plan and notes on the current system are supplied as reference material.",
    "Break the PRD into individual requirements that can be built and reviewed on their own, grouped into phases that each ship something usable. Number them in build order and name what each depends on.",
    "Size every requirement and the whole as a t-shirt size, honestly: a size is an estimate of effort, not of importance.",
    "Give technical guidance where the current system is the wrong tool for a requirement: name the alternative (a different runtime, transport, store or library), say what the codebase does today, and weigh both sides. Where the current stack is the right choice, say that and why. Do not invent facts about the system beyond the notes supplied.",
    "Keep every line short. The whole answer has to fit in about 1200 words.",
  ].join("\n");
}
