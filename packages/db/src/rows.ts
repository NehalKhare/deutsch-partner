import { z } from "zod";

import { cefrLevelSchema, miniLevelSchema } from "@dp/domain/cefr";
import {
  conversationModeSchema,
  conversationThreadSchema,
} from "@dp/domain/conversation";
import { errorTypeSchema, learnerErrorSchema } from "@dp/domain/learner-error";
import {
  learnerProfileSchema,
  learnerStateSchema,
  type LearnerProfile,
  type LearnerState,
} from "@dp/domain/learner";
import { learnerMemorySchema, type LearnerMemory } from "@dp/domain/memory";
import {
  CHALLENGE_LEVELS,
  EXPLANATION_DEPTHS,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  PRACTICE_FOCUSES,
  SESSION_LENGTHS,
  trainerCoachingProfileSchema,
  trainerFeedbackSchema,
  type TrainerCoachingProfile,
  type TrainerFeedback,
} from "@dp/domain/trainer-coaching";
import { levelPerformanceSchema, type LevelPerformance } from "@dp/domain/performance";
import {
  grammarPatternCategorySchema,
  grammarPatternSchema,
} from "@dp/domain/grammar";
import {
  learnerVocabularySchema,
  vocabularyItemSchema,
  vocabularyStatusSchema,
  type LearnerVocabulary,
} from "@dp/domain/vocabulary";

/**
 * Row schemas and mappers.
 *
 * The database speaks snake_case and returns numerics as strings; the domain
 * speaks camelCase with real numbers and Dates. Keeping the translation in one
 * place means no repository ever hands a raw row outward, and no caller ever
 * has to know a column name.
 */

/**
 * Checks a mapped row against its domain schema and reports what is wrong.
 *
 * Calling .parse() inside a transform escapes safeParse as an exception, so a
 * malformed row would surface as a crash instead of a repository error. This
 * adds the issues to the surrounding parse, which decodeRow turns into
 * invalid_data. The column types are already checked by the row schema; this
 * is what catches the rules that span columns, and it is the difference
 * between validating a row and merely asserting its shape.
 */
function validated<T>(
  schema: z.ZodType<T>,
  value: unknown,
  ctx: z.RefinementCtx,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  }

  return z.NEVER;
}

/** Postgres numeric arrives over the wire as a string. */
const numericSchema = z.union([z.number(), z.string()]).transform(Number);

const timestampColumn = z.union([
  z.date(),
  z.string().transform((value) => new Date(value)),
]);

// --- profiles ---------------------------------------------------------------

export const profileRowSchema = z.object({
  id: z.uuid(),
  native_language: z.string(),
  learning_goal: z.string(),
  selected_level: cefrLevelSchema,
  target_topics: z.array(z.string()),
  interests: z.array(z.string()),
  input_preference: z.enum(["text", "voice"]),
  output_preference: z.enum(["text", "voice"]),
  correction_preference: z.enum(["gentle", "explicit", "minimal"]),
  // Defaulted at the mapper as well as in the database: a deployment that has
  // the new code but not yet the new column must keep reading profiles — a
  // read that fails here takes every conversation down with it.
  voice_preference: z.enum(["male", "female"]).default("male"),
  trainer_personality: z.enum(["friendly", "strict"]).default("friendly"),
  mastery_threshold: z
    .union([z.literal(33), z.literal(50), z.literal(80)])
    .default(80),
});

export const profileFromRow = profileRowSchema.transform((row, ctx) =>
  validated(learnerProfileSchema, {
    id: row.id,
    nativeLanguage: row.native_language,
    learningGoal: row.learning_goal,
    selectedLevel: row.selected_level,
    targetTopics: row.target_topics,
    interests: row.interests,
    inputPreference: row.input_preference,
    outputPreference: row.output_preference,
    correctionPreference: row.correction_preference,
    voicePreference: row.voice_preference,
    trainerPersonality: row.trainer_personality,
    masteryThreshold: row.mastery_threshold,
  }, ctx),
);

export function profileToRow(profile: LearnerProfile) {
  return {
    id: profile.id,
    native_language: profile.nativeLanguage,
    learning_goal: profile.learningGoal,
    selected_level: profile.selectedLevel,
    target_topics: profile.targetTopics,
    interests: profile.interests,
    input_preference: profile.inputPreference,
    output_preference: profile.outputPreference,
    correction_preference: profile.correctionPreference,
    voice_preference: profile.voicePreference,
    trainer_personality: profile.trainerPersonality,
    mastery_threshold: profile.masteryThreshold,
  };
}

// --- learner_states ---------------------------------------------------------

export const learnerStateRowSchema = z.object({
  learner_id: z.uuid(),
  selected_level: cefrLevelSchema,
  estimated_level: cefrLevelSchema.nullable(),
  effective_cefr: cefrLevelSchema,
  effective_plus: z.boolean(),
  mini_level: miniLevelSchema,
  furthest_mini_level: miniLevelSchema,
  skipped_mini_levels: z.array(miniLevelSchema),
  fluency: numericSchema,
  comprehension: numericSchema,
  confidence: numericSchema,
  updated_at: timestampColumn,
});

export const learnerStateFromRow = learnerStateRowSchema.transform((row, ctx) =>
  validated(learnerStateSchema, {
    learnerId: row.learner_id,
    selectedLevel: row.selected_level,
    estimatedLevel: row.estimated_level,
    // Not parsed here: the domain schema below checks it, and a throw inside
    // a transform would escape safeParse as an exception.
    effectiveLevel: { cefr: row.effective_cefr, plus: row.effective_plus },
    miniLevel: row.mini_level,
    furthestMiniLevel: row.furthest_mini_level,
    skippedMiniLevels: row.skipped_mini_levels,
    fluency: row.fluency,
    comprehension: row.comprehension,
    confidence: row.confidence,
    updatedAt: row.updated_at,
  }, ctx),
);

export function learnerStateToRow(state: LearnerState) {
  return {
    learner_id: state.learnerId,
    selected_level: state.selectedLevel,
    estimated_level: state.estimatedLevel,
    // The domain models the plus as part of one value; the schema stores it as
    // two columns so a CHECK constraint can forbid B1+.
    effective_cefr: state.effectiveLevel.cefr,
    effective_plus: state.effectiveLevel.plus,
    mini_level: state.miniLevel,
    furthest_mini_level: state.furthestMiniLevel,
    skipped_mini_levels: state.skippedMiniLevels,
    fluency: state.fluency,
    comprehension: state.comprehension,
    confidence: state.confidence,
  };
}

// --- vocabulary -------------------------------------------------------------

export const vocabularyItemRowSchema = z.object({
  id: z.uuid(),
  lemma: z.string(),
  word: z.string(),
  part_of_speech: z.string(),
  gender: z.string().nullable(),
  plural: z.string().nullable(),
  english_translation: z.string(),
  german_definition: z.string(),
  example: z.string(),
  collocations: z.array(z.string()),
  common_mistakes: z.array(z.string()),
  cefr: cefrLevelSchema,
  mini_level: miniLevelSchema,
  topic: z.string(),
  frequency_band: z.number().int(),
  is_core_word: z.boolean(),
});

export const vocabularyItemFromRow = vocabularyItemRowSchema.transform(
  (row, ctx) =>
    validated(vocabularyItemSchema, {
      id: row.id,
      lemma: row.lemma,
      word: row.word,
      partOfSpeech: row.part_of_speech,
      gender: row.gender,
      plural: row.plural,
      englishTranslation: row.english_translation,
      germanDefinition: row.german_definition,
      example: row.example,
      collocations: row.collocations,
      commonMistakes: row.common_mistakes,
      cefr: row.cefr,
      miniLevel: row.mini_level,
      topic: row.topic,
      frequencyBand: row.frequency_band,
      isCoreWord: row.is_core_word,
    }, ctx),
);

export const learnerVocabularyRowSchema = z.object({
  learner_id: z.uuid(),
  vocabulary_item_id: z.uuid(),
  exposure_count: z.number().int(),
  correct_count: z.number().int(),
  incorrect_count: z.number().int(),
  mastery_score: numericSchema,
  confidence: numericSchema,
  last_seen_at: timestampColumn.nullable(),
  next_review_at: timestampColumn.nullable(),
  status: vocabularyStatusSchema,
});

export const learnerVocabularyFromRow = learnerVocabularyRowSchema.transform(
  (row, ctx) => validated(learnerVocabularySchema, {
    learnerId: row.learner_id,
    vocabularyItemId: row.vocabulary_item_id,
    exposureCount: row.exposure_count,
    correctCount: row.correct_count,
    incorrectCount: row.incorrect_count,
    masteryScore: row.mastery_score,
    confidence: row.confidence,
    lastSeenAt: row.last_seen_at,
    nextReviewAt: row.next_review_at,
    status: row.status,
  }, ctx),
);

export function learnerVocabularyToRow(record: LearnerVocabulary) {
  return {
    learner_id: record.learnerId,
    vocabulary_item_id: record.vocabularyItemId,
    exposure_count: record.exposureCount,
    correct_count: record.correctCount,
    incorrect_count: record.incorrectCount,
    mastery_score: record.masteryScore,
    confidence: record.confidence,
    last_seen_at: record.lastSeenAt,
    next_review_at: record.nextReviewAt,
    status: record.status,
  };
}

// --- grammar ----------------------------------------------------------------

export const grammarPatternRowSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  explanation: z.string(),
  examples: z.array(z.string()),
  cefr: cefrLevelSchema,
  mini_level: miniLevelSchema,
  difficulty: z.number().int(),
  common_mistakes: z.array(z.string()),
  related_pattern_keys: z.array(z.string()),
  category: grammarPatternCategorySchema,
});

export const grammarPatternFromRow = grammarPatternRowSchema.transform(
  (row, ctx) =>
    validated(grammarPatternSchema, {
      id: row.id,
      key: row.key,
      name: row.name,
      explanation: row.explanation,
      examples: row.examples,
      cefr: row.cefr,
      miniLevel: row.mini_level,
      difficulty: row.difficulty,
      commonMistakes: row.common_mistakes,
      relatedPatternKeys: row.related_pattern_keys,
      category: row.category,
    }, ctx),
);

// --- learner errors ---------------------------------------------------------

export const learnerErrorRowSchema = z
  .object({
    id: z.uuid(),
    learner_id: z.uuid(),
    error_type: errorTypeSchema,
    pattern: z.string(),
    occurrence_count: z.number().int(),
    first_seen_at: timestampColumn,
    last_seen_at: timestampColumn,
    resolved: z.boolean(),
    example_utterances: z.array(z.string()),
  })
  // Mirrors the learner_errors_seen_order check constraint. A row that reaches
  // here breaking it did not come through the database's front door, and a
  // caller that assumes the window is ordered would read it backwards.
  .refine((row) => row.last_seen_at >= row.first_seen_at, {
    error: "last_seen_at precedes first_seen_at",
    path: ["last_seen_at"],
  });

export const learnerErrorFromRow = learnerErrorRowSchema
  .transform((row, ctx) => validated(learnerErrorSchema, {
    id: row.id,
    learnerId: row.learner_id,
    errorType: row.error_type,
    pattern: row.pattern,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolved: row.resolved,
    exampleUtterances: row.example_utterances,
  }, ctx));

// --- memories ---------------------------------------------------------------

export const learnerMemoryRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  kind: z.enum([
    "interest",
    "goal",
    "preference",
    "achievement",
    "fact",
    "recurring_error",
  ]),
  content: z.string(),
  salience: numericSchema,
  learner_error_id: z.uuid().nullable(),
  created_at: timestampColumn,
});

export const learnerMemoryFromRow = learnerMemoryRowSchema.transform(
  (row, ctx): LearnerMemory => {
    const base = {
      id: row.id,
      learnerId: row.learner_id,
      content: row.content,
      salience: row.salience,
      createdAt: row.created_at,
    };

    const mapped =
      row.kind === "recurring_error"
        ? { ...base, kind: "recurring_error", learnerErrorId: row.learner_error_id }
        : { ...base, kind: row.kind };

    return validated(learnerMemorySchema, mapped, ctx);
  },
);

// --- conversations ----------------------------------------------------------

export const conversationThreadRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  title: z.string(),
  topic: z.string(),
  cefr: cefrLevelSchema,
  mini_level: miniLevelSchema,
  mode: conversationModeSchema,
  created_at: timestampColumn,
  updated_at: timestampColumn,
});

export const conversationThreadFromRow = conversationThreadRowSchema.transform(
  (row, ctx) => validated(conversationThreadSchema, {
    id: row.id,
    learnerId: row.learner_id,
    title: row.title,
    topic: row.topic,
    cefr: row.cefr,
    miniLevel: row.mini_level,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }, ctx),
);

// --- level performance --------------------------------------------------------

export const levelPerformanceRowSchema = z.object({
  learner_id: z.uuid(),
  mini_level: miniLevelSchema,
  turns: z.number().int(),
  strong_turns: z.number().int(),
  // The generated column arrives as a numeric, which PostgREST serialises as
  // a string.
  score: z.union([z.number(), z.string().transform(Number)]),
  updated_at: timestampColumn,
});

export const levelPerformanceFromRow = levelPerformanceRowSchema.transform(
  (row, ctx): LevelPerformance =>
    validated(levelPerformanceSchema, {
      learnerId: row.learner_id,
      miniLevel: row.mini_level,
      turns: row.turns,
      strongTurns: row.strong_turns,
      score: row.score,
      updatedAt: row.updated_at,
    }, ctx),
);

// --- trainer coaching -------------------------------------------------------

export const trainerCoachingProfileRowSchema = z.object({
  learner_id: z.uuid(),
  explanation_depth: z.enum(EXPLANATION_DEPTHS),
  challenge: z.enum(CHALLENGE_LEVELS),
  session_length: z.enum(SESSION_LENGTHS),
  focus: z.enum(PRACTICE_FOCUSES),
  news_enabled: z.boolean(),
  disputed_corrections: z.number().int(),
  helpful_count: z.number().int(),
  unhelpful_count: z.number().int(),
  updated_at: timestampColumn,
});

export const trainerCoachingProfileFromRow = trainerCoachingProfileRowSchema.transform(
  (row, ctx) =>
    validated(
      trainerCoachingProfileSchema,
      {
        learnerId: row.learner_id,
        explanationDepth: row.explanation_depth,
        challenge: row.challenge,
        sessionLength: row.session_length,
        focus: row.focus,
        news: row.news_enabled,
        disputedCorrections: row.disputed_corrections,
        helpfulCount: row.helpful_count,
        unhelpfulCount: row.unhelpful_count,
        updatedAt: row.updated_at,
      },
      ctx,
    ),
);

export function trainerCoachingProfileToRow(profile: TrainerCoachingProfile) {
  return {
    learner_id: profile.learnerId,
    explanation_depth: profile.explanationDepth,
    challenge: profile.challenge,
    session_length: profile.sessionLength,
    focus: profile.focus,
    news_enabled: profile.news,
    disputed_corrections: profile.disputedCorrections,
    helpful_count: profile.helpfulCount,
    unhelpful_count: profile.unhelpfulCount,
  };
}

export const trainerFeedbackRowSchema = z.object({
  id: z.uuid(),
  learner_id: z.uuid(),
  verdict: z.enum(FEEDBACK_VERDICTS),
  reasons: z.array(z.enum(FEEDBACK_REASONS)),
  note: z.string().nullable(),
  tools: z.array(z.string()),
  prompt_version: z.number().int(),
  created_at: timestampColumn,
});

export const trainerFeedbackFromRow = trainerFeedbackRowSchema.transform((row, ctx) =>
  validated(
    trainerFeedbackSchema,
    {
      id: row.id,
      learnerId: row.learner_id,
      verdict: row.verdict,
      reasons: row.reasons,
      note: row.note,
      tools: row.tools,
      promptVersion: row.prompt_version,
      createdAt: row.created_at,
    },
    ctx,
  ),
);

export function trainerFeedbackToRow(feedback: TrainerFeedback) {
  return {
    id: feedback.id,
    learner_id: feedback.learnerId,
    verdict: feedback.verdict,
    reasons: feedback.reasons,
    note: feedback.note,
    tools: feedback.tools,
    prompt_version: feedback.promptVersion,
  };
}
