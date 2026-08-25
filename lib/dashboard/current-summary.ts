import "server-only";

import { cache } from "react";

import { createDashboardRepository } from "@/lib/dashboard/summary";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

/**
 * The learner's dashboard summary, once per request.
 *
 * Two things need it now and they render in the same pass: the app shell, for
 * the count beside Catch up, and the dashboard page itself. Without sharing,
 * every dashboard visit would run the same aggregate twice — and every other
 * page would pay for a nav badge.
 *
 * `cache()` is React's per-request memo, so the second caller gets the first
 * caller's promise. It takes no arguments deliberately: memoisation is keyed
 * on them, and passing a freshly-built client (or a `now`) would make every
 * call a cache miss and quietly restore the double read.
 *
 * The client is built inside for the same reason. It is cheap — cookies and a
 * URL — and building it here keeps the seam honest: a caller cannot hand this
 * a client scoped to somebody else.
 */
export const currentSummary = cache(async () => {
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  return createDashboardRepository(supabase).summary();
});
