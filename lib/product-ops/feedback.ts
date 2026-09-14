import { marketFindingSchema, type MarketFinding } from "@/domain/product-ops";
import type { LearnerFeedbackSummary } from "@/domain/trainer-coaching";
import { unhelpfulShare } from "@/lib/dashboard/learner-feedback";
import { FEEDBACK_REASON_LABELS } from "@/lib/trainer/coaching";

/**
 * Learner feedback as research evidence.
 *
 * Every market scan starts by asking the web what learners of German want.
 * The product's own learners have been saying so, one vote at a time, under
 * every trainer reply — and until this module that evidence sat in a table
 * nobody's scan read. Here it becomes one finding of sourceType "internal",
 * built by arithmetic from the operator's aggregate and recorded before the
 * first web search, so the CPO weighs what this product's learners actually
 * flagged against what forums say about learners in general.
 *
 * Deterministic on purpose: the counts are the evidence, and a model asked to
 * summarise them would add nothing but the chance of getting them wrong. The
 * notes — learners' own words — are not folded into the finding: they reach
 * the research agent through a tool, fenced, where a request to ignore the
 * rules reads as text.
 */

/**
 * How many votes a window needs before its feedback is a finding. Below this
 * a scan says nothing about it rather than presenting three votes as a trend.
 */
export const MIN_FEEDBACK_VOTES = 5;

/** The aggregate, as the research stage and its tool read it. Null when unreadable. */
export interface LearnerFeedbackSource {
  summary(days: number): Promise<LearnerFeedbackSummary | null>;
}

const TOP_REASONS = 3;

/** "Too long" → "Replies too long", in the learner's own terms as a pain point. */
function painPoint(reason: keyof typeof FEEDBACK_REASON_LABELS, count: number): string {
  const label = FEEDBACK_REASON_LABELS[reason];
  const phrased =
    reason === "wrong_correction"
      ? "Corrections learners disputed"
      : reason === "skip_news"
        ? "Sessions ending on the news"
        : `Replies ${label.toLowerCase()}`;
  return `${phrased} (${count} ${count === 1 ? "vote" : "votes"})`;
}

/**
 * One finding from one window of feedback, or null when there is too little.
 *
 * Validated against the same schema a web finding passes, so a count that
 * overflows a cap fails here rather than at the repository — and the finding
 * carries no url, because there is nothing on the web to cite.
 */
export function feedbackFinding(summary: LearnerFeedbackSummary): MarketFinding | null {
  const { totals, window } = summary;
  if (totals.votes < MIN_FEEDBACK_VOTES) return null;

  const share = unhelpfulShare(totals);
  const sharePct = share === null ? 0 : Math.round(share * 100);
  const topReasons = summary.byReason.slice(0, TOP_REASONS);
  const worstTool = summary.byTool.find((tool) => tool.unhelpful > 0) ?? null;

  const finding: MarketFinding = {
    title: `Learner feedback on the trainer: ${totals.votes} votes in ${window.days} days, ${sharePct}% unhelpful`,
    sourceType: "internal",
    summary: [
      `${totals.learners} ${totals.learners === 1 ? "learner" : "learners"} rated ${totals.votes} trainer replies in the last ${window.days} days; ${totals.unhelpful} were marked unhelpful.`,
      topReasons.length > 0
        ? `The most common reasons were ${topReasons
            .map((entry) => FEEDBACK_REASON_LABELS[entry.reason].toLowerCase())
            .join(", ")}.`
        : "No reasons were attached to the unhelpful votes.",
    ].join(" "),
    painPoints: topReasons.map((entry) => painPoint(entry.reason, entry.count)),
    trends: summary.byPromptVersion.slice(0, TOP_REASONS).map((version) => {
      const versionShare = unhelpfulShare(version);
      return `Trainer prompt v${version.promptVersion}: ${version.votes} votes, ${
        versionShare === null ? 0 : Math.round(versionShare * 100)
      }% unhelpful`;
    }),
    evidence: [
      {
        finding: `${totals.noted} of the votes carried a note in the learner's own words.`,
      },
      ...(worstTool === null
        ? []
        : [
            {
              finding: `Replies that used ${worstTool.tool} drew the most unhelpful votes (${worstTool.unhelpful} of ${worstTool.votes}).`,
            },
          ]),
    ],
    // First-party evidence about this product's own learners outranks a forum
    // thread about learners in general.
    relevanceScore: 0.9,
  };

  return marketFindingSchema.parse(finding);
}

/**
 * What the research agent's tool hands back: the counts, and the notes.
 *
 * The notes are learners' words and ride inside the tool's fence; the counts
 * are arithmetic. Bounded to what a cheap-tier turn can read.
 */
export function feedbackForAgent(summary: LearnerFeedbackSummary): Record<string, unknown> {
  return {
    windowDays: summary.window.days,
    totals: summary.totals,
    unhelpfulShare: unhelpfulShare(summary.totals),
    byReason: summary.byReason.map((entry) => ({
      reason: entry.reason,
      label: FEEDBACK_REASON_LABELS[entry.reason],
      count: entry.count,
    })),
    byPromptVersion: summary.byPromptVersion,
    byTool: summary.byTool.slice(0, 5),
    notes: summary.recentNotes.slice(0, 10).map((entry) => ({
      note: entry.note,
      verdict: entry.verdict,
      reasons: entry.reasons,
    })),
  };
}
