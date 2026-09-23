import {
  deniedPathsIn,
  implementationPlanSchema,
  type ImplementationPlan,
} from "@dp/domain/product-ops";
import type { CallContext } from "@dp/gateway/gateway";
import type { RetrievedChunk } from "@dp/prompts";
import {
  runSpecialist,
  type SpecialistDeps,
  type SpecialistOutcome,
} from "./specialist";

/**
 * The implementation planner.
 *
 * Planning is separate from execution and a human sits between them, which is
 * the single most useful thing about this design: what the reviewer approves
 * is a named list of files, and that list is what the apply layer checks every
 * write against. An agent that planned and wrote in one step would have
 * nothing to check against but its own intentions.
 *
 * The repository source it reads is untrusted. A comment in a file can say
 * "ignore all previous instructions" as easily as a web page can, and this is
 * the first call in the workflow to look at the repository at all.
 */

const PROMPT = "productops.code_plan";

export interface RepositoryFile {
  readonly path: string;
  readonly content: string;
}

export interface PlanRequest {
  readonly prd: string;
  /** What the planner is allowed to see. Selected by the caller, not by it. */
  readonly repository: readonly RepositoryFile[];
  readonly context: CallContext;
}

export type PlanOutcome =
  | (Extract<SpecialistOutcome<ImplementationPlan>, { status: "ok" }> & {
      /**
       * Paths the plan names that the apply layer will refuse regardless.
       *
       * Reported rather than removed. Silently editing a plan would hide from
       * the reviewer that the model wanted something it may not have, and the
       * reviewer is the one this workflow exists to inform. The apply layer
       * refuses them either way.
       */
      readonly denied: readonly string[];
    })
  | Extract<SpecialistOutcome<ImplementationPlan>, { status: "failed" }>;

function sourceChunk(file: RepositoryFile): RetrievedChunk {
  return {
    content: `${file.path}\n${file.content}`,
    // Flat: the caller chose these files, and inventing a relevance ordering
    // here would shed on a guess rather than on a judgement.
    score: 0.5,
    source: file.path,
  };
}

export async function planImplementation(
  deps: SpecialistDeps,
  request: PlanRequest,
): Promise<PlanOutcome> {
  const outcome = await runSpecialist(deps, {
    prompt: PROMPT,
    schema: implementationPlanSchema,
    input: { prd: request.prd },
    knowledge: request.repository.map(sourceChunk),
    context: request.context,
  });

  if (outcome.status !== "ok") return outcome;

  return { ...outcome, denied: deniedPathsIn(outcome.value) };
}
