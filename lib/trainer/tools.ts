import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  MAX_REVIEW_ITEMS,
  buildReviewPlan,
  type ReviewActivityKind,
} from "@/learning/review";
import { ERROR_TYPE_LABELS } from "@/learning/error-labels";
import { getMiniLevel } from "@/learning/mini-levels";
import {
  newLearnerVocabulary,
  recordCorrectUse,
  recordIncorrectUse,
} from "@/learning/vocabulary-engine";
import { GENDERS } from "@/domain/vocabulary";
import { MAX_AGENDA_ITEMS, MAX_COVERED_SUBJECTS } from "@/domain/trainer-session";
import { escapeUntrusted, wrapUntrusted } from "@/lib/ai/prompts/delimiters";
import { truncateToTokens } from "@/lib/ai/prompts/tokens";
import {
  TRAINER_TOOL_HELP,
  newsRetellFraming,
  type TrainerToolName,
} from "@/lib/ai/prompts/trainer";
import {
  NEWS_CHOICES,
  NEWS_RETELL_WORDS,
  parseHeadlines,
  simplestFirst,
} from "@/lib/trainer/news";
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
  /**
   * What this session has already worked through, as the client sent it back.
   * Exclusion keys and nothing else: they narrow the agenda, they never reach
   * a prompt, and the model is only ever handed words the database just gave.
   */
  readonly covered?: readonly string[];
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

/**
 * What one agenda line asks for.
 *
 * The review engine's activities, plus the one the engine knows nothing
 * about: reading a real news item. That is not spaced repetition — there is
 * no schedule behind it and nothing to be due — so it is the trainer's own
 * addition to the session rather than a row in the review plan, and the
 * review page stays a list of words and mistakes.
 */
export type TrainerAgendaKind = ReviewActivityKind | "read_the_news";

/** One line of the agenda, as the session shows it to the learner. */
export interface TrainerAgendaItem {
  readonly kind: TrainerAgendaKind;
  readonly subject: string;
}

export interface TrainerTools {
  readonly tools: StructuredToolInterface[];
  /** What search_knowledge cited this request, for the response to show. */
  readonly sources: () => readonly TrainerSource[];
  /**
   * The agenda this request planned, or null if it never asked for one.
   *
   * The distinction matters to the client: an empty agenda means the session
   * is finished, while no agenda at all means this turn was about something
   * else and the plan already on screen still stands.
   */
  readonly agenda: () => readonly TrainerAgendaItem[] | null;
  /** Every subject this session has finished, for the client to send back. */
  readonly covered: () => readonly string[];
  /** True once an agenda has been worked all the way through. */
  readonly complete: () => boolean;
}

/** One request may not grind the review table however chatty the model is. */
export const MAX_REVIEW_WRITES_PER_REQUEST = 20;

/** How much fetched or retrieved text a tool may hand the model. */
const MAX_FENCED_TOKENS = 1200;

const NEWS_URL = "https://www.nachrichtenleicht.de/";
const NEWS_TIMEOUT_MS = 8_000;

const UNAVAILABLE = JSON.stringify({ error: "unavailable" });

/**
 * The reading item every session ends on.
 *
 * German, because it sits in a list of German words on the learner's screen,
 * and deliberately not a dictionary form: it is closed by name like any other
 * agenda item, and a subject that collided with a catalogue lemma would write
 * a vocabulary outcome for a word nobody was quizzed on.
 */
const NEWS_SUBJECT = "Nachrichten von heute";

const NEWS_ACTIVITY = {
  kind: "read_the_news" as const,
  subject: NEWS_SUBJECT,
  prompt:
    "Call fetch_simple_german_news and follow the level instruction it returns: retell one item at the learner's level, then ask what they understood.",
};

const grammarKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);

/** The article a learner reads with a noun; not part of its dictionary form. */
function withoutArticle(subject: string): string | null {
  const article = GENDERS.find((gender) => subject.startsWith(`${gender} `));
  return article ? subject.slice(article.length + 1) : null;
}

export function createTrainerTools(deps: TrainerToolDeps): TrainerTools {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());
  const cited: TrainerSource[] = [];
  let reviewWrites = 0;

  // The session, as far as one request can see it: what is already done, the
  // agenda this request planned, and the mapping from what a learner reads
  // ("der Tisch") to what a progress row is keyed by ("Tisch").
  const covered = new Set(deps.covered ?? []);
  const lemmaFor = new Map<string, string>();
  const errorIdFor = new Map<string, string>();
  let agenda: TrainerAgendaItem[] | null = null;
  let complete = false;

  /**
   * The session's words, looked up again for the closing summary.
   *
   * Keyed by what was closed, worded by what the database holds: the model is
   * handed the catalogue's own word and translation, never the client's keys.
   */
  const recapFor = async (
    subjects: readonly string[],
  ): Promise<ReadonlyArray<{ subject: string; meaning: string }>> => {
    const candidates = [
      ...new Set(
        subjects.flatMap((key) => [
          lemmaFor.get(key) ?? key,
          withoutArticle(key) ?? key,
        ]),
      ),
    ];
    if (candidates.length === 0) return [];

    const found = await deps.vocabulary.findByLemmas(candidates);
    if (!found.ok) return [];

    const byLemma = new Map(found.data.map((item) => [item.lemma, item]));
    const recap: Array<{ subject: string; meaning: string }> = [];
    const seen = new Set<string>();
    // In the order the session ran, and each word once however many keys
    // point at it.
    for (const candidate of candidates) {
      const item = byLemma.get(candidate);
      if (item === undefined || seen.has(item.id)) continue;

      seen.add(item.id);
      recap.push({ subject: item.word, meaning: item.englishTranslation });
    }

    return recap;
  };

  /** Closing an item is what stops it being asked again. Bounded, like a body. */
  const close = (subject: string) => {
    const key = subject.trim();
    if (key.length > 0 && covered.size < MAX_COVERED_SUBJECTS) covered.add(key);
  };

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
        const byWord = new Map(
          (items.ok ? items.data : []).map((item) => [item.word, item.lemma]),
        );

        // A mistake drilled correctly can be marked resolved, and resolving
        // needs the row's id — which the plan itself does not carry, because
        // an activity is only ever a subject and a prompt.
        for (const error of errors.ok ? errors.data : []) {
          // Keyed by the label the agenda uses, because that label is the
          // subject the model will hand back to record_review_outcome.
          const label = ERROR_TYPE_LABELS[error.errorType];
          if (!errorIdFor.has(label)) errorIdFor.set(label, error.id);
        }

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
          // Built wide, then narrowed by what this session has done. Slicing
          // first would keep offering the finished items' places to nothing:
          // a learner who works through an agenda would be told they are out
          // of practice while words sat waiting behind the cut.
          limit: MAX_REVIEW_ITEMS,
        });

        const size = Math.min(limit ?? MAX_AGENDA_ITEMS, MAX_AGENDA_ITEMS);
        // The news goes last, and it goes in whatever the review rows say:
        // a learner with nothing due still has something real to read, and a
        // learner with a full agenda ends on it rather than on a drill.
        const remaining = [...plan.activities, NEWS_ACTIVITY]
          .filter((activity) => !covered.has(activity.subject))
          .slice(0, size);

        agenda = remaining.map((activity) => ({
          kind: activity.kind,
          subject: activity.subject,
        }));
        for (const activity of remaining) {
          const lemma = byWord.get(activity.subject);
          if (lemma !== undefined) lemmaFor.set(activity.subject, lemma);
        }

        // Finished, rather than never started: a learner with nothing due has
        // an empty agenda too, and telling them the session is over would be
        // a strange way to say hello.
        complete = remaining.length === 0 && covered.size > 0;

        const next = remaining[0];
        return JSON.stringify({
          dueCount: plan.due.length,
          weakCount: plan.weak.length,
          completed: covered.size,
          remaining: remaining.length,
          // The list to read out: subjects only. An agenda that carried its
          // prompts would be a quiz the learner can read ahead of, and a
          // model handed eight questions asks all eight.
          agenda: agenda.map((line, index) => ({
            position: index + 1,
            kind: line.kind,
            subject: line.subject,
          })),
          // One question, and only the next one. The model cannot ask an item
          // twice because it is never handed one the session has closed.
          // One question, and only the next one — under a field name that
          // says what it is. A ready question arrives as "prompt" and is
          // asked as written. A recurring mistake arrives as "struggles":
          // the note recorded about what keeps going wrong, background for
          // the trainer to teach from, never an exercise to read out — the
          // session protocol tells the model to write its own.
          next: next
            ? {
                position: 1,
                kind: next.kind,
                subject: next.subject,
                // Either field carries model-authored wording from an earlier
                // evaluation; neutralise anything fence-shaped before it
                // re-enters a prompt.
                ...(next.kind === "correct_the_mistake"
                  ? { struggles: escapeUntrusted(next.prompt) }
                  : { prompt: escapeUntrusted(next.prompt) }),
              }
            : null,
          sessionComplete: complete,
          // What the learner should take away, and the reason the closing
          // summary is not the model remembering: every word and meaning here
          // was read back out of the catalogue just now. The covered subjects
          // are lookup keys, so a session whose keys resolve to nothing gets a
          // short recap rather than an invented one.
          recap: complete ? await recapFor([...covered]) : undefined,
        });
      })(),
    {
      name: "get_review_session",
      description: TRAINER_TOOL_HELP.get_review_session,
      schema: z.strictObject({
        limit: z.number().int().min(1).max(MAX_AGENDA_ITEMS).optional(),
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
    async ({ subject, outcome }: { subject: string; outcome: "correct" | "incorrect" }) =>
      audited("record_review_outcome", async () => {
        const key = subject.trim();

        // Closing happens on every path out of here, including the ones that
        // write nothing. Whether the word turns out to be in the catalogue,
        // or the read failed, has nothing to do with whether the session has
        // now dealt with the item — and an item that cannot close is one the
        // trainer offers again next turn, to a learner who just answered it.
        if (reviewWrites >= MAX_REVIEW_WRITES_PER_REQUEST) {
          close(key);
          return JSON.stringify({
            recorded: false,
            reason: "write_limit_reached",
            closed: true,
          });
        }

        // A recurring mistake the learner has just fixed stops being an
        // unresolved mistake, so the review page stops listing it. Reversible
        // by the only thing that should reverse it: making it again, which
        // sets the row back to unresolved when the next turn is evaluated.
        //
        // The id map is per-request, and the answer usually arrives a turn
        // after the question — a turn that may record before it plans. So a
        // miss falls back to reading the unresolved errors again: whether a
        // mistake gets resolved must not depend on tool-call order.
        let errorId = errorIdFor.get(key);
        if (errorId === undefined) {
          const unresolved = await deps.errors.listUnresolved(deps.learnerId, 5);
          if (unresolved.ok) {
            errorId = unresolved.data.find(
              (error) => ERROR_TYPE_LABELS[error.errorType] === key,
            )?.id;
          }
        }
        if (errorId !== undefined) {
          if (outcome === "correct") {
            const resolved = await deps.errors.markResolved(errorId);
            return JSON.stringify({
              recorded: resolved.ok,
              subject: key,
              outcome,
              resolved: resolved.ok,
              closed: true,
            });
          }
          return JSON.stringify({
            recorded: false,
            reason: "mistake_not_yet_fixed",
            closed: true,
          });
        }

        // The agenda says "der Tisch" because that is what a learner should
        // read; a progress row is keyed by the lemma. Either spelling of the
        // same word resolves, so the model never has to know the difference.
        const candidates = [
          ...new Set([lemmaFor.get(key) ?? key, withoutArticle(key) ?? key]),
        ];

        const found = await deps.vocabulary.findByLemmas(candidates);
        if (!found.ok) {
          close(key);
          return UNAVAILABLE;
        }
        const item =
          candidates
            .map((candidate) => found.data.find((row) => row.lemma === candidate))
            .find((row) => row !== undefined) ?? null;
        // A word the curriculum does not teach gets no progress row: the model
        // may quiz freestyle, and a recurring-error drill has no word at all,
        // but the record only ever holds catalogue words.
        if (!item) {
          close(key);
          return JSON.stringify({
            recorded: false,
            reason: "not_in_curriculum",
            closed: true,
          });
        }

        // Closed under the name the agenda uses, which is the name the
        // exclusion is checked against — and the only one worth showing back.
        close(item.word);

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
        return JSON.stringify({
          recorded: true,
          subject: item.word,
          outcome,
          closed: true,
        });
      })(),
    {
      name: "record_review_outcome",
      description: TRAINER_TOOL_HELP.record_review_outcome,
      schema: z.strictObject({
        subject: z.string().trim().min(1).max(96),
        outcome: z.enum(["correct", "incorrect"]),
      }),
    },
  );

  const fetchNews = tool(
    async () =>
      audited("fetch_simple_german_news", async () => {
        // The learner's level decides how the item may be retold, so it is
        // read before the fetch is worth making.
        const state = await deps.learners.getState(deps.learnerId);
        if (!state.ok) return UNAVAILABLE;

        const response = await fetch(NEWS_URL, {
          signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
          headers: { accept: "text/html" },
        });
        if (!response.ok) return UNAVAILABLE;

        const headlines = simplestFirst(
          parseHeadlines(await response.text()),
          NEWS_CHOICES,
        );
        if (headlines.length === 0) return UNAVAILABLE;

        const cefr = state.data.effectiveLevel.cefr;
        const text = [
          "Schlagzeilen von nachrichtenleicht.de (Nachrichten in einfacher Sprache):",
          ...headlines.map((headline) => `- ${headline}`),
        ].join("\n");

        // The framing is trusted and stays outside the fence; the headlines
        // are somebody else's words and stay inside it.
        return [
          newsRetellFraming(cefr, NEWS_RETELL_WORDS[cefr]),
          wrapUntrusted("german_news", truncateToTokens(text, MAX_FENCED_TOKENS)),
        ].join("\n\n");
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
    agenda: () => (agenda === null ? null : [...agenda]),
    covered: () => [...covered],
    complete: () => complete,
  };
}
