/**
 * The model gateway.
 *
 * The only part of the application permitted to import a provider SDK, name a
 * model, or open a connection to one. Everything else asks for a task and gets
 * a call that is routed, budgeted, bounded and accounted for — see
 * tests/security/ai-boundaries.test.ts, which fails CI if that stops being
 * true.
 */

export * from "./budget-gate";
export * from "./budgeter";
export * from "./call-spec";
export * from "./errors";
export * from "./factory";
export * from "./fx";
export * from "./gateway";
export * from "./ledger";
export * from "./openrouter";
export * from "./pricing";
export * from "./registry";
export * from "./router";
export * from "./stream-guard";
export * from "./transport";
