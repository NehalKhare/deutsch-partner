/**
 * The data access layer.
 *
 * Repositories take typed domain input, return typed domain output, and never
 * let a database detail — a column name, a Postgres error, a raw row — reach a
 * caller. Every row is validated against the domain schema on the way out
 * rather than trusted.
 */

export * from "@/repositories/assessment-repository";
export * from "@/repositories/conversation-repository";
export * from "@/repositories/errors";
export * from "@/repositories/grammar-repository";
export * from "@/repositories/knowledge-repository";
export * from "@/repositories/learner-error-repository";
export * from "@/repositories/learner-repository";
export * from "@/repositories/memory-repository";
export * from "@/repositories/performance-repository";
export * from "@/repositories/ingestion-repository";
export * from "@/repositories/result";
export * from "@/repositories/retrieval-repository";
export * from "@/repositories/trainer-coaching-repository";
export * from "@/repositories/types";
export * from "@/repositories/usage-repository";
export * from "@/repositories/vocabulary-repository";
