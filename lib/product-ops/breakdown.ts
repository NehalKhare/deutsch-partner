import {
  engineeringBreakdownSchema,
  type EngineeringBreakdown,
  type ImplementationPlan,
} from "@/domain/product-ops";
import type { CallContext } from "@/lib/ai/gateway/gateway";
import type { RetrievedChunk } from "@/lib/ai/prompts";
import { engineeringBreakdownBrief } from "@/lib/ai/prompts/product-ops-breakdown";
import type { RepositoryFile } from "@/lib/product-ops/planner";
import {
  runSpecialist,
  type SpecialistDeps,
  type SpecialistOutcome,
} from "@/lib/product-ops/specialist";

/**
 * The engineering manager's breakdown.
 *
 * The second call of the planning stage. The first names files, and those
 * files are what the apply layer checks every write against; this one says
 * what to build in what order, how big each piece is, and where the current
 * stack is the wrong tool for a piece. Two calls because the two answers do
 * not fit one 2000-token ceiling together, and two judgements because one
 * is a file list and the other is a plan a person can staff.
 *
 * Everything the call reads travels as fenced knowledge, scored so that the
 * PRD is shed last and the architecture notes first: the PRD is the thing
 * being broken down, and the notes are what the guidance compares against.
 * A source file is never read here — the file plan already names them.
 */

const PROMPT = "productops.plan_breakdown";

/** The knowledge block takes chunks of at most this many characters. */
const CHUNK_CHARS = 3_900;

export interface BreakdownRequest {
  readonly prd: string;
  readonly plan: ImplementationPlan;
  /** The system as it is: AGENTS.md and the architecture notes, when readable. */
  readonly architecture: readonly RepositoryFile[];
  readonly context: CallContext;
}

/** A long document as numbered chunks, so the block's per-chunk bound holds. */
function chunked(source: string, text: string, score: number): RetrievedChunk[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += CHUNK_CHARS) {
    parts.push(text.slice(at, at + CHUNK_CHARS));
  }
  return parts.map((content, index) => ({
    content,
    score,
    source: parts.length === 1 ? source : `${source} (${index + 1}/${parts.length})`,
  }));
}

/** The file plan as short text: the paths and the changes it already names. */
export function planText(plan: ImplementationPlan): string {
  const list = (label: string, items: readonly string[]) =>
    items.length === 0 ? null : `${label}: ${items.join(", ")}`;

  return [
    list("Files to modify", plan.filesToModify),
    list("Files to create", plan.filesToCreate),
    list("Tests", plan.tests),
    list("Database changes", plan.databaseChanges),
    list("API changes", plan.apiChanges),
    list("UI changes", plan.uiChanges),
    list("Dependencies", plan.dependencies),
    list("Risks", plan.risks),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function breakDownPlan(
  deps: SpecialistDeps,
  request: BreakdownRequest,
): Promise<SpecialistOutcome<EngineeringBreakdown>> {
  const knowledge: RetrievedChunk[] = [
    ...chunked("prd", request.prd, 1),
    ...chunked("file plan", planText(request.plan), 0.9),
    ...request.architecture.flatMap((file) =>
      chunked(file.path, file.content.slice(0, CHUNK_CHARS), 0.6),
    ),
  ];

  return runSpecialist(deps, {
    prompt: PROMPT,
    schema: engineeringBreakdownSchema,
    input: { brief: engineeringBreakdownBrief() },
    knowledge,
    context: request.context,
  });
}
