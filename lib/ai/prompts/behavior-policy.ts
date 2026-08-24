import { z } from "zod";

import { cefrLevelSchema, type CEFRLevel } from "@/domain/cefr";
import { CORRECTION_PREFERENCES } from "@/domain/learner";

/**
 * One policy shape, parameterised by level.
 *
 * business-objective.md S4 is explicit that the three personalities must be
 * configuration and not three agents or three forked prompt files. So this is
 * a lookup returning data, and the prompt text is rendered from it. Adding a
 * fourth level would mean adding a row, not writing a new prompt.
 *
 * Selecting a policy is named in the routing table as explicitly not a model
 * call. It is a configuration lookup, and it stays one.
 */

export const CORRECTION_STYLES = [
  "gentle_reformulation",
  "deliberate",
  "selective",
] as const;

export const ENGLISH_SUPPORT_LEVELS = ["as_needed", "brief_only", "rare"] as const;

export const behaviorPolicySchema = z.strictObject({
  cefr: cefrLevelSchema,
  /** How the tutor should come across, in one line the prompt can render. */
  persona: z.string().min(1).max(200),
  priorities: z.array(z.string().min(1).max(80)).min(3).max(12),
  correctionStyle: z.enum(CORRECTION_STYLES),
  englishSupport: z.enum(ENGLISH_SUPPORT_LEVELS),
  maxSentences: z.number().int().min(1).max(12),
  /** New words the tutor may introduce in one turn, beyond what is known. */
  newVocabularyBudget: z.number().int().min(0).max(8),
  grammarJargon: z.enum(["none", "minimal", "as_needed"]),
  /** Whether a turn should normally end by handing the floor back. */
  invitesReply: z.boolean(),
  /** The share of a turn that should be comfortably understood already. */
  comprehensibleShare: z.number().min(0.5).max(1),
});

export type BehaviorPolicy = z.infer<typeof behaviorPolicySchema>;

/** business-objective.md S7: comprehensible progression, not maximum difficulty. */
const COMPREHENSIBLE_SHARE = 0.8;

const BY_LEVEL: Readonly<Record<CEFRLevel, BehaviorPolicy>> = {
  A1: {
    cefr: "A1",
    persona:
      "a warm adult helping someone take their very first steps in German, delighted by every attempt",
    priorities: [
      "imitation and repetition",
      "very short concrete sentences",
      "high comprehension, low cognitive load",
      "gentle reformulation rather than correction",
      "frequent but varied encouragement",
    ],
    correctionStyle: "gentle_reformulation",
    englishSupport: "as_needed",
    maxSentences: 3,
    newVocabularyBudget: 2,
    grammarJargon: "none",
    invitesReply: true,
    comprehensibleShare: COMPREHENSIBLE_SHARE,
  },
  A2: {
    cefr: "A2",
    persona: "a kind teacher who notices patterns and builds on them",
    priorities: [
      "pattern recognition and controlled variation",
      "practical everyday conversation",
      "brief grammar explanations",
      "deliberate correction",
      "recycling vocabulary the learner has met",
      "roleplay and growing independence",
    ],
    correctionStyle: "deliberate",
    englishSupport: "brief_only",
    maxSentences: 5,
    newVocabularyBudget: 3,
    grammarJargon: "minimal",
    invitesReply: true,
    comprehensibleShare: COMPREHENSIBLE_SHARE,
  },
  B1: {
    cefr: "B1",
    persona: "a German-speaking friend who is genuinely interested in the answer",
    priorities: [
      "natural conversation with real opinions",
      "reasoning, storytelling and problem solving",
      "follow-up questions rather than scaffolding",
      "selective correction of what actually blocks meaning",
      "natural alternatives and occasional idiom",
    ],
    correctionStyle: "selective",
    englishSupport: "rare",
    maxSentences: 8,
    newVocabularyBudget: 4,
    grammarJargon: "as_needed",
    invitesReply: true,
    comprehensibleShare: COMPREHENSIBLE_SHARE,
  },
};

/**
 * The learner's stated correction preference narrows the level's default. It
 * can make correction lighter or heavier, but it cannot turn A1's reformulation
 * into a grammar lecture: the level sets the ceiling on how technical the
 * feedback gets.
 */
const PREFERENCE_STYLE: Readonly<
  Record<(typeof CORRECTION_PREFERENCES)[number], (typeof CORRECTION_STYLES)[number]>
> = {
  gentle: "gentle_reformulation",
  explicit: "deliberate",
  minimal: "selective",
};

export interface BehaviorPolicyInput {
  readonly cefr: CEFRLevel;
  readonly correctionPreference?: (typeof CORRECTION_PREFERENCES)[number];
}

export function behaviorPolicyFor(input: BehaviorPolicyInput): BehaviorPolicy {
  const base = BY_LEVEL[input.cefr];
  if (!input.correctionPreference) return base;

  const preferred = PREFERENCE_STYLE[input.correctionPreference];

  return {
    ...base,
    // A1 never gets deliberate grammar correction, whatever was asked for:
    // the level decides how much technical feedback is useful at all.
    correctionStyle:
      input.cefr === "A1" && preferred === "deliberate"
        ? base.correctionStyle
        : preferred,
  };
}
