import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { buildReviewPlan } from "@/learning/review";
import { getMiniLevel } from "@/learning/mini-levels";
import {
  newLearnerVocabulary,
  recordCorrectUse,
  recordIncorrectUse,
} from "@/learning/vocabulary-engine";
import { escapeUntrusted, wrapUntrusted } from "@/lib/ai/prompts/delimiters";
import { truncateToTokens } from "@/lib/ai/prompts/tokens";
import { TRAINER_TOOL_HELP, type TrainerToolName } from "@/lib/ai/prompts/trainer";
import { DEFAULT_INTENT, classifyIntent } from "@/lib/graph/intent";
import type { GermanLearningRetriever } from "@/lib/retrieval/retriever";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { GrammarRepository } from "@/repositories/grammar-repository";
import type { LearnerErrorRepository } from "@/repositories/learner-error-repository";
import type { LearnerRepository } from "@/repositories/learner-repository";
import type { PerformanceRepository } from "@/repositories/performance-repository";
import type { VocabularyRepository } from "@/repositories/vocabulary-repository";

/**
 * The Trainer's local tools.
 *
 * Narrow on purpose (guardrails S11): each wraps one existing repository read
 * or one existing engine write, typed at both ends, and every one is bound to
 * the learner the verified session named — the learner id is closed over,
 * never a tool argument, so the model cannot ask about anybody else however
 * the conversation goes.
 *
 * Tools return JSON strings, and failure is a value: a repository error comes
 * back as {"error":"unavailable"} for the model to say out loud, never a
 * throw that would take the whole turn down. Anything that arrived from
 * outside the system — retrieved chunks, fetched news — is fenced with
 * wrapUntrusted before the model sees it.
 *
 * The one write, record_review_outcome, keeps the split the rest of the
 * product lives by: the model judges whether an answer was right, and the
 * deterministic vocabulary engine decides what that does to mastery and the
 * review schedule.
 */

export interface TrainerToolDeps {
  /** From the verified session. Bound in the closure, never a tool argument. */
  readonly learnerId: string;
  readonly userIdHash: string;
  readonly requestId: string;
  readonly vocabulary: VocabularyRepository;
  readonly errors: LearnerErrorRepository;
  readonly performance: PerformanceRepository;
  readonly learners: LearnerRepository;
  readonly grammar: GrammarRepository;
  readonly retriever: GermanLearningRetriever;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface TrainerSource {
  readonly documentId: number;
  readonly contentType: string;
  readonly score: number;
}

export interface TrainerTools {
  readonly tools: StructuredToolInterface[];
  /** What search_knowledge cited this request, for the response to show. */
  readonly sources: () => readonly TrainerSource[];
}

/** One request may not grind the review table however chatty the model is. */
export const MAX_REVIEW_WRITES_PER_REQUEST = 20;

/** How much fetched or retrieved text a tool may hand the model. */
const MAX_FENCED_TOKENS = 1200;

const NEWS_URL = "https://www.nachrichtenleicht.de/";
const NEWS_TIMEOUT_MS = 8_000;
const MAX_HEADLINES = 12;

const UNAVAILABLE = JSON.stringify({ error: "unavailable" });

const grammarKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);

/** The handful of entities the headlines actually use. */
function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&nbsp;", " ");
}

export function createTrainerTools(deps: TrainerToolDeps): TrainerTools {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());
  const cited: TrainerSource[] = [];
  let reviewWrites = 0;

  // Which tools ran is audited; what was said in them never is (S24).
  const audited = (name: TrainerToolName, run: () => Promise<string>) => {
    return async (): Promise<string> => {
      logger.info("trainer.tool_used", {
        audit: true,
        tool: name,
        requestId: deps.requestId,
        userIdHash: deps.userIdHash,
      });
      try {
        return await run();
      } catch {
        return UNAVAILABLE;
      }
    };
  };

  const getReviewSession = tool(
    async ({ limit }: { limit?: number }) =>
      audited("get_review_session", async () => {
        const [vocabulary, errors] = await Promise.all([
          deps.vocabulary.listForLearner(deps.learnerId, 200),
          deps.errors.listUnresolved(deps.learnerId, 5),
        ]);
        if (!vocabulary.ok) return UNAVAILABLE;

        const items = await deps.vocabulary.findByIds(
          vocabulary.data.map((record) => record.vocabularyItemId),
        );

        const plan = buildReviewPlan({
          vocabulary: vocabulary.data,
          items: items.ok ? items.data : [],
          recurringErrors: errors.ok
            ? errors.data.map((error) => ({
                errorType: error.errorType,
                pattern: error.pattern,
              }))
            : [],
          now: now(),
          limit: limit ?? 8,
        });

        return JSON.stringify({
          dueCount: plan.due.length,
          weakCount: plan.weak.length,
          activities: plan.activities.slice(0, limit ?? 8).map((activity) => ({
            kind: activity.kind,
            subject: activity.subject,
            // Recurring-error prompts carry model-authored wording; neutralise
            // anything fence-shaped before it re-enters a prompt.
            prompt: escapeUntrusted(activity.prompt),
          })),
        });
      })(),
    {
      name: "get_review_session",
      description: TRAINER_TOOL_HELP.get_review_session,
      schema: z.strictObject({
        limit: z.number().int().min(1).max(10).optional(),
      }),
    },
  );

  const getProgress = tool(
    async () =>
      audited("get_progress", async () => {
        const [state, levels] = await Promise.all([
          deps.learners.getState(deps.learnerId),
          deps.performance.listForLearner(deps.learnerId),
        ]);
        if (!state.ok) return UNAVAILABLE;

        return JSON.stringify({
          cefr: state.data.effectiveLevel.cefr,
          miniLevel: state.data.miniLevel,
          theme: getMiniLevel(state.data.miniLevel).theme,
          levels: (levels.ok ? levels.data : []).map((level) => ({
            miniLevel: level.miniLevel,
            turns: level.turns,
            strongTurns: level.strongTurns,
          })),
        });
      })(),
    {
      name: "get_progress",
      description: TRAINER_TOOL_HELP.get_progress,
      schema: z.strictObject({}),
    },
  );

  const getGrammarPattern = tool(
    async ({ key }: { key?: string }) =>
      audited("get_grammar_pattern", async () => {
        if (key !== undefined) {
          const pattern = await deps.grammar.findByKey(key);
          if (!pattern.ok) return JSON.stringify({ error: "not_found" });

          return JSON.stringify({
            key: pattern.data.key,
            name: pattern.data.name,
            explanation: pattern.data.explanation,
            examples: pattern.data.examples.slice(0, 5),
          });
        }

        const state = await deps.learners.getState(deps.learnerId);
        if (!state.ok) return UNAVAILABLE;

        const patterns = await deps.grammar.listUpToMiniLevel(state.data.miniLevel);
        if (!patterns.ok) return UNAVAILABLE;

        return JSON.stringify({
          patterns: patterns.data.map((pattern) => ({
            key: pattern.key,
            name: pattern.name,
          })),
        });
      })(),
    {
      name: "get_grammar_pattern",
      description: TRAINER_TOOL_HELP.get_grammar_pattern,
      schema: z.strictObject({ key: grammarKeySchema.optional() }),
    },
  );

  const searchKnowledge = tool(
    async ({ query, topK }: { query: string; topK?: number }) =>
      audited("search_knowledge", async () => {
        const state = await deps.learners.getState(deps.learnerId);
        if (!state.ok) return UNAVAILABLE;

        const level = getMiniLevel(state.data.miniLevel);
        const outcome = await deps.retriever.retrieve(
          query,
          {
            intent: classifyIntent(query) ?? DEFAULT_INTENT,
            cefr: state.data.effectiveLevel.cefr,
            miniLevel: state.data.miniLevel,
            weakGrammarKeys: [...level.targetGrammar],
            targetVocabularyLemmas: [...level.targetVocabulary],
          },
          {
            topK: topK ?? 4,
            context: { requestId: deps.requestId, userIdHash: deps.userIdHash },
          },
        );
        if (!outcome.ok) return UNAVAILABLE;

        for (const chunk of outcome.data.chunks) {
          cited.push({
            documentId: chunk.documentId,
            contentType: chunk.contentType,
            score: chunk.score,
          });
        }

        const text = outcome.data.chunks.map((chunk) => chunk.content).join("\n\n");
        return wrapUntrusted(
          "retrieved_knowledge",
          truncateToTokens(text, MAX_FENCED_TOKENS),
        );
      })(),
    {
      name: "search_knowledge",
      description: TRAINER_TOOL_HELP.search_knowledge,
      schema: z.strictObject({
        query: z.string().trim().min(1).max(200),
        topK: z.number().int().min(1).max(5).optional(),
      }),
    },
  );

  const recordReviewOutcome = tool(
    async ({ lemma, outcome }: { lemma: string; outcome: "correct" | "incorrect" }) =>
      audited("record_review_outcome", async () => {
        if (reviewWrites >= MAX_REVIEW_WRITES_PER_REQUEST) {
          return JSON.stringify({ recorded: false, reason: "write_limit_reached" });
        }

        const found = await deps.vocabulary.findByLemmas([lemma]);
        if (!found.ok) return UNAVAILABLE;
        const item = found.data[0];
        // A word the curriculum does not teach gets no progress row: the model
        // may quiz freestyle, but the record only ever holds catalogue words.
        if (!item) {
          return JSON.stringify({ recorded: false, reason: "not_in_curriculum" });
        }

        const existing = await deps.vocabulary.listByItems(deps.learnerId, [item.id]);
        if (!existing.ok) return UNAVAILABLE;

        const record =
          existing.data[0] ?? newLearnerVocabulary(deps.learnerId, item.id);
        const next =
          outcome === "correct"
            ? recordCorrectUse(record, now())
            : recordIncorrectUse(record, now());

        const saved = await deps.vocabulary.upsertLearnerVocabulary(next);
        if (!saved.ok) return UNAVAILABLE;

        reviewWrites += 1;
        return JSON.stringify({ recorded: true, lemma: item.lemma, outcome });
      })(),
    {
      name: "record_review_outcome",
      description: TRAINER_TOOL_HELP.record_review_outcome,
      schema: z.strictObject({
        lemma: z.string().trim().min(1).max(64),
        outcome: z.enum(["correct", "incorrect"]),
      }),
    },
  );

  const fetchNews = tool(
    async () =>
      audited("fetch_simple_german_news", async () => {
        const response = await fetch(NEWS_URL, {
          signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
          headers: { accept: "text/html" },
        });
        if (!response.ok) return UNAVAILABLE;

        const page = await response.text();
        const headlines = [
          ...page.matchAll(/<span class="headline-title">([^<]{4,200})<\/span>/g),
        ]
          .map((match) => decodeEntities(match[1]!.trim()))
          .filter((headline, index, all) => all.indexOf(headline) === index)
          .slice(0, MAX_HEADLINES);

        if (headlines.length === 0) return UNAVAILABLE;

        const text = [
          "Schlagzeilen von nachrichtenleicht.de (Nachrichten in einfacher Sprache):",
          ...headlines.map((headline) => `- ${headline}`),
        ].join("\n");

        return wrapUntrusted("german_news", truncateToTokens(text, MAX_FENCED_TOKENS));
      })(),
    {
      name: "fetch_simple_german_news",
      description: TRAINER_TOOL_HELP.fetch_simple_german_news,
      schema: z.strictObject({}),
    },
  );

  return {
    tools: [
      getReviewSession,
      getProgress,
      getGrammarPattern,
      searchKnowledge,
      recordReviewOutcome,
      fetchNews,
    ],
    sources: () => [...cited],
  };
}
