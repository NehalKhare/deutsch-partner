import { PERSISTED_SCOPES, periodFor } from "./budget-gate";
import type { FxRateService } from "./fx";
import {
  applyFx,
  ledgerRowSchema,
  type BudgetIncrement,
  type LedgerRow,
  type PricedCall,
  type UsageLedger,
} from "./ledger";
import { estimateUsd, resolveRate, type PricingStore } from "./pricing";
import { nullLogger, type Logger } from "@dp/observability/logger";

/**
 * Writing a row and moving the counters it justifies.
 *
 * Shared by the chat gateway and the embedding gateway. They dispatch very
 * differently — one streams free text under an output ceiling, the other
 * returns vectors in a batch — but a euro is a euro, and having two copies of
 * the conversion and the increment arithmetic is how the two would drift.
 */

export interface AccountantDeps {
  readonly ledger: UsageLedger;
  readonly fx: FxRateService;
  readonly pricing?: PricingStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface Accountant {
  /** Validates, prices the counters, and writes. Returns the row id, or null. */
  write(row: LedgerRow): Promise<number | null>;
  /**
   * The provider's own figure where it gave one, the cached snapshot where it
   * did not, converted once at today's rate.
   */
  price(
    reported: number | null,
    provider: string,
    modelId: string,
    usage: { readonly inputTokens: number; readonly outputTokens: number },
  ): Promise<PricedCall>;
}

export function createAccountant(deps: AccountantDeps): Accountant {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());

  function increments(row: LedgerRow): BudgetIncrement[] {
    if (row.costEur <= 0) return [];

    return PERSISTED_SCOPES.flatMap((scope) => {
      const perUser = scope !== "global_daily";
      if (perUser && row.userIdHash === null) return [];

      const period = periodFor(scope, now());
      return [
        {
          scope,
          scopeKey: perUser ? row.userIdHash : null,
          periodStart: period.start,
          periodEnd: period.end,
          amountEur: row.costEur,
        },
      ];
    });
  }

  return {
    async write(row) {
      const parsed = ledgerRowSchema.safeParse(row);

      if (!parsed.success) {
        logger.error("ledger.row_invalid", {
          task: row.task,
          status: row.status,
          detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
        });
        return null;
      }

      const written = await deps.ledger.record(parsed.data, increments(parsed.data));

      if (!written.ok) {
        // Accounting that can take a learner's turn down with it is accounting
        // that gets switched off. Loudly logged, and the caller continues.
        logger.error("ledger.write_failed", {
          task: parsed.data.task,
          status: parsed.data.status,
          detail: written.detail,
        });
        return null;
      }

      return written.id;
    },

    async price(reported, provider, modelId, usage) {
      let costUsd = reported;

      if (costUsd === null && deps.pricing) {
        costUsd = estimateUsd(await resolveRate(deps.pricing, provider, modelId), usage);
      }

      return applyFx(costUsd ?? 0, await deps.fx.resolve(now()));
    },
  };
}
