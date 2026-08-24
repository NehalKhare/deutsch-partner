/**
 * The Deutsch Partner domain model.
 *
 * Pure types and rules with no I/O, no React, and no provider SDKs, so every
 * rule here is testable in isolation. Repositories map these to storage; the
 * agent graph consumes them.
 */

export * from "@/domain/cefr";
export * from "@/domain/companion";
export * from "@/domain/conversation";
export * from "@/domain/evaluation";
export * from "@/domain/grammar";
export * from "@/domain/learner";
export * from "@/domain/learner-error";
export * from "@/domain/memory";
export * from "@/domain/performance";
export * from "@/domain/primitives";
export * from "@/domain/recommendation";
export * from "@/domain/retrieval";
export * from "@/domain/scenario";
export * from "@/domain/vocabulary";
