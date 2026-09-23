/**
 * Learning evaluation.
 *
 * Scores one learner message after the reply has streamed: level, accuracy,
 * errors, and the mastery signals the curriculum acts on. Separate from
 * conversation generation, on a cheaper tier, and never trusted — model output
 * is parsed, validated, salvaged where that is safe, and dropped where it is
 * not.
 */

export * from "@/lib/ai/evaluation/evaluate";
export * from "@/lib/ai/evaluation/recovery";
export * from "@/lib/ai/evaluation/triage";
