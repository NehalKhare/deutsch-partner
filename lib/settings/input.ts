import { z } from "zod";

import { CORRECTION_PREFERENCES } from "@/domain/learner";
import { VOICE_GENDERS } from "@/domain/tutor";
import {
  INTEREST_OPTIONS,
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
  NATIVE_LANGUAGE_OPTIONS,
  TOPIC_OPTIONS,
} from "@/lib/onboarding/defaults";

const values = (options: ReadonlyArray<{ value: string }>) =>
  options.map((option) => option.value) as [string, ...string[]];

const distinct = <T>(list: T[]) => new Set(list).size === list.length;

/**
 * What the settings form may change.
 *
 * The onboarding answers, minus the level: the level is position, it lives on
 * the curriculum page where a learner can see what moving means, and a
 * settings form that quietly relocated the syllabus would be the wrong kind
 * of surprise. No learner id either — it comes from the verified session.
 */
export const settingsInputSchema = z.strictObject({
  nativeLanguage: z.enum(values(NATIVE_LANGUAGE_OPTIONS)),
  learningGoal: z.string().trim().min(1).max(500),
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
  // The domain's own enum rather than the option list's values, so the parse
  // result is assignable to a profile without a cast — and a drifted option
  // list fails a test instead of widening a type.
  correctionPreference: z.enum(CORRECTION_PREFERENCES),
  voicePreference: z.enum(VOICE_GENDERS),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

export type SettingsParseResult =
  | { readonly success: true; readonly data: SettingsInput }
  | { readonly success: false; readonly message: string };

const FIELD_LABELS: Readonly<Record<string, string>> = {
  nativeLanguage: "native language",
  learningGoal: "learning goal",
  targetTopics: "topics",
  interests: "interests",
  inputPreference: "input preference",
  outputPreference: "reply preference",
  correctionPreference: "correction preference",
  voicePreference: "voice",
};

const OVER_LIMIT: Readonly<Record<string, string>> = {
  targetTopics: `Please choose at most ${MAX_SELECTED_TOPICS} topics.`,
  interests: `Please choose at most ${MAX_SELECTED_INTERESTS} interests.`,
};

export function parseSettingsForm(formData: FormData): SettingsParseResult {
  const parsed = settingsInputSchema.safeParse({
    nativeLanguage: formData.get("nativeLanguage"),
    learningGoal: formData.get("learningGoal"),
    // An unchecked checkbox group submits nothing at all, which is an empty
    // selection rather than a missing field.
    targetTopics: formData.getAll("targetTopics").map(String),
    interests: formData.getAll("interests").map(String),
    inputPreference: formData.get("inputPreference"),
    outputPreference: formData.get("outputPreference"),
    correctionPreference: formData.get("correctionPreference"),
    voicePreference: formData.get("voicePreference"),
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

export interface SettingsFormState {
  readonly status: "idle" | "saved" | "error";
  readonly message: string | null;
}

export const INITIAL_SETTINGS_STATE: SettingsFormState = {
  status: "idle",
  message: null,
};

export const SETTINGS_SAVED: SettingsFormState = {
  status: "saved",
  message: "Saved. Your next conversation uses these.",
};

export function settingsError(message: string): SettingsFormState {
  return { status: "error", message };
}

export type SettingsAction = (
  state: SettingsFormState,
  formData: FormData,
) => Promise<SettingsFormState>;
