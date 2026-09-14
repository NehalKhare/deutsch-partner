import {
  CHALLENGE_LEVELS,
  EXPLANATION_DEPTHS,
  MAX_DISPUTED_CORRECTIONS,
  type CoachingDials,
  type FeedbackReason,
  type FeedbackVerdict,
  type PracticeFocus,
  type TrainerCoachingProfile,
} from "@/domain/trainer-coaching";
import { MAX_AGENDA_ITEMS } from "@/domain/trainer-session";
import { GRAMMAR_SLOTS, type AgendaMix } from "@/lib/trainer/agenda";

/**
 * How feedback becomes coaching.
 *
 * Pure rules, no I/O — the same discipline as learning/review.ts and for the
 * same reason: what a "too long" vote does to a learner's trainer is a
 * product decision, and a product decision belongs in code that a test can
 * pin, not in a model's reading of the vote. Each rule moves one dial one
 * step and clamps at the end of its range. One vote is enough to move a dial,
 * deliberately: the learner attached a reason, which is an explicit request,
 * and a preference the product argues with is a preference it does not hold.
 *
 * The one thing no dial fixes is a wrong correction. That is counted, and
 * past a threshold the trainer is told to check a rule before it corrects —
 * a change to what it does, not a plea to do better — and helpful votes wind
 * the counter back down, so a trainer that recovered stops being told off.
 */

/** A dial, before and after. What a response can tell the learner changed. */
export interface DialChange {
  readonly dial: keyof CoachingDials;
  readonly from: CoachingDials[keyof CoachingDials];
  readonly to: CoachingDials[keyof CoachingDials];
}

export interface CoachingUpdate {
  readonly profile: TrainerCoachingProfile;
  readonly changed: readonly DialChange[];
}

/** How many items a short sitting plans. A coffee break, not a lesson. */
export const SHORT_SESSION_ITEMS = 5;

/** The agenda size a learner's dials ask for. */
export function agendaSizeFor(dials: Pick<CoachingDials, "sessionLength">): number {
  return dials.sessionLength === "short" ? SHORT_SESSION_ITEMS : MAX_AGENDA_ITEMS;
}

/**
 * How the agenda is mixed for each focus.
 *
 * Balanced is the composer's own rule: one grammar item per three working
 * slots, capped at two. A grammar focus doubles the cap and halves the
 * interval, so a full sitting holds three or four rules; a vocabulary focus
 * keeps a single grammar slot, because recorded mistakes fill grammar slots
 * first and a learner who asked for words has not asked to keep making them.
 */
export const MIX_FOR_FOCUS: Readonly<Record<PracticeFocus, AgendaMix>> = {
  balanced: { grammarSlots: GRAMMAR_SLOTS, grammarEvery: 3 },
  grammar: { grammarSlots: GRAMMAR_SLOTS * 2, grammarEvery: 2 },
  vocabulary: { grammarSlots: 1, grammarEvery: 4 },
};

function step<T extends string>(
  scale: readonly T[],
  current: T,
  direction: -1 | 1,
): T {
  const index = scale.indexOf(current);
  const next = Math.min(scale.length - 1, Math.max(0, index + direction));
  return scale[next];
}

/**
 * What each reason does. A reason that is not here moves no dial, and the
 * table is exhaustive over the closed set so adding a reason without a rule
 * fails to compile rather than quietly doing nothing.
 */
const REASON_RULES: Readonly<
  Record<FeedbackReason, (dials: CoachingDials) => Partial<CoachingDials>>
> = {
  too_long: (dials) => ({
    explanationDepth: step(EXPLANATION_DEPTHS, dials.explanationDepth, -1),
  }),
  too_short: (dials) => ({
    explanationDepth: step(EXPLANATION_DEPTHS, dials.explanationDepth, 1),
  }),
  unclear: (dials) => ({
    explanationDepth: step(EXPLANATION_DEPTHS, dials.explanationDepth, 1),
  }),
  too_hard: (dials) => ({ challenge: step(CHALLENGE_LEVELS, dials.challenge, -1) }),
  too_easy: (dials) => ({ challenge: step(CHALLENGE_LEVELS, dials.challenge, 1) }),
  skip_news: () => ({ news: false }),
  // Counted, not dialled: see applyFeedback.
  wrong_correction: () => ({}),
};

const DIAL_KEYS = [
  "explanationDepth",
  "challenge",
  "sessionLength",
  "focus",
  "news",
] as const satisfies readonly (keyof CoachingDials)[];

function diff(before: CoachingDials, after: CoachingDials): DialChange[] {
  return DIAL_KEYS.flatMap((dial) =>
    before[dial] === after[dial] ? [] : [{ dial, from: before[dial], to: after[dial] }],
  );
}

/**
 * One vote, folded in.
 *
 * Reasons apply in order over the running dials, so "too long" and "too
 * short" on one vote cancel rather than both landing. Helpful votes move no
 * dial — a learner happy with the coaching has asked for nothing — but they
 * do wind the dispute counter down, one per vote.
 */
export function applyFeedback(
  profile: TrainerCoachingProfile,
  feedback: { readonly verdict: FeedbackVerdict; readonly reasons: readonly FeedbackReason[] },
  at: Date,
): CoachingUpdate {
  if (feedback.verdict === "helpful") {
    return {
      profile: {
        ...profile,
        helpfulCount: profile.helpfulCount + 1,
        disputedCorrections: Math.max(0, profile.disputedCorrections - 1),
        updatedAt: at,
      },
      changed: [],
    };
  }

  let dials: CoachingDials = profile;
  for (const reason of feedback.reasons) {
    dials = { ...dials, ...REASON_RULES[reason](dials) };
  }
  const disputed = feedback.reasons.includes("wrong_correction")
    ? Math.min(MAX_DISPUTED_CORRECTIONS, profile.disputedCorrections + 1)
    : profile.disputedCorrections;

  const next: TrainerCoachingProfile = {
    ...profile,
    explanationDepth: dials.explanationDepth,
    challenge: dials.challenge,
    sessionLength: dials.sessionLength,
    focus: dials.focus,
    news: dials.news,
    disputedCorrections: disputed,
    unhelpfulCount: profile.unhelpfulCount + 1,
    updatedAt: at,
  };

  return { profile: next, changed: diff(profile, next) };
}

/**
 * A request made in so many words — "shorter sessions, please" — set directly.
 * The tool that calls this hands over a closed-set partial, so there is nothing
 * to interpret: the learner asked for a setting, and this is the setting.
 */
export function applyAdjustment(
  profile: TrainerCoachingProfile,
  request: Partial<CoachingDials>,
  at: Date,
): CoachingUpdate {
  const next: TrainerCoachingProfile = {
    ...profile,
    ...Object.fromEntries(
      Object.entries(request).filter(([, value]) => value !== undefined),
    ),
    updatedAt: at,
  };

  return { profile: next, changed: diff(profile, next) };
}

/**
 * Each dial's non-default position, in the learner's words.
 *
 * Shared by the session's "tuned for you" line and the settings page, so the
 * two never describe the same setting differently. Default positions render
 * nothing: the list is what has changed, and an unchanged trainer has no list.
 */
export function describeDials(dials: CoachingDials): string[] {
  const said: string[] = [];
  if (dials.explanationDepth === "brief") said.push("brief explanations");
  if (dials.explanationDepth === "detailed") said.push("detailed explanations");
  if (dials.challenge === "gentler") said.push("gentler exercises");
  if (dials.challenge === "harder") said.push("harder exercises");
  if (dials.sessionLength === "short") said.push("shorter sessions");
  if (dials.focus === "vocabulary") said.push("a vocabulary focus");
  if (dials.focus === "grammar") said.push("a grammar focus");
  if (!dials.news) said.push("no news item");
  return said;
}

/**
 * Each reason in words, shared by the vote's chips and the operator's view so
 * a learner and an operator read the same thing about the same vote.
 */
export const FEEDBACK_REASON_LABELS: Readonly<Record<FeedbackReason, string>> = {
  too_long: "Too long",
  too_short: "Too brief",
  too_hard: "Too hard",
  too_easy: "Too easy",
  unclear: "Unclear",
  wrong_correction: "The correction was wrong",
  skip_news: "Skip the news",
};
