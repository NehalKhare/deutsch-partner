/**
 * Retrieval.
 *
 * Vector search plus metadata filtering plus a lexical arm, fused and then
 * ranked for the learner who asked. Nothing here calls a model directly: the
 * query embedding goes through the gateway like every other model call.
 */

export * from "@/lib/retrieval/filters";
export * from "@/lib/retrieval/fusion";
export * from "@/lib/retrieval/retriever";
export * from "@/lib/retrieval/scoring";
export * from "@/lib/retrieval/search";
