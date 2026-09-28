import { z } from "zod";

import { cefrLevelSchema, miniLevelSchema } from "@dp/domain/cefr";
import { masteryThresholdSchema } from "@dp/domain/learner";
import { vocabularyStatusSchema } from "@dp/domain/vocabulary";

import { fail, mapDatabaseError, ok, repositoryError, type RepositoryResult } from "./errors";
import { decodeInput } from "./result";
import {
  conversationThreadFromRow,
  learnerErrorFromRow,
  learnerMemoryFromRow,
  learnerStateFromRow,
  levelPerformanceFromRow,
  profileFromRow,
  trainerCoachingProfileFromRow,
  trainerFeedbackFromRow,
} from "./rows";
import type { DatabaseClient } from "./types";

/**
 * One learner, from the operator's side.
 *
 * The learner's own repositories read through RLS as that learner. This one
 * is constructed with the secret key and reads any learner — so every method
 * takes the learner id explicitly and every function beneath it filters on
 * it, including the ones that also take a row id. Operator scope only.
 *
 * Detail rows are parsed with the same row mappers the learner's own reads
 * use, so the operator sees the product's model of a learner rather than a
 * second, drifting one. The corrections return only what an audit line needs
 * — levels, flags, counts — and never a memory's or an utterance's text, which
 * does not belong in a log (guardrails S24).
 */

const numeric = z.coerce.number();
const timestamp = z.coerce.date();
const learnerIdSchema = z.uuid();

// --- the list ---------------------------------------------------------------

const listRowSchema = z.object({
  id: z.uuid(),
  createdAt: timestamp,
  onboardedAt: timestamp.nullable(),
  selectedLevel: cefrLevelSchema,
  /** Null for a profile with no state row, which onboarding always writes. */
  effectiveCefr: cefrLevelSchema.nullable(),
  effectivePlus: z.boolean().nullable(),
  miniLevel: miniLevelSchema.nullable(),
  furthestMiniLevel: miniLevelSchema.nullable(),
  skippedCount: z.coerce.number().int().min(0),
  masteryThreshold: masteryThresholdSchema,
  trainerPersonality: z.string(),
  lastActiveAt: timestamp.nullable(),
  openErrors: z.coerce.number().int().min(0),
});

export type LearnerListRow = z.infer<typeof listRowSchema>;

const listSchema = z.object({
  rows: z.array(listRowSchema).max(201),
  totals: z.object({
    learners: z.coerce.number().int().min(0),
    onboarded: z.coerce.number().int().min(0),
  }),
});

export const LEARNER_PAGE_SIZE = 50;

export const learnerListQuerySchema = z.object({
  cefr: cefrLevelSchema.optional(),
  onboarded: z.boolean().optional(),
  inactiveDays: z.number().int().min(1).max(365).optional(),
  /** The keyset cursor: the last row of the previous page. */
  before: z.object({ createdAt: z.date(), id: z.uuid() }).optional(),
});

export type LearnerListQuery = z.input<typeof learnerListQuerySchema>;

export interface LearnerListPage {
  readonly rows: readonly LearnerListRow[];
  readonly next: { readonly createdAt: Date; readonly id: string } | null;
  readonly totals: { readonly learners: number; readonly onboarded: number };
}

// --- one learner ------------------------------------------------------------

/** What the profile mapper leaves out and support needs. */
const accountDatesSchema = z.object({
  created_at: timestamp,
  onboarded_at: timestamp.nullable(),
});

const vocabularyRowSchema = z.object({
  vocabularyItemId: z.uuid(),
  lemma: z.string(),
  word: z.string(),
  englishTranslation: z.string(),
  miniLevel: miniLevelSchema,
  status: vocabularyStatusSchema,
  masteryScore: numeric,
  exposureCount: z.coerce.number().int(),
  correctCount: z.coerce.number().int(),
  incorrectCount: z.coerce.number().int(),
  lastSeenAt: timestamp.nullable(),
  nextReviewAt: timestamp.nullable(),
});

const assessmentSchema = z
  .object({
    id: z.uuid(),
    kind: z.string(),
    mini_level: z.number().int().nullable(),
    estimated_cefr: cefrLevelSchema.nullable(),
    score: numeric.nullable(),
    passed: z.boolean().nullable(),
    created_at: timestamp,
  })
  .transform((row) => ({
    id: row.id,
    kind: row.kind,
    miniLevel: row.mini_level,
    estimatedCefr: row.estimated_cefr,
    score: row.score,
    passed: row.passed,
    createdAt: row.created_at,
  }));

const recommendationSchema = z
  .object({
    id: z.uuid(),
    activity_type: z.string(),
    mode: z.string(),
    topic: z.string(),
    reason_kind: z.string(),
    score: numeric,
    accepted_at: timestamp.nullable(),
    created_at: timestamp,
    expires_at: timestamp.nullable(),
  })
  .transform((row) => ({
    id: row.id,
    activityType: row.activity_type,
    mode: row.mode,
    topic: row.topic,
    reasonKind: row.reason_kind,
    score: row.score,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));

export const learnerDetailSchema = z
  .object({
    profile: z.unknown(),
    state: learnerStateFromRow.nullable(),
    levels: z.array(levelPerformanceFromRow).max(70),
    vocabulary: z.object({
      // Partial: a learner has only the statuses they have.
      byStatus: z.partialRecord(vocabularyStatusSchema, z.coerce.number().int()),
      due: z.coerce.number().int().min(0),
      rows: z.array(vocabularyRowSchema).max(100),
    }),
    errors: z.array(learnerErrorFromRow).max(200),
    memories: z.array(learnerMemoryFromRow).max(500),
    assessments: z.array(assessmentSchema).max(50),
    recommendations: z.array(recommendationSchema).max(50),
    threads: z.array(conversationThreadFromRow).max(50),
    coaching: trainerCoachingProfileFromRow.nullable(),
    feedback: z.array(trainerFeedbackFromRow).max(50),
    minedSessions: z.coerce.number().int().min(0),
  })
  // The profile is parsed twice over the same object: once by the learner's
  // own mapper, once for the two dates that mapper does not carry.
  .transform((detail, ctx) => {
    const profile = profileFromRow.safeParse(detail.profile);
    const dates = accountDatesSchema.safeParse(detail.profile);
    if (!profile.success || !dates.success) {
      ctx.addIssue({ code: "custom", message: "malformed profile", path: ["profile"] });
      return z.NEVER;
    }
    return {
      ...detail,
      profile: profile.data,
      createdAt: dates.data.created_at,
      onboardedAt: dates.data.onboarded_at,
    };
  });

export type LearnerDetail = z.infer<typeof learnerDetailSchema>;

// --- the export ---------------------------------------------------------------

/** Every table the export must carry. The database test holds this to the foreign keys. */
export const EXPORTED_TABLES = [
  "profiles",
  "learner_states",
  "learner_vocabulary",
  "learner_errors",
  "learner_memories",
  "recommendations",
  "assessments",
  "conversation_threads",
  "level_performances",
  "trainer_coaching_profiles",
  "trainer_feedback",
  "trainer_mined_sessions",
  "billing_customers",
  "billing_checkouts",
  "subscriptions",
  "plan_passes",
  "plan_comps",
] as const;

const exportSchema = z.object({
  exportedAt: z.string(),
  ...Object.fromEntries(EXPORTED_TABLES.map((table) => [table, z.array(z.record(z.string(), z.unknown()))])),
});

export type LearnerExport = Record<string, unknown>;

// --- corrections --------------------------------------------------------------

export interface Change<T> {
  readonly before: T;
  readonly after: T;
}

const stateChangeSchema = z
  .object({ before: learnerStateFromRow, after: learnerStateFromRow })
  .transform(({ before, after }) => ({
    before: { miniLevel: before.miniLevel, cefr: before.effectiveLevel.cefr, skipped: before.skippedMiniLevels },
    after: { miniLevel: after.miniLevel, cefr: after.effectiveLevel.cefr, skipped: after.skippedMiniLevels },
  }));

export type StateChange = z.infer<typeof stateChangeSchema>;

const resolvedChangeSchema = z.object({
  before: z.object({ resolved: z.boolean(), error_type: z.string() }),
  after: z.object({ resolved: z.boolean() }),
});

const countChange = <K extends string>(key: K) =>
  z.object({
    before: z.object({ [key]: z.number().int() } as Record<K, z.ZodNumber>),
    after: z.object({ [key]: z.number().int() } as Record<K, z.ZodNumber>),
  });

export interface LearnerAdminRepository {
  list(query: LearnerListQuery): Promise<RepositoryResult<LearnerListPage>>;
  /** Null when the account has no profile. */
  detail(learnerId: string): Promise<RepositoryResult<LearnerDetail | null>>;
  /** Every learner-owned row. Null when the account has no profile. */
  export(learnerId: string): Promise<RepositoryResult<LearnerExport | null>>;
  /** Profile ids in id order, for resolving a pseudonym. */
  profileIds(after: string | null, limit: number): Promise<RepositoryResult<readonly string[]>>;

  setMiniLevel(learnerId: string, miniLevel: number): Promise<RepositoryResult<StateChange | null>>;
  clearSkippedLevels(learnerId: string): Promise<RepositoryResult<StateChange | null>>;
  /** Returns the tally that was removed: turns and strong turns, no content. */
  resetLevelPerformance(
    learnerId: string,
    miniLevel: number,
  ): Promise<RepositoryResult<{ readonly turns: number; readonly strongTurns: number } | null>>;
  setErrorResolved(
    learnerId: string,
    errorId: string,
    resolved: boolean,
  ): Promise<RepositoryResult<(Change<boolean> & { readonly errorType: string }) | null>>;
  setMasteryThreshold(learnerId: string, threshold: number): Promise<RepositoryResult<Change<number> | null>>;
  resetDisputedCorrections(learnerId: string): Promise<RepositoryResult<Change<number> | null>>;
  /** Returns the kind of memory removed, never its text. */
  deleteMemory(learnerId: string, memoryId: string): Promise<RepositoryResult<{ readonly kind: string } | null>>;
}

/** Calls one function and parses its result, with null as "nothing for that learner". */
async function nullable<T>(
  client: DatabaseClient,
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<RepositoryResult<T | null>> {
  const outcome = await client.rpc(fn, args);
  if (outcome.error) return fail(mapDatabaseError(outcome.error));
  if (outcome.data === null || outcome.data === undefined) return ok(null);

  const parsed = schema.safeParse(outcome.data);
  return parsed.success ? ok(parsed.data) : fail(repositoryError("invalid_data", parsed.error));
}

export function createLearnerAdminRepository(client: DatabaseClient): LearnerAdminRepository {
  return {
    async list(query) {
      const parsed = decodeInput(query, learnerListQuerySchema);
      if (!parsed.ok) return parsed;
      const q = parsed.data;

      const outcome = await client.rpc("ops_learner_list", {
        p_limit: LEARNER_PAGE_SIZE,
        p_before_created: q.before?.createdAt.toISOString() ?? null,
        p_before_id: q.before?.id ?? null,
        p_cefr: q.cefr ?? null,
        p_onboarded: q.onboarded ?? null,
        p_inactive_days: q.inactiveDays ?? null,
      });
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      const page = listSchema.safeParse(outcome.data);
      if (!page.success) return fail(repositoryError("invalid_data", page.error));

      const rows = page.data.rows.slice(0, LEARNER_PAGE_SIZE);
      const last = rows.at(-1);
      const more = page.data.rows.length > LEARNER_PAGE_SIZE;

      return ok({
        rows,
        next: more && last ? { createdAt: last.createdAt, id: last.id } : null,
        totals: page.data.totals,
      });
    },

    async detail(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;
      return nullable(client, "ops_learner_detail", { p_learner_id: id.data }, learnerDetailSchema);
    },

    async export(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;
      return nullable(client, "ops_learner_export", { p_learner_id: id.data }, exportSchema);
    },

    async profileIds(after, limit) {
      let query = client.from("profiles").select("id");
      if (after !== null) query = query.gt("id", after);
      const outcome = await query.order("id", { ascending: true }).limit(limit);
      if (outcome.error) return fail(mapDatabaseError(outcome.error));

      const rows = z.array(z.object({ id: z.uuid() })).safeParse(outcome.data ?? []);
      return rows.success ? ok(rows.data.map((row) => row.id)) : fail(repositoryError("invalid_data", rows.error));
    },

    async setMiniLevel(learnerId, miniLevel) {
      const input = decodeInput({ learnerId, miniLevel }, z.object({ learnerId: learnerIdSchema, miniLevel: miniLevelSchema }));
      if (!input.ok) return input;
      return nullable(
        client,
        "ops_set_learner_mini_level",
        { p_learner_id: input.data.learnerId, p_mini_level: input.data.miniLevel },
        stateChangeSchema,
      );
    },

    async clearSkippedLevels(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;
      return nullable(client, "ops_clear_skipped_levels", { p_learner_id: id.data }, stateChangeSchema);
    },

    async resetLevelPerformance(learnerId, miniLevel) {
      const input = decodeInput({ learnerId, miniLevel }, z.object({ learnerId: learnerIdSchema, miniLevel: miniLevelSchema }));
      if (!input.ok) return input;
      return nullable(
        client,
        "ops_reset_level_performance",
        { p_learner_id: input.data.learnerId, p_mini_level: input.data.miniLevel },
        z.object({ turns: z.number().int(), strong_turns: z.number().int() }).transform((row) => ({
          turns: row.turns,
          strongTurns: row.strong_turns,
        })),
      );
    },

    async setErrorResolved(learnerId, errorId, resolved) {
      const input = decodeInput(
        { learnerId, errorId, resolved },
        z.object({ learnerId: learnerIdSchema, errorId: z.uuid(), resolved: z.boolean() }),
      );
      if (!input.ok) return input;
      return nullable(
        client,
        "ops_set_learner_error_resolved",
        { p_learner_id: input.data.learnerId, p_error_id: input.data.errorId, p_resolved: input.data.resolved },
        resolvedChangeSchema.transform((change) => ({
          before: change.before.resolved,
          after: change.after.resolved,
          errorType: change.before.error_type,
        })),
      );
    },

    async setMasteryThreshold(learnerId, threshold) {
      const input = decodeInput(
        { learnerId, threshold },
        z.object({ learnerId: learnerIdSchema, threshold: masteryThresholdSchema }),
      );
      if (!input.ok) return input;
      return nullable(
        client,
        "ops_set_mastery_threshold",
        { p_learner_id: input.data.learnerId, p_threshold: input.data.threshold },
        countChange("mastery_threshold").transform((change) => ({
          before: change.before.mastery_threshold,
          after: change.after.mastery_threshold,
        })),
      );
    },

    async resetDisputedCorrections(learnerId) {
      const id = decodeInput(learnerId, learnerIdSchema);
      if (!id.ok) return id;
      return nullable(
        client,
        "ops_reset_disputed_corrections",
        { p_learner_id: id.data },
        countChange("disputed_corrections").transform((change) => ({
          before: change.before.disputed_corrections,
          after: change.after.disputed_corrections,
        })),
      );
    },

    async deleteMemory(learnerId, memoryId) {
      const input = decodeInput({ learnerId, memoryId }, z.object({ learnerId: learnerIdSchema, memoryId: z.uuid() }));
      if (!input.ok) return input;
      return nullable(
        client,
        "ops_delete_learner_memory",
        { p_learner_id: input.data.learnerId, p_memory_id: input.data.memoryId },
        z.object({ kind: z.string() }).transform((row) => ({ kind: row.kind })),
      );
    },
  };
}
