import {
  productProposalSchema,
  type MarketFinding,
  type ProductProposal,
} from "@dp/domain/product-ops";
import type { CallContext } from "@dp/gateway/gateway";
import type { RetrievedChunk } from "@dp/prompts";
import {
  runSpecialist,
  type SpecialistDeps,
  type SpecialistOutcome,
} from "./specialist";

/**
 * The CPO.
 *
 * One judgement call over the run's findings and whatever internal context was
 * retrieved for it, returning one proposal. The reasoning tier, because this
 * is the thing a human is being asked to review and the only genuinely
 * open-ended judgement in the workflow.
 *
 * It has no tools. The sketch this feature came from gave it
 * searchInternalDocs and searchMarketResearch as callable tools; retrieval
 * happens before the call instead, which is the same position the tutor takes
 * and for the same reasons — deterministic, cheaper, one round trip, and no
 * tool-permission surface to get wrong. business-objective.md S615 is explicit
 * that a multi-agent shape needs measured evidence before it is worth having.
 *
 * It also returns no priority. The four impact judgements come back and
 * priorityScoreFor turns them into a number, so the figure on the review page
 * is one somebody can account for.
 */

const PROMPT = "productops.proposal_synthesis";

export interface SynthesisRequest {
  /** What this run is looking for. The trusted framing, not model output. */
  readonly brief: string;
  readonly findings: readonly MarketFinding[];
  /** Chunks from the existing corpus: what the product already does. */
  readonly internalContext?: readonly { content: string; source?: string }[];
  readonly context: CallContext;
}

/**
 * A finding as fenced context.
 *
 * Rendered compactly rather than as raw JSON: the model needs the observation
 * and its provenance, and a serialised object spends tokens on punctuation.
 * Scored by the finding's own relevance so shedding drops the least relevant
 * first.
 */
function findingChunk(finding: MarketFinding): RetrievedChunk {
  const lines = [
    finding.title,
    finding.summary,
    ...(finding.painPoints.length > 0
      ? [`Pain points: ${finding.painPoints.join("; ")}`]
      : []),
    ...(finding.trends.length > 0 ? [`Trends: ${finding.trends.join("; ")}`] : []),
    ...finding.evidence.map((item) =>
      item.url ? `${item.finding} (${item.url})` : item.finding,
    ),
  ];

  return {
    content: lines.join("\n"),
    score: finding.relevanceScore,
    source: finding.sourceType,
  };
}

export async function synthesiseProposal(
  deps: SpecialistDeps,
  request: SynthesisRequest,
): Promise<SpecialistOutcome<ProductProposal>> {
  const knowledge: RetrievedChunk[] = [
    ...request.findings.map(findingChunk),
    // Internal documents score below the market findings on purpose: what the
    // product already does is the constraint, and what learners are struggling
    // with is the reason. Under pressure, keep the reason.
    ...(request.internalContext ?? []).map((chunk) => ({
      content: chunk.content,
      score: 0.5,
      source: chunk.source ?? "internal",
    })),
  ];

  return runSpecialist(deps, {
    prompt: PROMPT,
    schema: productProposalSchema,
    input: { brief: request.brief },
    knowledge,
    context: request.context,
  });
}
