/**
 * The model gateway.
 *
 * The only part of the application permitted to import a provider SDK, name a
 * model, or open a connection to one. Everything else asks for a task and gets
 * a call that is routed, budgeted, bounded and accounted for — see
 * tests/security/ai-boundaries.test.ts, which fails CI if that stops being
 * true.
 */

export * from "@/lib/ai/gateway/budget-gate";
export * from "@/lib/ai/gateway/budgeter";
export * from "@/lib/ai/gateway/call-spec";
export * from "@/lib/ai/gateway/errors";
export * from "@/lib/ai/gateway/factory";
export * from "@/lib/ai/gateway/fx";
export * from "@/lib/ai/gateway/gateway";
export * from "@/lib/ai/gateway/ledger";
export * from "@/lib/ai/gateway/openrouter";
export * from "@/lib/ai/gateway/pricing";
export * from "@/lib/ai/gateway/registry";
export * from "@/lib/ai/gateway/router";
export * from "@/lib/ai/gateway/stream-guard";
export * from "@/lib/ai/gateway/transport";
