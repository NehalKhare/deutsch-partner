import { deriveEffectiveLevel } from "../learner";
import type { CEFRLevel } from "../cefr";
import type { LearnerState } from "../learner";

/**
 * Onboarding defaults and the choices offered.
 *
 * The option lists are closed sets: topics and interests end up in retrieval
 * filters and in prompts, so free text would mean unbounded values reaching
 * both.
 */

export interface Option {
  readonly value: string;
  readonly label: string;
}

export const NATIVE_LANGUAGE_OPTIONS: readonly Option[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "pt", label: "Portuguese" },
  { value: "hi", label: "Hindi" },
  { value: "zh", label: "Chinese" },
  { value: "other", label: "Another language" },
];

export const TOPIC_OPTIONS: readonly Option[] = [
  { value: "travel", label: "Travel and getting around" },
  { value: "daily_life", label: "Everyday life" },
  { value: "work", label: "Work and colleagues" },
  { value: "food", label: "Food and eating out" },
  { value: "hobbies", label: "Hobbies and free time" },
  { value: "study", label: "Study and university" },
  { value: "health", label: "Health and appointments" },
  { value: "culture", label: "Culture and current affairs" },
];

export const INTEREST_OPTIONS: readonly Option[] = [
  { value: "cycling", label: "Cycling" },
  { value: "football", label: "Football" },
  { value: "cooking", label: "Cooking" },
  { value: "music", label: "Music" },
  { value: "films", label: "Films and series" },
  { value: "reading", label: "Reading" },
  { value: "hiking", label: "Hiking" },
  { value: "technology", label: "Technology" },
  { value: "art", label: "Art and museums" },
];

export const CORRECTION_PREFERENCE_OPTIONS: readonly Option[] = [
  { value: "gentle", label: "Gently, woven into the reply" },
  { value: "explicit", label: "Clearly, with a short explanation" },
  { value: "minimal", label: "Rarely, only when it really matters" },
];

export const LEVEL_OPTIONS: ReadonlyArray<Option & { description: string }> = [
  {
    value: "A1",
    label: "I am starting from scratch",
    description: "Single words, greetings, naming things.",
  },
  {
    value: "A2",
    label: "I know some basics",
    description: "Short sentences about everyday situations.",
  },
  {
    value: "B1",
    label: "I can hold a simple conversation",
    description: "Opinions, experiences, explaining yourself.",
  },
];

/**
 * Each selected topic and interest is rendered into the learner context on
 * every turn, so the list is capped rather than merely discouraged.
 */
export const MAX_SELECTED_TOPICS = 5;
export const MAX_SELECTED_INTERESTS = 5;

export interface OnboardingDraft {
  nativeLanguage: string;
  learningGoal: string;
  selectedLevel: CEFRLevel;
  targetTopics: string[];
  interests: string[];
  inputPreference: "text" | "voice";
  outputPreference: "text" | "voice";
  correctionPreference: "gentle" | "explicit" | "minimal";
}

/**
 * A fresh draft. Nothing is pre-selected on the learner's behalf beyond the
 * safe defaults: text mode always works, and A1 is the assumption that cannot
 * leave someone stranded above their level.
 */
export function defaultOnboardingDraft(): OnboardingDraft {
  return {
    nativeLanguage: "en",
    learningGoal: "",
    selectedLevel: "A1",
    targetTopics: [],
    interests: [],
    inputPreference: "text",
    outputPreference: "text",
    correctionPreference: "gentle",
  };
}

/**
 * The state a learner begins with.
 *
 * The level they picked is recorded as `selectedLevel` and nothing more. With
 * no estimate yet, the effective level is A1 and the path starts at
 * mini-level 1 — a self-assessment is a preference, not evidence.
 */
export function initialLearnerState(
  learnerId: string,
  selectedLevel: CEFRLevel,
): LearnerState {
  return {
    learnerId,
    selectedLevel,
    estimatedLevel: null,
    effectiveLevel: deriveEffectiveLevel({
      selectedLevel: "A1",
      estimatedLevel: null,
      confidence: 0,
    }),
    miniLevel: 1,
    furthestMiniLevel: 1,
    skippedMiniLevels: [],
    fluency: 0,
    comprehension: 0,
    confidence: 0,
    updatedAt: new Date(0),
  };
}
