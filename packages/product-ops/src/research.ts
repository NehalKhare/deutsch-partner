import {
  marketFindingSchema,
  type Evidence,
  type MarketFinding,
} from "@dp/domain/product-ops";
import type { CallContext, Citation } from "@dp/gateway/gateway";
import { promptEntry } from "@dp/prompts";
import { nullLogger } from "@dp/observability/logger";
import {
  runSpecialist,
  type SpecialistDeps,
  type SpecialistOutcome,
} from "./specialist";
import { z } from "zod";

/**
 * The market research agent.
 *
 * One web-grounded query, one finding. A scan is many of these rather
 * than one long call, so each has its own ledger row and its own idempotency
 * key and a scan that dies halfway keeps what it already found.
 *
 * Its own job, beyond the shared runner, is disbelieving the citations. The
 * prompt says to cite only the supplied results; this checks. A model asked
 * for a source will produce a plausible one, and on a product proposal the
 * evidence is the part a reviewer leans on hardest — so a url the provider
 * never actually returned is removed here rather than rendered as a link on a
 * review page (guardrails S12: the prompt is not the control).
 */

const PROMPT = "productops.market_research";

/**
 * Wrapped, matching the catalogue entry: the transport requests a json_object
 * response and parseModelJson extracts a balanced object, so a bare array is
 * not a shape this pipeline can carry.
 */
const findingsSchema = z.strictObject({
  findings: z.array(marketFindingSchema).max(1),
});

export interface ResearchRequest {
  readonly query: string;
  readonly context: CallContext;
}

/**
 * The angles one scan asks about.
 *
 * A market scan is many small calls rather than one long one, so this is what
 * turns a brief into them. Three angles, because they are the three kinds of
 * evidence a proposal needs and each is a different search: what people say is
 * wrong, what already exists, and whether the need is growing. Each call gets
 * its own ledger row and its own idempotency key, so a scan that dies halfway
 * keeps what it found.
 */
const QUERY_ANGLES: readonly string[] = [
  "learner complaints and frustrations",
  "existing apps and what they are missing",
  "demand and recent trends",
];

/** The queries a brief produces. Deterministic: the same brief, the same scan. */
export function researchQueries(brief: string): readonly string[] {
  return QUERY_ANGLES.map((angle) => `${brief} — ${angle}`);
}

/** Case-insensitive, because a provider and a model may differ on casing. */
function citedUrls(citations: readonly Citation[]): ReadonlySet<string> {
  return new Set(citations.map((citation) => citation.url.toLowerCase()));
}

function keptEvidence(
  evidence: readonly Evidence[],
  cited: ReadonlySet<string>,
): readonly Evidence[] {
  // Evidence with no url at all is an observation rather than a citation, and
  // there is nothing to disbelieve about it.
  return evidence.filter(
    (item) => item.url === undefined || cited.has(item.url.toLowerCase()),
  );
}

/**
 * A finding with every uncited source removed.
 *
 * The finding itself survives. What the model observed may well be real; what
 * is not real is the address it attributed the observation to, and dropping
 * the whole finding would lose more than it protects.
 */
function grounded(
  finding: MarketFinding,
  cited: ReadonlySet<string>,
): MarketFinding {
  const sourceUrl =
    finding.sourceUrl !== undefined && cited.has(finding.sourceUrl.toLowerCase())
      ? finding.sourceUrl
      : undefined;

  return { ...finding, sourceUrl, evidence: [...keptEvidence(finding.evidence, cited)] };
}

export async function researchMarket(
  deps: SpecialistDeps,
  request: ResearchRequest,
): Promise<SpecialistOutcome<readonly MarketFinding[]>> {
  const logger = deps.logger ?? nullLogger;

  const outcome = await runSpecialist(deps, {
    prompt: PROMPT,
    schema: findingsSchema,
    input: { query: request.query },
    context: request.context,
  });

  if (outcome.status !== "ok") return outcome;

  const cited = citedUrls(outcome.citations);
  const value = outcome.value.findings.map((finding) => grounded(finding, cited));

  const before = outcome.value.findings.reduce(
    (sum, finding) => sum + finding.evidence.length,
    0,
  );
  const after = value.reduce((sum, finding) => sum + finding.evidence.length, 0);

  if (after < before) {
    // Counts only. The urls themselves are what the model made up, and
    // repeating them in a log line is how an invention becomes a record.
    logger.warn("productops.uncited_evidence_dropped", {
      prompt: promptEntry(PROMPT).name,
      dropped: before - after,
      citations: outcome.citations.length,
      requestId: request.context.requestId,
    });
  }

  return { ...outcome, value };
}
