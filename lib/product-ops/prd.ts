import {
  prdSectionsSchema,
  type Complexity,
  type Evidence,
  type PrdSections,
} from "@/domain/product-ops";
import type { CallContext } from "@/lib/ai/gateway/gateway";
import {
  runSpecialist,
  type SpecialistDeps,
  type SpecialistOutcome,
} from "@/lib/product-ops/specialist";

/**
 * The PRD.
 *
 * Mostly not a model call. The problem, the users, the justification, the
 * evidence and the implementation areas are already columns on the approved
 * proposal, so they are rendered; asking a model to restate what is stored can
 * only introduce drift between the document and the row it came from.
 *
 * What is generated is the four sections that need judgement — stories,
 * requirements, acceptance criteria, non-goals — and they are generated once
 * and stored, so the document is stable. Two renders of the same proposal and
 * the same sections produce byte-identical text, which is what lets the
 * document be hashed and lets a re-run of the stage recognise its own output.
 */

const PROMPT = "productops.prd_sections";

/** The columns the document is rendered from. A projection of the stored row. */
export interface PrdProposal {
  readonly id: string;
  readonly title: string;
  readonly problemStatement: string;
  readonly targetUsers: string;
  readonly marketJustification: string;
  readonly userImpact: string;
  readonly proposedSolution: string;
  readonly complexity: Complexity;
  readonly priorityScore: number;
  readonly implementationOutline: readonly string[];
  readonly affectedAreas: readonly string[];
  readonly supportingResearch: readonly Evidence[];
}

export interface PrdSectionsRequest {
  readonly proposal: PrdProposal;
  readonly context: CallContext;
}

const bullets = (items: readonly string[]): string =>
  items.length === 0 ? "_None._" : items.map((item) => `- ${item}`).join("\n");

const numbered = (items: readonly string[]): string =>
  items.length === 0
    ? "_None._"
    : items.map((item, index) => `${index + 1}. ${item}`).join("\n");

const references = (evidence: readonly Evidence[]): string =>
  evidence.length === 0
    ? "_None._"
    : evidence
        .map((item) => (item.url ? `- [${item.finding}](${item.url})` : `- ${item.finding}`))
        .join("\n");

/**
 * What the coding agent may not touch, stated in the document it reads.
 *
 * Not the control — the apply layer is, and it holds whatever this says — but
 * a PRD that implied a migration was in scope would be setting up a run to
 * fail at the last gate rather than at the first.
 */
const CONSTRAINTS = [
  "Do not add or edit a database migration. A schema change is described here and written by a person.",
  "Do not change the model gateway, the prompt catalogue, the CI security gates, authentication, or dependency manifests.",
  "Write the tests before the code, and keep every change inside the approved plan's file list.",
];

/**
 * Renders the document. Pure, and deliberately so: it is called once to store
 * and again to verify, and the two must agree.
 */
export function renderPrdDocument(
  proposal: PrdProposal,
  sections: PrdSections,
): string {
  return [
    `# ${proposal.title}`,
    "",
    `> Proposal \`${proposal.id}\` · priority ${proposal.priorityScore}/100 · ${proposal.complexity} effort`,
    "",
    "## Problem",
    "",
    proposal.problemStatement,
    "",
    "## Target users",
    "",
    proposal.targetUsers,
    "",
    "## Why now",
    "",
    proposal.marketJustification,
    "",
    "## Expected user impact",
    "",
    proposal.userImpact,
    "",
    "## Proposed solution",
    "",
    proposal.proposedSolution,
    "",
    "## User stories",
    "",
    bullets(sections.userStories),
    "",
    "## Functional requirements",
    "",
    bullets(sections.functionalRequirements),
    "",
    "## Acceptance criteria",
    "",
    bullets(sections.acceptanceCriteria),
    "",
    "## Non-goals",
    "",
    bullets(sections.nonGoals),
    "",
    "## Implementation outline",
    "",
    numbered(proposal.implementationOutline),
    "",
    "## Areas affected",
    "",
    bullets(proposal.affectedAreas),
    "",
    "## Constraints",
    "",
    bullets(CONSTRAINTS),
    "",
    "## References",
    "",
    references(proposal.supportingResearch),
    "",
  ].join("\n");
}

/** A compact rendering of the proposal, for the model to write sections against. */
function briefFor(proposal: PrdProposal): string {
  return [
    `Title: ${proposal.title}`,
    `Problem: ${proposal.problemStatement}`,
    `Target users: ${proposal.targetUsers}`,
    `Impact: ${proposal.userImpact}`,
    `Solution: ${proposal.proposedSolution}`,
    `Effort: ${proposal.complexity}`,
    `Outline: ${proposal.implementationOutline.join("; ")}`,
  ].join("\n");
}

export async function prdSections(
  deps: SpecialistDeps,
  request: PrdSectionsRequest,
): Promise<SpecialistOutcome<PrdSections>> {
  return runSpecialist(deps, {
    prompt: PROMPT,
    schema: prdSectionsSchema,
    input: { proposal: briefFor(request.proposal) },
    context: request.context,
  });
}
