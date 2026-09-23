import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { MAX_REVIEW_ITEMS, buildReviewPlan } from "@dp/learning/review";
import { ERROR_TYPE_LABELS } from "@dp/learning/error-labels";
import { getMiniLevel } from "@dp/learning/mini-levels";
import {
  newLearnerVocabulary,
  recordCorrectUse,
  recordIncorrectUse,
} from "@dp/learning/vocabulary-engine";
import { GENDERS } from "@dp/domain/vocabulary";
import {
  CHALLENGE_LEVELS,
  EXPLANATION_DEPTHS,
  PRACTICE_FOCUSES,
  SESSION_LENGTHS,
  defaultCoachingProfile,
  dialsOf,
  type TrainerCoachingProfile,
} from "@dp/domain/trainer-coaching";
import { MAX_AGENDA_ITEMS, MAX_COVERED_SUBJECTS } from "@dp/domain/trainer-session";
import { escapeUntrusted, wrapUntrusted } from "@dp/prompts/delimiters";
import { truncateToTokens } from "@dp/prompts/tokens";
import {
  TRAINER_TOOL_HELP,
  newsRetellFraming,
  type TrainerToolName,
} from "@dp/prompts/trainer";
import {
  composeMixedAgenda,
  type AgendaActivity,
  type TrainerAgendaItem,
} from "@/lib/trainer/agenda";
import {
  MIX_FOR_FOCUS,
  agendaSizeFor,
  applyAdjustment,
} from "@/lib/trainer/coaching";
import {
  NEWS_CHOICES,
  NEWS_RETELL_WORDS,
  parseHeadlines,
  simplestFirst,
} from "@/lib/trainer/news";
import { DEFAULT_INTENT, classifyIntent } from "@/lib/graph/intent";
import type { GermanLearningRetriever } from "@/lib/retrieval/retriever";
import { nullLogger, type Logger } from "@dp/observability/logger";
import type { GrammarRepository } from "@dp/db/grammar-repository";
import type { LearnerErrorRepository } from "@dp/db/learner-error-repository";
import type { LearnerRepository } from "@dp/db/learner-repository";
import type { PerformanceRepository } from "@dp/db/performance-repository";
import type { TrainerCoachingRepository } from "@dp/db/trainer-coaching-repository";
import type { VocabularyRepository } from "@dp/db/vocabulary-repository";

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
  /**
   * The agenda the session opened with, as ordered subject keys the client
   * sent back. When present, get_review_session serves from this promise
   * instead of recomposing from the backlog — each key resolved against what
   * the database holds right now, so the pin selects, it never supplies text.
   */
  readonly pinned?: readonly string[];
  readonly userIdHash: string;
  readonly requestId: string;
  readonly vocabulary: VocabularyRepository;
  readonly errors: LearnerErrorRepository;
  readonly performance: PerformanceRepository;
  readonly learners: LearnerRepository;
  readonly grammar: GrammarRepository;
  readonly retriever: GermanLearningRetriever;
  /**
   * How this learner wants to be coached, and where a change is written.
   * The profile decides the agenda's size, mix and whether it ends on the
   * news; the repository is what adjust_coaching writes to. Absent means a
   * learner with the defaults and no way to change them from inside a turn.
   */
  readonly coaching?: {
    readonly profile: TrainerCoachingProfile;
    readonly repository: TrainerCoachingRepository;
  };
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
  /** The coaching profile as it stands after this request's tool calls. */
  readonly coaching: () => TrainerCoachingProfile;
}

/** One request may not grind the review table however chatty the model is. */
export const MAX_REVIEW_WRITES_PER_REQUEST = 20;

/**
 * How many times one turn may change the coaching. Two: a learner may ask for
 * two things in one breath and a model may split them, but a loop that keeps
 * adjusting is a loop, not a request.
 */
export const MAX_COACHING_WRITES_PER_REQUEST = 2;

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
    "Call fetch_simple_german_news and follow the level instruction it returns: retell one item at the learner's level, ask what they understood, then correct and confirm like a teacher.",
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

/** Whether two subjects name the same agenda item, article and case aside. */
function sameSubject(a: string, b: string): boolean {
  const forms = (subject: string): string[] => {
    const whole = subject.trim();
    const bare = withoutArticle(whole);
    return bare === null
      ? [whole.toLowerCase()]
      : [whole.toLowerCase(), bare.toLowerCase()];
  };

  const those = forms(b);
  return forms(a).some((form) => those.includes(form));
}

export function createTrainerTools(deps: TrainerToolDeps): TrainerTools {
  const logger = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date());
  const cited: TrainerSource[] = [];
  let reviewWrites = 0;
  let coachingWrites = 0;
  // The learner's standing requests, as read for this request. What the
  // agenda is sized and mixed by, and what adjust_coaching moves.
  let coaching: TrainerCoachingProfile =
    deps.coaching?.profile ?? defaultCoachingProfile(deps.learnerId, now());

  // The session, as far as one request can see it: what is already done, the
  // agenda this request planned, and the mapping from what a learner reads
  // ("der Tisch") to what a progress row is keyed by ("Tisch").
  const covered = new Set(deps.covered ?? []);
  const lemmaFor = new Map<string, string>();
  const errorIdFor = new Map<string, string>();
  const grammarKeyFor = new Map<string, string>();
  let agenda: TrainerAgendaItem[] | null = null;
  let complete = false;
  // Whether this request has already handed the model the agenda listing.
  // Once is the contract: the listing exists to be read out when a session
  // opens, and a model handed the list again mid-session re-announces it.
  let announced = false;

  /**
   * The level's target grammar and culture notes, as drills.
   *
   * What keeps a session mixed when nothing has gone wrong: the patterns the
   * learner's current mini-level is teaching — grammar and, where the level
   * has one, a culture note, told apart by the row's category — each an item
   * the trainer introduces and sets an exercise for. In curriculum order, and
   * tolerant of everything — a failed read, or a repository fake without the
   * method, is a session with no drills in it, never a dead one.
   */
  const levelDrills = async (): Promise<AgendaActivity[]> => {
    try {
      const state = await deps.learners.getState(deps.learnerId);
      if (!state.ok) return [];

      const level = getMiniLevel(state.data.miniLevel);
      const keys = [...level.targetGrammar, ...level.targetCulture];
      const patterns = await deps.grammar.findByKeys(keys);
      if (!patterns.ok) return [];

      const byKey = new Map(patterns.data.map((pattern) => [pattern.key, pattern]));
      return keys.flatMap((key) => {
        const pattern = byKey.get(key);
        return pattern
          ? [
              {
                kind:
                  pattern.category === "culture"
                    ? ("culture_drill" as const)
                    : ("grammar_drill" as const),
                subject: pattern.name,
                prompt: pattern.explanation,
                patternKey: pattern.key,
              },
            ]
          : [];
      });
    } catch {
      return [];
    }
  };

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

  /**
   * The one write, shared by record_review_outcome and the record shortcut on
   * get_review_session: closing and advancing used to be two calls, and the
   * turn that judged an answer but forgot the second one re-asked the same
   * question. One body, so both doors close the item the same way.
   */
  const recordFor = async (
    subject: string,
    outcome: "correct" | "incorrect",
  ): Promise<string> => {
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
      // Closed either way: recorded "incorrect" keeps the row unresolved so a
      // later session lists it again, but this session moves on — leaving it
      // open re-served the same mistake to a learner who had just been told
      // it would come back another day.
      close(key);
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

    // A grammar drill has no schedule and no progress row: the level
    // teaches it until the level moves on, so practising it closes the
    // item and writes nothing.
    if (grammarKeyFor.has(key)) {
      close(key);
      return JSON.stringify({
        recorded: false,
        reason: "grammar_practised",
        subject: key,
        outcome,
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
      // The key map is per-request like errorIdFor, and the answer to a
      // drill usually lands a turn after the question — a turn that may
      // record before it plans. A subject that is neither an error nor a
      // word gets one look at the level's own patterns before it is
      // written off, so how a drill closes does not depend on tool-call
      // order.
      const drilled = (await levelDrills()).some(
        (drill) => drill.subject === key,
      );
      close(key);
      if (drilled) {
        return JSON.stringify({
          recorded: false,
          reason: "grammar_practised",
          subject: key,
          outcome,
          closed: true,
        });
      }
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
  };

  /**
   * Both record doors go through here: a record is only ever about an item
   * the session's agenda still has open. A learner got stuck in a loop when
   * the model drilled the open item but recorded it under the name of one
   * already closed ("Spelling", again and again) — a no-op close, so the same
   * item came back forever — and junk names ("Ich bin neun Jahre alt.") were
   * closed into the covered list the sidebar shows. When the session has a
   * promised agenda, a record naming no open item is applied to the first
   * open one — the item being worked — so every judged answer advances the
   * session, and the response says what was actually recorded.
   */
  const recordOutcome = async (
    subject: string,
    outcome: "correct" | "incorrect",
  ): Promise<string> => {
    const requested = subject.trim();
    const open = (deps.pinned ?? []).filter((line) => !covered.has(line));
    const redirected =
      open.length > 0 && !open.some((line) => sameSubject(line, requested));

    const raw = await recordFor(redirected ? open[0] : requested, outcome);
    if (!redirected) return raw;
    try {
      return JSON.stringify({
        ...(JSON.parse(raw) as Record<string, unknown>),
        redirectedFrom: requested,
      });
    } catch {
      return raw;
    }
  };

  const getReviewSession = tool(
    async ({
      limit,
      record,
    }: {
      limit?: number;
      record?: { subject: string; outcome: "correct" | "incorrect" };
    }) =>
      audited("get_review_session", async () => {
        // The record shortcut: close the item just judged in the same call
        // that fetches the next one. Two calls collapsed into one, because
        // the turn that judged an answer and forgot the second call re-asked
        // the question the learner had just got right. Runs first, so the
        // closure and any resolved mistake are visible to the plan below —
        // and through the same audited door as the standalone tool.
        let recorded: Record<string, unknown> | undefined;
        if (record !== undefined) {
          const raw = await audited("record_review_outcome", () =>
            recordOutcome(record.subject, record.outcome),
          )();
          try {
            recorded = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            recorded = { error: "unavailable" };
          }
        }

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

        // The drills the level teaches, remembered by name so a recorded
        // outcome can tell a pattern from a word without a second look-up.
        // Grammar and culture split here because the agenda gives each its
        // own slot; they close identically.
        const drills = await levelDrills();
        for (const drill of drills) {
          if (drill.patternKey !== undefined) {
            grammarKeyFor.set(drill.subject, drill.patternKey);
          }
        }
        const grammarDrills = drills.filter(
          (drill) => drill.kind === "grammar_drill",
        );
        const cultureDrills = drills.filter(
          (drill) => drill.kind === "culture_drill",
        );

        // The learner's own ceiling first, then the model's request under
        // it: a learner who asked for short sittings gets them however many
        // items the model asks for.
        const size = Math.min(limit ?? MAX_AGENDA_ITEMS, agendaSizeFor(coaching));
        const notCovered = (activity: AgendaActivity) =>
          !covered.has(activity.subject);
        // A mix rather than a queue: vocabulary interleaved with grammar —
        // recorded mistakes ahead of the syllabus — and the news last, in
        // whatever the review rows say: a learner with nothing due still has
        // something real to read, and a learner with a full agenda ends on it
        // rather than on a drill.
        const composeFresh = () =>
          composeMixedAgenda({
            vocabulary: plan.vocabularyActivities.filter(notCovered),
            grammar: [...plan.mistakeActivities, ...grammarDrills].filter(notCovered),
            culture: cultureDrills.filter(notCovered),
            // The reading item, unless it is done or the learner asked the
            // sessions to stop ending on it.
            news: covered.has(NEWS_SUBJECT) || !coaching.news ? null : NEWS_ACTIVITY,
            size,
            mix: MIX_FOR_FOCUS[coaching.focus],
          });

        // The session's promise, kept. The opening call composes the agenda;
        // every later call serves what is left of it, in order, instead of
        // recomposing from the backlog — which refilled finished items' slots
        // with new words, session after session, and kept the closing news
        // item forever one agenda away. The pin is subject keys only: each is
        // resolved against the pools just built, so the text the model reads
        // is still what the database just said, and a key that no longer
        // resolves is dropped rather than invented.
        const resolveFromPin = (
          pinned: readonly string[],
        ): AgendaActivity[] => {
          const bySubject = new Map<string, AgendaActivity>();
          for (const activity of [
            ...plan.vocabularyActivities,
            ...plan.mistakeActivities,
            ...drills,
            NEWS_ACTIVITY,
          ]) {
            if (!bySubject.has(activity.subject)) {
              bySubject.set(activity.subject, activity);
            }
          }

          const seen = new Set<string>();
          const resolved: AgendaActivity[] = [];
          let stale = 0;
          for (const subject of pinned) {
            if (covered.has(subject) || seen.has(subject)) continue;
            seen.add(subject);

            const activity = bySubject.get(subject);
            if (activity === undefined) {
              stale += 1;
              continue;
            }
            resolved.push(activity);
          }
          if (stale > 0) {
            logger.info("trainer.agenda_item_stale", {
              requestId: deps.requestId,
              userIdHash: deps.userIdHash,
              count: stale,
            });
          }
          return resolved;
        };

        const pinned = deps.pinned ?? [];
        let remaining =
          pinned.length > 0 ? resolveFromPin(pinned) : composeFresh();
        let composedFresh = pinned.length === 0;
        // A pin that resolves to nothing before anything was covered is a
        // stale promise from another day, not a finished session: start over.
        if (remaining.length === 0 && pinned.length > 0 && covered.size === 0) {
          remaining = composeFresh();
          composedFresh = true;
        }

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

        // The opening, and only the opening, is handed the listing: a fresh
        // agenda for a session with nothing done yet and no answer to record.
        // Mid-session calls get counts and the next item — a model handed the
        // full list again read it as a session starting and announced it all
        // over, mid-quiz, to a learner whose screen already shows the plan.
        const opening =
          composedFresh && record === undefined && covered.size === 0 && !announced;
        if (opening) announced = true;

        const next = remaining[0];
        return JSON.stringify({
          // What the record shortcut did, so the model never has to guess
          // whether the close it asked for happened.
          ...(recorded === undefined ? {} : { record: recorded }),
          dueCount: plan.due.length,
          weakCount: plan.weak.length,
          completed: covered.size,
          remaining: remaining.length,
          // The list to read out, on the opening call alone: subjects only.
          // An agenda that carried its prompts would be a quiz the learner
          // can read ahead of, and a model handed eight questions asks all
          // eight.
          ...(opening
            ? {
                agenda: agenda.map((line, index) => ({
                  position: index + 1,
                  kind: line.kind,
                  subject: line.subject,
                })),
              }
            : {}),
          // One question, and only the next one. The model cannot ask an item
          // twice because it is never handed one the session has closed.
          // One question, and only the next one — under a field name that
          // says what it is. A ready question arrives as "prompt" and is
          // asked as written. A recurring mistake arrives as "struggles":
          // the note recorded about what keeps going wrong, background for
          // the trainer to teach from, never an exercise to read out — the
          // session protocol tells the model to write its own. A grammar
          // drill arrives as "teach": the catalogue's own explanation of the
          // pattern, with the key that opens get_grammar_pattern for more.
          next: next
            ? {
                position: 1,
                kind: next.kind,
                subject: next.subject,
                // "struggles" carries model-authored wording from an earlier
                // evaluation, and the others quote stored text; neutralise
                // anything fence-shaped before it re-enters a prompt.
                ...(next.kind === "correct_the_mistake"
                  ? { struggles: escapeUntrusted(next.prompt) }
                  : next.kind === "grammar_drill" || next.kind === "culture_drill"
                    ? {
                        teach: escapeUntrusted(next.prompt),
                        pattern: next.patternKey,
                      }
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
        record: z
          .strictObject({
            subject: z.string().trim().min(1).max(96),
            outcome: z.enum(["correct", "incorrect"]),
          })
          .optional(),
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
      audited("record_review_outcome", () => recordOutcome(subject, outcome))(),
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

  /**
   * The second write, and the one the learner asks for in words. The model
   * hands over a closed-set partial — which dials, which positions — and the
   * arithmetic in lib/trainer/coaching.ts applies it; nothing here interprets
   * a sentence. Persisted as the signed-in learner (RLS applies), capped per
   * request, and reported back whole so the model knows what now holds. With
   * no repository wired, the request is honoured for this turn only and the
   * reply says so, so the model never promises a write that did not happen.
   */
  const adjustCoaching = tool(
    async (request: {
      explanationDepth?: (typeof EXPLANATION_DEPTHS)[number];
      challenge?: (typeof CHALLENGE_LEVELS)[number];
      sessionLength?: (typeof SESSION_LENGTHS)[number];
      focus?: (typeof PRACTICE_FOCUSES)[number];
      news?: boolean;
    }) =>
      audited("adjust_coaching", async () => {
        if (coachingWrites >= MAX_COACHING_WRITES_PER_REQUEST) {
          return JSON.stringify({
            adjusted: false,
            reason: "write_limit_reached",
            coaching: dialsOf(coaching),
          });
        }
        coachingWrites += 1;

        const update = applyAdjustment(coaching, request, now());
        if (update.changed.length === 0) {
          return JSON.stringify({
            adjusted: false,
            reason: "already_set",
            coaching: dialsOf(coaching),
          });
        }

        if (deps.coaching === undefined) {
          coaching = update.profile;
          return JSON.stringify({
            adjusted: true,
            persisted: false,
            coaching: dialsOf(coaching),
            changed: update.changed.map((change) => change.dial),
          });
        }

        const saved = await deps.coaching.repository.upsertProfile(update.profile);
        if (!saved.ok) return UNAVAILABLE;

        coaching = saved.data;
        // Which dials moved is audited; the learner's words never are (S24).
        logger.info("trainer.coaching_adjusted", {
          audit: true,
          requestId: deps.requestId,
          userIdHash: deps.userIdHash,
          source: "conversation",
          dials: update.changed.map((change) => change.dial),
        });
        return JSON.stringify({
          adjusted: true,
          persisted: true,
          coaching: dialsOf(coaching),
          changed: update.changed.map((change) => change.dial),
        });
      })(),
    {
      name: "adjust_coaching",
      description: TRAINER_TOOL_HELP.adjust_coaching,
      schema: z
        .strictObject({
          explanationDepth: z.enum(EXPLANATION_DEPTHS).optional(),
          challenge: z.enum(CHALLENGE_LEVELS).optional(),
          sessionLength: z.enum(SESSION_LENGTHS).optional(),
          focus: z.enum(PRACTICE_FOCUSES).optional(),
          news: z.boolean().optional(),
        })
        .refine((request) => Object.values(request).some((value) => value !== undefined), {
          error: "name at least one setting to change",
        }),
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
      adjustCoaching,
    ],
    sources: () => [...cited],
    agenda: () => (agenda === null ? null : [...agenda]),
    covered: () => [...covered],
    complete: () => complete,
    coaching: () => coaching,
  };
}
