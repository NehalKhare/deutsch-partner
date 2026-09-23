import "server-only";

import { cache } from "react";

import { catchUpCount } from "@dp/learning/review";
import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { createLearnerErrorRepository } from "@dp/db/learner-error-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import { createVocabularyRepository } from "@dp/db/vocabulary-repository";
import type { DatabaseClient } from "@dp/db/types";

/**
 * How many things are waiting on the Catch up page, for the nav badge.
 *
 * The same two reads and the same selection function the page itself uses, so
 * the badge cannot contradict the headline it points at. That is not a
 * theoretical worry: the first version of this counted overdue words from the
 * dashboard aggregate — one query instead of two — and showed a learner "1"
 * over a page that said "4 things to go over", because three recurring
 * mistakes are most of what a session is and none of them is a due word.
 *
 * No vocabulary items are fetched. Counting does not need the words, only how
 * many there are, which is what keeps this to two indexed reads on a page that
 * is not the Catch up page.
 *
 * `cache()` memoises it per request, and it takes no arguments so that
 * memoisation actually lands.
 */
export const currentCatchUpCount = cache(async (): Promise<number> => {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return 0;

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  const [vocabulary, errors] = await Promise.all([
    createVocabularyRepository(supabase).listForLearner(learnerId, VOCABULARY_WINDOW),
    createLearnerErrorRepository(supabase).listUnresolved(learnerId, MISTAKE_WINDOW),
  ]);

  // Nothing waiting, rather than a guess: an unreadable database must not
  // invent urgency in the nav bar, and it must not hide it either — a failure
  // shows as a quiet Catch up, which is the state a learner can already see
  // the truth of by opening it.
  return catchUpCount({
    vocabulary: vocabulary.ok ? vocabulary.data : [],
    recurringErrors: errors.ok
      ? errors.data.map((error) => ({
          errorType: error.errorType,
          pattern: error.pattern,
        }))
      : [],
    now: new Date(),
  });
});

/**
 * The same windows the Catch up page reads with.
 *
 * They have to match: a badge counting a wider window than the page reads
 * would be a badge that is right about the learner and wrong about the page.
 */
const VOCABULARY_WINDOW = 200;
const MISTAKE_WINDOW = 5;
