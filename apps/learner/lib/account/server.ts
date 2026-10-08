import "server-only";

import { createBillingAdminRepository } from "@dp/db/billing-repository";
import { createLearnerAdminRepository } from "@dp/db/learner-admin-repository";
import type { DatabaseClient } from "@dp/db/types";

import { createBillingGraph } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { createOpsAlerts } from "@/lib/notifications/server";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";
import type { DeletionDeps } from "@/lib/account/deletion";

/**
 * A learner's own data, going out or going away (guardrails S16; GDPR
 * Art. 15, 17, 20).
 *
 * Both run on the secret key, with a documented reason each: the export
 * function is revoked from `authenticated` so the operator's copy and the
 * learner's copy are the same SQL and cannot drift, and deleting an auth user
 * is an admin API. Neither takes the learner id from anywhere but the
 * verified session.
 */
export function createOwnExport() {
  const client = createSecretKeySupabaseClient();
  return createLearnerAdminRepository(client as unknown as DatabaseClient);
}

export async function createDeletionDeps(): Promise<DeletionDeps> {
  const graph = await createBillingGraph();
  const client = createSecretKeySupabaseClient();
  return {
    provider: graph.provider,
    // The order graph's admin slice is the order page's; deletion needs the
    // live subscriptions, which only the secret key reads with their ids.
    admin: createBillingAdminRepository(client as unknown as DatabaseClient),
    accounts: {
      async delete(learnerId) {
        const { error } = await client.auth.admin.deleteUser(learnerId);
        return { ok: !error };
      },
    },
    limiter: limiterFor("account_delete"),
    logger: graph.logger,
    alerts: createOpsAlerts(),
  };
}
