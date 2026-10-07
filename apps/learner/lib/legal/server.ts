import "server-only";

import { createContractNoticesRepository } from "@dp/db/contract-notices-repository";
import type { DatabaseClient } from "@dp/db/types";
import { requireEnvValue } from "@dp/env/schema";
import { hashUserId } from "@dp/observability/pseudonym";

import { actionLogger } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { NO_SENDER, type NoticeDeps } from "@/lib/legal/notices";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";

/**
 * The notice flows' dependencies.
 *
 * The secret key, because contract_notices has RLS on and no policy: the
 * cancellation button works for a visitor with no session at all, and the
 * table must be reachable by nobody but this code. The limiter is keyed by
 * the same keyed hash the ledger uses, over the address instead of an id,
 * so neither the log nor the rate-limit row holds an email.
 */
export function createNoticeDeps(): NoticeDeps {
  const salt = requireEnvValue(serverEnv().LOG_PSEUDONYM_SALT, "LOG_PSEUDONYM_SALT");
  return {
    notices: createContractNoticesRepository(createSecretKeySupabaseClient() as unknown as DatabaseClient),
    confirmer: NO_SENDER,
    limiter: limiterFor("legal_notice"),
    keyFor: (email) => hashUserId({ userId: email, salt }),
    logger: actionLogger(),
    now: () => new Date(),
  };
}
