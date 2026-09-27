import { z } from "zod";

import type { BudgetScope } from "@dp/domain/budgets";

/**
 * How a call can fail, and what the ledger calls it.
 *
 * Two vocabularies, deliberately. The failure names are what a caller branches
 * on; the ledger statuses are the closed set the accounting table stores and
 * the cost dashboard groups by. Keeping them separate means a new failure mode
 * does not silently widen a column the dashboard reads.
 */

export const GATEWAY_FAILURES = [
  "invalid_spec",
  "unknown_task",
  "ceiling_denied",
  "budget_denied",
  "provider_error",
  "timeout",
  "invalid_output",
] as const;

export type GatewayFailure = (typeof GATEWAY_FAILURES)[number];

export const LEDGER_STATUSES = [
  "ok",
  "error",
  "timeout",
  "budget_denied",
  "ceiling_denied",
] as const;

export const ledgerStatusSchema = z.enum(LEDGER_STATUSES);
export type LedgerStatus = z.infer<typeof ledgerStatusSchema>;

export type GatewayResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly failure: GatewayFailure;
      readonly detail: string;
      /**
       * On a budget_denied only: the scope that refused, or null when the
       * counters could not be read at all. A caller branches on it rather than
       * on the detail's wording, because the difference matters to a learner:
       * their own allowance running out is something a larger plan answers,
       * and an unreadable counter or the product's daily ceiling is not.
       */
      readonly budgetScope?: BudgetScope | null;
    };

export const gatewayOk = <T>(data: T): GatewayResult<T> => ({ ok: true, data });

export const gatewayFail = <T = never>(
  failure: GatewayFailure,
  detail: string,
  budgetScope?: BudgetScope | null,
): GatewayResult<T> =>
  budgetScope === undefined
    ? { ok: false, failure, detail }
    : { ok: false, failure, detail, budgetScope };

/**
 * The ledger status a failure is recorded under.
 *
 * invalid_spec and unknown_task have none: neither became a call, so neither
 * consumed anything to account for. Everything else did reach the point where
 * money was either spent or deliberately refused, and gets a row.
 */
export function statusForFailure(failure: GatewayFailure): LedgerStatus | null {
  switch (failure) {
    case "invalid_spec":
    case "unknown_task":
      return null;
    case "ceiling_denied":
      return "ceiling_denied";
    case "budget_denied":
      return "budget_denied";
    case "timeout":
      return "timeout";
    case "provider_error":
    case "invalid_output":
      return "error";
  }
}

/**
 * A short, stable code for the ledger's error_code column.
 *
 * Never the provider's message: that can quote the prompt back, which would
 * put learner content into a financial record that is meant to outlive the
 * conversation it came from.
 */
export function errorCodeFor(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  if (error instanceof Error && error.name && error.name !== "Error") {
    return error.name.slice(0, 64);
  }
  return "provider_error";
}
