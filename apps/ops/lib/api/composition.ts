import "server-only";

import { createBudgetRepository, type BudgetRepository } from "@dp/db/budget-repository";
import { createJobsRepository, type JobsRepository } from "@dp/db/jobs-repository";
import {
  createLearnerAdminRepository,
  type LearnerAdminRepository,
} from "@dp/db/learner-admin-repository";
import { createLedgerRepository, type LedgerRepository } from "@dp/db/ledger-repository";
import {
  createLearnerFeedbackRepository,
  type LearnerFeedbackRepository,
} from "@dp/db/learner-feedback-repository";
import { createPricingRepository, type PricingRepository } from "@dp/db/pricing-repository";
import type { DatabaseClient } from "@dp/db/types";
import { requireEnvValue } from "@dp/env/schema";
import { createLogger, type Logger } from "@dp/observability/logger";
import { hashUserId } from "@dp/observability/pseudonym";
import { createProductOpsRepository, type ProductOpsRepository } from "@dp/product-ops/repository";

import { serverEnv } from "@/lib/env/server";
import { createLearnerAccounts, type LearnerAccounts } from "@/lib/learner-directory";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";

/**
 * Wiring the operator app's dependencies.
 *
 * One client, the secret key: every table this app touches has RLS enabled
 * with no policy at all. The authorization that matters happens before any
 * of this is called — the page's or the action's operator check — and the
 * tables' privileges are the layer behind it.
 *
 * No gateway and no model ladder, by construction: this app holds no model
 * key. Every stage runs in the worker; this app reads the board and writes
 * to the queue.
 */

/** The pseudonymous id used in logs and on every operator write. Never the account id. */
export function pseudonymFor(accountId: string): string {
  return hashUserId({
    userId: accountId,
    salt: requireEnvValue(serverEnv().LOG_PSEUDONYM_SALT, "LOG_PSEUDONYM_SALT"),
  });
}

export const PSEUDONYM_UNAVAILABLE = "unavailable";

/** The pseudonym, or a marker saying there is not one, where the log is a side effect. */
export function pseudonymOrUnavailable(accountId: string): string {
  try {
    return pseudonymFor(accountId);
  } catch {
    return PSEUDONYM_UNAVAILABLE;
  }
}

/** A logger for a Server Action or a gate, which have no request graph to hang one off. */
export function actionLogger(): Logger {
  return createLogger({
    base: { service: "ops", environment: serverEnv().NODE_ENV },
  });
}

export interface ProductOpsReader {
  readonly runs: ProductOpsRepository;
  /** What the product's own learners said about the trainer, aggregated. */
  readonly feedback: LearnerFeedbackRepository;
  /** The queue the worker drains. This process asks; it never runs a stage. */
  readonly jobs: JobsRepository;
  readonly logger: Logger;
}

export function createProductOpsReader(): ProductOpsReader {
  const env = serverEnv();
  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;

  return {
    runs: createProductOpsRepository(client),
    feedback: createLearnerFeedbackRepository(client),
    jobs: createJobsRepository(client),
    logger: createLogger({ base: { service: "product-ops", environment: env.NODE_ENV } }),
  };
}

export interface CostAdmin {
  /** The euro limits the gateway enforces, and the counters against them. */
  readonly budgets: BudgetRepository;
  /** The price list and euro rate the snapshot jobs wrote. Read-only. */
  readonly pricing: PricingRepository;
  /** The usage ledger, one call at a time. Read-only: the table is append-only. */
  readonly ledger: LedgerRepository;
  /** For asking the worker to refresh a snapshot or rebuild the rollup. */
  readonly jobs: JobsRepository;
  readonly logger: Logger;
}

/** The cost pages' dependencies: the same secret-key client, and no model. */
export function createCostAdmin(): CostAdmin {
  const env = serverEnv();
  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;

  return {
    budgets: createBudgetRepository(client),
    pricing: createPricingRepository(client),
    ledger: createLedgerRepository(client),
    jobs: createJobsRepository(client),
    logger: createLogger({ base: { service: "ops", environment: env.NODE_ENV } }),
  };
}

export interface LearnerSupport {
  /** Any learner's rows, by id. Every method takes the learner id explicitly. */
  readonly learners: LearnerAdminRepository;
  /** The auth account behind a learner: lookup by email, export details, deletion. */
  readonly accounts: LearnerAccounts;
  readonly logger: Logger;
}

/**
 * The learner pages' dependencies.
 *
 * The secret key again, which bypasses RLS: the learner tables' policies stay
 * as they are for learners, and this app's operator check is what stands in
 * front of these reads instead. Nothing here calls a model.
 */
export function createLearnerSupport(): LearnerSupport {
  const env = serverEnv();
  const client = createSecretKeySupabaseClient();

  return {
    learners: createLearnerAdminRepository(client as unknown as DatabaseClient),
    accounts: createLearnerAccounts(client.auth.admin),
    logger: createLogger({ base: { service: "ops", environment: env.NODE_ENV } }),
  };
}
