import { z } from "zod";

import { cefrLevelSchema } from "@/domain/cefr";
import {
  CORRECTION_PREFERENCE_OPTIONS,
  INTEREST_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
  NATIVE_LANGUAGE_OPTIONS,
  TOPIC_OPTIONS,
} from "@/lib/onboarding/defaults";

const values = (options: ReadonlyArray<{ value: string }>) =>
  options.map((option) => option.value) as [string, ...string[]];

/** Rejects a list containing the same choice twice. */
const distinct = <T>(list: T[]) => new Set(list).size === list.length;

/**
 * What a learner may submit.
 *
 * No learner id: it comes from the verified session, so there is nothing here
 * to forge. Every list is a closed set with a cap, because these values become
 * retrieval filters and prompt content on every turn.
 */
export const onboardingInputSchema = z.strictObject({
  nativeLanguage: z.enum(values(NATIVE_LANGUAGE_OPTIONS)),
  learningGoal: z.string().trim().min(1).max(500),
  selectedLevel: cefrLevelSchema,
  targetTopics: z
    .array(z.enum(values(TOPIC_OPTIONS)))
    .max(MAX_SELECTED_TOPICS)
    .refine(distinct, { error: "Please choose each topic only once." }),
  interests: z
    .array(z.enum(values(INTEREST_OPTIONS)))
    .max(MAX_SELECTED_INTERESTS)
    .refine(distinct, { error: "Please choose each interest only once." }),
  inputPreference: z.enum(["text", "voice"]),
  outputPreference: z.enum(["text", "voice"]),
  correctionPreference: z.enum(values(CORRECTION_PREFERENCE_OPTIONS)),
});

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;

export type OnboardingParseResult =
  | { readonly success: true; readonly data: OnboardingInput }
  | { readonly success: false; readonly message: string };

/** Field labels, so a validation message names something the learner can see. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  nativeLanguage: "native language",
  learningGoal: "learning goal",
  selectedLevel: "current level",
  targetTopics: "topics",
  interests: "interests",
  inputPreference: "input preference",
  outputPreference: "reply preference",
  correctionPreference: "correction preference",
};

/**
 * What to say when a list is over its cap.
 *
 * The form disables the remaining options at the limit, so this is only
 * reachable by a submission that did not come from it. It still names the
 * number, because "please check your topics" tells somebody holding eight of
 * them nothing they did not already know.
 */
const OVER_LIMIT: Readonly<Record<string, string>> = {
  targetTopics: `Please choose at most ${MAX_SELECTED_TOPICS} topics.`,
  interests: `Please choose at most ${MAX_SELECTED_INTERESTS} interests.`,
};

export function parseOnboardingForm(formData: FormData): OnboardingParseResult {
  const parsed = onboardingInputSchema.safeParse({
    nativeLanguage: formData.get("nativeLanguage"),
    learningGoal: formData.get("learningGoal"),
    selectedLevel: formData.get("selectedLevel"),
    // An unchecked checkbox group submits nothing at all, which is an empty
    // selection rather than a missing field.
    targetTopics: formData.getAll("targetTopics").map(String),
    interests: formData.getAll("interests").map(String),
    inputPreference: formData.get("inputPreference"),
    outputPreference: formData.get("outputPreference"),
    correctionPreference: formData.get("correctionPreference"),
  });

  if (parsed.success) return { success: true, data: parsed.data };

  const issue = parsed.error.issues[0];
  const path = String(issue?.path[0] ?? "");
  const field = FIELD_LABELS[path] ?? "details";

  if (issue?.code === "too_big" && OVER_LIMIT[path]) {
    return { success: false, message: OVER_LIMIT[path] };
  }

  return {
    success: false,
    message: `Please check your ${field} and try again.`,
  };
}
