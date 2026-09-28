import { CEFR_LEVELS, MAX_MINI_LEVEL } from "@dp/domain/cefr";
import { PLAN_CATALOGUE } from "@dp/domain/plans";
import { TUTOR, tutorFor } from "@dp/domain/tutor";

import { GUIDED_HOURS, timelinePhrase } from "@/lib/landing/timeline";

/**
 * The questions a visitor asks before signing up, answered plainly.
 *
 * These are on the landing page for a reader and in its structured data for
 * a search engine, and the two must say the same thing: Google only honours
 * FAQ markup that matches what is visible on the page. The answers are also
 * what an answer engine quotes back when somebody asks it about the product,
 * which is why every figure here is computed from the same constants the
 * product runs on rather than typed in — "about two years" is exactly the
 * kind of number that gets copied wrong once and repeated ten thousand times.
 */
export interface Faq {
  readonly question: string;
  readonly answer: string;
}

const lastLevel = CEFR_LEVELS[CEFR_LEVELS.length - 1]!;

const turns = (plan: keyof typeof PLAN_CATALOGUE) => PLAN_CATALOGUE[plan].dailyQuotas.tutor_turns;

/**
 * The fear worth answering before anyone pays: that paying buys a better
 * grade, or that not paying buys a worse one (billing-and-plans-spec.md S4).
 * Asked on the landing page and on /pricing, in the same words.
 */
export const ASSESSMENT_FAQ: Faq = {
  question: "Does paying change how I am assessed?",
  answer:
    `No. Every plan gets the same evaluation, the same levels and the same curriculum. ` +
    `A plan buys more practice with ${TUTOR.name} and a stronger tutor model, never a different grade.`,
};

export const FAQ: readonly Faq[] = [
  {
    question: "What is Deutsch Partner?",
    answer:
      `An AI conversation partner for English speakers learning German. It talks to ` +
      `you in German pitched at your level, corrects your mistakes in the flow of the ` +
      `conversation, and keeps track of what you know so nothing is ever a fresh start.`,
  },
  {
    question: "Which levels does it cover?",
    answer:
      `From your first word to ${lastLevel}: ${CEFR_LEVELS.join(", ")}, laid out as ` +
      `${MAX_MINI_LEVEL} mini-levels that are all open from day one. There are no locked chapters.`,
  },
  {
    question: `How long does it take to reach ${lastLevel}?`,
    answer:
      `Language schools plan roughly ${GUIDED_HOURS.A1}, ${GUIDED_HOURS.A2} and ` +
      `${GUIDED_HOURS.B1} guided hours to finish A1, A2 and B1. Spent in conversation, ` +
      `that is ${timelinePhrase(lastLevel, 30)} at 30 minutes a day, or ` +
      `${timelinePhrase(lastLevel, 60)} at 60. Everyone's pace differs; the product ` +
      `tells you where you actually are, not where a calendar says you should be.`,
  },
  {
    question: "How does it correct mistakes?",
    answer:
      `In the reply, the way a patient friend would, in language your level can use. ` +
      `A mistake you keep making goes into your review queue and comes back in ` +
      `conversation until it sticks.`,
  },
  {
    question: "Does it cost anything to start?",
    answer:
      "No. Create an account and your first conversation takes about two minutes. " +
      "No card is asked for.",
  },
  {
    question: `What do ${PLAN_CATALOGUE.plus.name} and ${PLAN_CATALOGUE.premium.name} add?`,
    answer:
      `A stronger tutor model, more conversation each day (${turns("plus")} and ` +
      `${turns("premium")} tutor turns, against ${turns("free")} on ${PLAN_CATALOGUE.free.name}), ` +
      `and a natural AI voice. ${PLAN_CATALOGUE.premium.name} also keeps more of each conversation ` +
      `in view. Prices are on the pricing page, and they include VAT.`,
  },
  ASSESSMENT_FAQ,
  {
    question: "Does it issue certificates?",
    answer:
      `No. Deutsch Partner estimates your readiness for ${lastLevel} and says what the ` +
      `estimate is based on. It never tells you that you have passed an exam you have not sat.`,
  },
  {
    question: "Who am I talking to?",
    answer:
      `A tutor named ${TUTOR.name}, the same one every session — or ` +
      `${tutorFor("female").name}, if you choose the female voice in settings. ` +
      `Replies can be read aloud, and you can answer with your voice.`,
  },
];
