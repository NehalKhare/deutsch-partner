import type { ReviewActivityKind } from "@/learning/review";

/**
 * What a Trainer session is made of, and in what order.
 *
 * Pure composition, no I/O — the same discipline as learning/review.ts: which
 * items go into a sitting is arithmetic on lists the database already handed
 * over, and no model gets a say in it.
 *
 * The policy this file exists to hold: a session is a mix, not a queue. The
 * old agenda was the review plan concatenated — every due word, then the weak
 * ones, then the mistakes, then the news — cut to size. A learner with a
 * backlog of vocabulary therefore got vocabulary and nothing else, session
 * after session, because the grammar and the reading always sat past the cut.
 * Here the grammar work gets reserved slots and the news gets the last one,
 * whatever the backlog says.
 */

/**
 * What one agenda line asks for.
 *
 * The review engine's activities, plus the two the engine knows nothing
 * about. Reading a real news item is not spaced repetition — there is no
 * schedule behind it and nothing to be due. A grammar drill is the same: a
 * pattern from the learner's level, practised because a session should hold
 * grammar even when no mistake has been recorded, not because a row said it
 * was time.
 */
export type TrainerAgendaKind =
  | ReviewActivityKind
  | "grammar_drill"
  | "read_the_news";

/** One line of the agenda, as the session shows it to the learner. */
export interface TrainerAgendaItem {
  readonly kind: TrainerAgendaKind;
  readonly subject: string;
}

/** One line of the agenda, with what the trainer needs to run it. */
export interface AgendaActivity {
  readonly kind: TrainerAgendaKind;
  readonly subject: string;
  readonly prompt: string;
  /** For grammar drills: the catalogue key get_grammar_pattern answers to. */
  readonly patternKey?: string;
}

/**
 * How much of one agenda is grammar work.
 *
 * Two of eight: enough that every session teaches some grammar, small enough
 * that the vocabulary backlog still shrinks. Recorded mistakes take these
 * slots first — a thing that keeps going wrong outranks a thing on the
 * syllabus — and level drills fill whatever the mistakes leave.
 */
export const GRAMMAR_SLOTS = 2;

/**
 * The session: vocabulary first, then grammar, the news last.
 *
 * A lesson arc rather than a shuffle — warm up on the words while attention
 * is fresh, then slow down for the rules, then close on reading something
 * real. The order is fixed so a learner always knows where they are in a
 * sitting: the news coming into view means the session is nearly done.
 *
 * Quotas rather than concatenation. The news takes one slot whenever it is
 * still to do, grammar takes up to GRAMMAR_SLOTS of what is left, vocabulary
 * fills the rest — and a pool that comes up short hands its slots to the
 * other, so a learner with nothing due still gets a full lesson of grammar
 * and reading rather than a session that is over before it starts.
 *
 * Callers pass pools already filtered to what this sitting has not covered,
 * with the grammar pool ordered mistakes-first.
 */
export function composeMixedAgenda(inputs: {
  readonly vocabulary: readonly AgendaActivity[];
  readonly grammar: readonly AgendaActivity[];
  readonly news: AgendaActivity | null;
  readonly size: number;
}): AgendaActivity[] {
  const room = Math.max(0, inputs.size - (inputs.news === null ? 0 : 1));

  // One grammar item per three working slots, capped at GRAMMAR_SLOTS: a full
  // agenda reserves two, a small one stays mostly vocabulary rather than
  // handing what little room it has to the rules.
  const grammarQuota = Math.min(
    GRAMMAR_SLOTS,
    inputs.grammar.length,
    Math.floor(room / 3),
  );
  const vocabulary = inputs.vocabulary.slice(0, room - grammarQuota);
  // Vocabulary that ran out gives its slots back to grammar.
  const grammar = inputs.grammar.slice(
    0,
    Math.min(inputs.grammar.length, room - vocabulary.length),
  );

  const mixed = [...vocabulary, ...grammar];
  return inputs.news === null ? mixed : [...mixed, inputs.news];
}
