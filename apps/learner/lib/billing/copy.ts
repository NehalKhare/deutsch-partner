import { TRIAL_DAYS } from "@dp/domain/billing";
import { PLAN_CATALOGUE, type PlanCode, type PlanFeature } from "@dp/domain/plans";
import { ceilingsFor, tierFor, type Tier } from "@dp/domain/tasks";

import { ASSESSMENT_FAQ, type Faq } from "@/lib/landing/faq";

/**
 * What the pricing page, the landing page and the order page say about each
 * plan.
 *
 * Every number here is read from the plan catalogue, and the tutor model from
 * the routing table, so the words cannot promise more turns than the quota
 * counts or a stronger model than the table routes to. Prices are absent on
 * purpose: they are Stripe's, mirrored with a fetched_at stamp, and read at
 * request time (billing-and-plans-spec.md S7).
 *
 * A feature the catalogue grants but the product has not built yet is said to
 * be coming, never sold as if it were here. Same register as the landing
 * page: each line names a thing and stops.
 */

export const RECOMMENDED_PLAN: PlanCode = "plus";

/** The withdrawal period, in days, as the order page and the FAQ state it (§355(2) BGB). */
export const WITHDRAWAL_DAYS = 14;

export function planName(plan: PlanCode): string {
  return PLAN_CATALOGUE[plan].name;
}

export const PLAN_TAGLINES: Readonly<Record<PlanCode, string>> = {
  free: "A real tutor every day, with room to reach A1 without paying.",
  plus: "More conversation, the stronger tutor, and a natural voice.",
  premium: "The most practice, the widest context, and voice everywhere.",
};

/** What each chat tier is called on a pricing page. Named for what a learner notices. */
const TUTOR_MODEL_LABELS: Readonly<Partial<Record<Tier, string>>> = {
  reasoning: "Our strongest tutor model",
  strong: "Our strongest tutor model",
  mid: "A fast, capable tutor model",
  cheap: "A lighter tutor model",
  nano: "A lighter tutor model",
};

/** The tutor model a plan's conversation turns run on, from the routing table. */
export function tutorModelLabel(plan: PlanCode): string {
  return TUTOR_MODEL_LABELS[tierFor("conversation.turn", plan)] ?? "A capable tutor model";
}

/**
 * Whether a plan's tutor keeps more of the conversation in view than the
 * level table gives, measured where the widening is largest.
 */
function hasWiderContext(plan: PlanCode): boolean {
  return (
    ceilingsFor("conversation.turn", "B1", plan).maxInputTokens >
    ceilingsFor("conversation.turn", "B1").maxInputTokens
  );
}

/** Features the catalogue grants that the product does not have yet. */
const COMING_SOON: ReadonlySet<PlanFeature> = new Set<PlanFeature>([
  "handsFreeConversation",
  "milestoneReports",
  "longTermMemory",
]);

const soon = (feature: PlanFeature, label: string) =>
  COMING_SOON.has(feature) ? `${label} (coming soon)` : label;

/**
 * Four or five lines per card: the model first, because it is the difference
 * a learner feels in the first reply, then the daily volume, then the voice.
 */
export function planHighlights(plan: PlanCode): readonly string[] {
  const { dailyQuotas: quota, features } = PLAN_CATALOGUE[plan];
  const lines = [tutorModelLabel(plan)];

  if (hasWiderContext(plan)) lines.push("More of the conversation kept in view");
  lines.push(`${quota.tutor_turns} tutor turns a day`);
  if (!hasWiderContext(plan)) lines.push(`${quota.trainer_requests} Trainer requests a day`);

  if (features.modelVoice) {
    lines.push(
      features.trainerVoice
        ? `${quota.voice_lines} AI voice lines a day, in the Trainer too`
        : `${quota.voice_lines} AI voice lines a day`,
    );
  }
  if (features.handsFreeConversation) {
    lines.push(soon("handsFreeConversation", "Hands-free conversation"));
  } else {
    lines.push(`${quota.transcriptions} spoken answers a day`);
  }
  if (!features.modelVoice) lines.push("Replies read aloud by your device's own voice, unlimited");

  return lines;
}

export interface ComparisonRow {
  readonly label: string;
  /** A figure or a phrase, or a yes/no for a feature. */
  readonly values: Readonly<Record<PlanCode, string | boolean>>;
  /** Granted by the catalogue, not built yet. Shown, and said to be coming. */
  readonly comingSoon?: boolean;
}

function perPlan<T extends string | boolean>(value: (plan: PlanCode) => T): Record<PlanCode, T> {
  return { free: value("free"), plus: value("plus"), premium: value("premium") };
}

const feature = (label: string, key: PlanFeature): ComparisonRow => ({
  label,
  values: perPlan((plan) => PLAN_CATALOGUE[plan].features[key]),
  ...(COMING_SOON.has(key) ? { comingSoon: true } : {}),
});

/** The full table on /pricing. Every cell is derived; nothing here is typed twice. */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  { label: "Tutor model", values: perPlan(tutorModelLabel) },
  {
    label: "Conversation context per reply",
    values: perPlan((plan) => (hasWiderContext(plan) ? "Extended" : "Standard")),
  },
  {
    label: "Reference passages per reply",
    values: perPlan((plan) => String(PLAN_CATALOGUE[plan].retrievalTopK)),
  },
  {
    label: "Tutor turns a day",
    values: perPlan((plan) => String(PLAN_CATALOGUE[plan].dailyQuotas.tutor_turns)),
  },
  {
    label: "Trainer requests a day",
    values: perPlan((plan) => String(PLAN_CATALOGUE[plan].dailyQuotas.trainer_requests)),
  },
  {
    label: "Spoken answers a day",
    values: perPlan((plan) => String(PLAN_CATALOGUE[plan].dailyQuotas.transcriptions)),
  },
  {
    label: "AI voice lines a day",
    values: perPlan((plan) =>
      PLAN_CATALOGUE[plan].features.modelVoice
        ? String(PLAN_CATALOGUE[plan].dailyQuotas.voice_lines)
        : "Device voice only",
    ),
  },
  feature("Voice in the Trainer", "trainerVoice"),
  feature("Hands-free conversation", "handsFreeConversation"),
  feature("Milestone readiness reports", "milestoneReports"),
  feature("Long-term tutor memory", "longTermMemory"),
];

/**
 * What no plan gates, ever (spec S4). Stated on every page that sells a plan,
 * because the fear worth answering is that paying is how you keep what you
 * already have.
 */
export const ALWAYS_FREE: readonly string[] = [
  "Catch up: spaced review of your words and your mistakes",
  "The whole curriculum, every mini-level open. No locked chapters",
  "Your dashboard and your progress",
  "Comprehension scenarios",
  "Replies read aloud in your device's own voice, unlimited",
  "Everything we store about you, yours to read",
];

/** The same promise in one line, for the landing page, where a list would outweigh the plans. */
export const ALWAYS_FREE_SHORT =
  "Catch up and its reviews, the whole curriculum with no locked chapters, your dashboard, " +
  "the scenarios, and your device's own voice.";

/** The methods Stripe may offer. Which appear is the Stripe Dashboard's decision, per country. */
export const PAYMENT_METHODS =
  "cards (Visa, Mastercard, American Express), Apple Pay, Google Pay, Klarna, " +
  "SEPA Direct Debit and PayPal";

/** The questions a visitor asks before paying. On /pricing and in its structured data. */
export const PRICING_FAQ: readonly Faq[] = [
  {
    question: "Is Free really free?",
    answer:
      "Yes. Free is a real plan with daily limits, and it never asks for a card. " +
      "It is enough practice to reach A1 without paying.",
  },
  {
    question: "How can I pay?",
    answer:
      `By ${PAYMENT_METHODS}, where available at checkout. Payment happens on ` +
      "Stripe's secure page, and we never see your card or bank details.",
  },
  {
    question: "Do prices include VAT?",
    answer: "Yes. Every price shown here and on the order page includes VAT.",
  },
  {
    question: "Can I cancel?",
    answer:
      "Yes, cancel any time from Plan & billing. Your plan runs to the end of the " +
      "period you have paid for and then stops. A pass simply ends; there is nothing to cancel.",
  },
  {
    question: "What if I change my mind?",
    answer:
      `You can withdraw from a paid order within ${WITHDRAWAL_DAYS} days. Because your tutor starts ` +
      "straight away, withdrawing means paying only for the days you have used.",
  },
  {
    question: `What happens when the ${TRIAL_DAYS}-day Premium trial ends?`,
    answer:
      "It ends. No card is asked for, so nothing is charged and nothing renews: " +
      "you are back on Free unless you choose a plan. There is one trial per account.",
  },
  {
    question: "What is a pass?",
    answer:
      "One payment for a fixed number of days of Plus or Premium, with no renewal. " +
      "Buying another pass of the same plan adds its days after the first one ends.",
  },
  ASSESSMENT_FAQ,
];

// --- the order page ------------------------------------------------------------

/**
 * The words on the button that places a paid order, exactly (§312j(3) BGB).
 * OLG Düsseldorf (20 UKl 4/23) held that "Abonnieren" does not say it; this
 * is the wording the statute itself offers. Hosted Checkout's button cannot
 * be relabelled, which is why the order is placed here and not there.
 */
export const ORDER_BUTTON_LABEL = "Order with obligation to pay";

/**
 * The early-start request (spec S11). An AI tutor is a digital service, so
 * the right of withdrawal does not lapse on first use; what the learner asks
 * for is an immediate start, knowing that withdrawing means paying for the
 * days already used (§357a(2) BGB). Unticked by default, always.
 *
 * A pass bought while one of the same plan runs starts when that one ends,
 * not now — and the request says so, with the date, rather than recording a
 * consent to a start that will not happen. It still asks for that start even
 * if it falls inside the withdrawal period, which a start 180 days away will
 * not, and the consequence of withdrawing is the same.
 */
export function earlyStartConsent(product: string, startsOn: string | null = null): string {
  if (startsOn !== null) {
    return (
      `I ask for ${product} to start on ${startsOn}, when my current pass ends, even if that is within ` +
      `the ${WITHDRAWAL_DAYS}-day withdrawal period. I understand that if I withdraw after it has started, ` +
      `I pay for the days I have already used.`
    );
  }
  return (
    `I ask for ${product} to start immediately. I understand that if I withdraw within ` +
    `${WITHDRAWAL_DAYS} days, I pay for the days I have already used.`
  );
}
