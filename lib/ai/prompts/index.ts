/**
 * The prompt layer.
 *
 * Every production prompt is a catalogue entry assembled by the builder. No
 * module outside this directory should be constructing prompt text, and none
 * of it calls a model: dispatch belongs to the gateway.
 */

export * from "@/lib/ai/prompts/behavior-policy";
export * from "@/lib/ai/prompts/blocks";
export * from "@/lib/ai/prompts/builder";
export * from "@/lib/ai/prompts/catalogue";
export * from "@/lib/ai/prompts/contract";
export * from "@/lib/ai/prompts/delimiters";
export * from "@/lib/ai/prompts/fingerprint";
export * from "@/lib/ai/prompts/repair";
export * from "@/lib/ai/prompts/sections";
export * from "@/lib/ai/prompts/tokens";
