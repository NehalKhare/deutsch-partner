import Link from "next/link";

import { Companion } from "@/components/companion/companion";
import { VocabularyTiles } from "@/components/dashboard/vocabulary-tiles";
import { focusRing, linkInline, pageTitle, prose } from "@dp/ui/styles";
import { companionStateFor } from "@dp/domain/companion";
import { cn } from "@dp/ui/utils";
import { ERROR_TYPE_LABELS } from "@dp/learning/error-labels";
import { getMiniLevel } from "@dp/learning/mini-levels";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { currentSummary } from "@/lib/dashboard/current-summary";
import {
  bandScores,
  currentLevelTally,
  levelProgress,
  recommendNext,
} from "@/lib/dashboard/summary";
import { vocabularyWords } from "@/lib/dashboard/vocabulary";
import { MASTERY_MIN_TURNS } from "@dp/learning/progression";
import { createLearnerRepository } from "@dp/db/learner-repository";
import { createVocabularyRepository } from "@dp/db/vocabulary-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "Dashboard" };

/**
 * How many progress rows to read for the vocabulary lists.
 *
 * The tiles are counted in the database over every row a learner has; this
 * caps what the lists behind them can show, and the panel says so when the two
 * differ. Two hundred is comfortably more words than the catalogue introduces
 * before B2, and small enough to send with a page.
 */
const VOCABULARY_SHOWN = 200;

/** Section headings as small labels: they name a region, the figures speak. */
const sectionLabel =
  "font-display text-xs font-semibold uppercase tracking-[0.14em] text-copy/55";

const panel = "flex flex-col rounded-2xl border border-edge/70 bg-panel/70 p-4";

/** Inset, because the mistakes panel clips overflow and would cut an outset ring. */
const insetRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand";

/**
 * The learner's progress.
 *
 * Every number here comes from one database function. Nothing is computed in
 * this component beyond formatting, which is the difference between a page
 * that is consistent with itself and six queries that race.
 *
 * No learner id is passed as a filter. The queries run as the signed-in
 * learner and Row Level Security decides what is visible.
 */
export default async function DashboardPage() {
  const learnerId = await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  const vocabulary = createVocabularyRepository(supabase);

  const [summary, profile, practised] = await Promise.all([
    // The same read the shell already made for the nav's due count, memoised
    // per request — so this page costs one aggregate, not two.
    currentSummary(),
    createLearnerRepository(supabase).getProfile(learnerId),
    // The learner's progress rows. The words they point at are fetched below,
    // because an id is not something to show anybody.
    vocabulary.listForLearner(learnerId, VOCABULARY_SHOWN),
  ]);

  if (!summary.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12 md:px-10">
        <h1 className={pageTitle}>Your progress</h1>
        <p className={cn(prose, "mt-4")}>
          We could not load your progress just now. Please refresh and try again.
        </p>
      </main>
    );
  }

  const data = summary.data;
  const records = practised.ok ? practised.data : [];
  const items = await vocabulary.findByIds(
    records.map((record) => record.vocabularyItemId),
  );
  const words = vocabularyWords({
    records,
    items: items.ok ? items.data : [],
    now: new Date(),
  });

  const interests = profile.ok ? profile.data.interests : [];
  const target = getMiniLevel(data.level.miniLevel).masteryCriteria.vocabularyMastered;
  const progress = Math.round(levelProgress(data, target) * 100);
  const next = recommendNext(data, interests);
  const bands = bandScores(data.levelScores);
  const tally = currentLevelTally(data);
  // The learner's own pass mark from settings, with the product default for
  // a profile that could not be read — the same fallback the gate itself has.
  const gatePercent = profile.ok ? profile.data.masteryThreshold : 80;

  const score = tally ? Math.round(tally.score * 100) : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 md:gap-5 md:px-8 md:py-8">
      {/* The companion is the progress bar a learner actually reads: it is
          this size because of what they have done, and it grew getting here. */}
      <header className="flex items-center gap-3 md:gap-4">
        <Companion
          state={companionStateFor({
            miniLevel: data.level.miniLevel,
            activity: "idle",
          })}
          decorative
          className="shrink-0 [--companion-size:3.25rem] md:[--companion-size:4rem]"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-display text-[0.7rem] font-medium uppercase tracking-[0.14em] text-copy/50">
            Mini-level {data.level.miniLevel} of 70 · {data.level.effective}
            {data.level.plus ? "+" : ""}
          </p>
          <h1 className="truncate font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {data.miniLevel.theme}
          </h1>
          <p className="line-clamp-1 text-sm text-copy/60">{data.miniLevel.focus}</p>
        </div>
      </header>

      {next ? (
        // The one recommendation, given the weight of one and put first:
        // offering three is how a learner ends up choosing none of them, and
        // burying the one below the stats is how they never see it.
        <Link
          href={next.candidate.activityType === "review" ? "/review" : "/chat"}
          className={cn(
            "group flex items-center justify-between gap-3 rounded-2xl border border-brand/50 bg-brand/10 px-4 py-3 transition-colors hover:bg-brand/15",
            focusRing,
          )}
        >
          <div className="flex min-w-0 flex-col">
            <h2 id="next-heading" className={sectionLabel}>
              Do this next
            </h2>
            <span className="truncate font-display font-medium text-copy">
              {next.candidate.title}
            </span>
          </div>
          <span
            aria-hidden
            className="font-display text-brand transition-transform group-hover:translate-x-1"
          >
            →
          </span>
        </Link>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <section aria-labelledby="progress-heading" className={cn(panel, "gap-2.5")}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="progress-heading" className={sectionLabel}>
              This level
            </h2>
            <span className="font-display text-xl font-semibold leading-none tabular-nums text-copy">
              {score === null ? "—" : `${score}%`}
            </span>
          </div>
          {/* The gate, stated as the rule it is: the tally of evaluated turns
              is what actually moves a learner up, so it leads the card — with
              the bar showing accuracy against their own mark. */}
          {tally && score !== null ? (
            <>
              <div
                role="progressbar"
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Turn accuracy at this level, towards the ${gatePercent}% gate`}
                className="relative h-2 w-full overflow-hidden rounded-full bg-edge/50"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-700"
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className="text-xs leading-snug text-copy/60">
                Error-free across {tally.turns} evaluated{" "}
                {tally.turns === 1 ? "turn" : "turns"}. At {gatePercent}% over{" "}
                {MASTERY_MIN_TURNS} or more, you move up on your own.
              </p>
            </>
          ) : (
            <p className="text-xs leading-snug text-copy/60">
              No evaluated turns yet —{" "}
              <Link href="/chat" className={linkInline}>
                have a conversation
              </Link>{" "}
              and your score appears here.
            </p>
          )}
          <div className="mt-auto flex items-center gap-3 border-t border-edge/50 pt-2.5">
            <span className="shrink-0 text-xs text-copy/60">Words mastered</span>
            <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-edge/50">
              <div className="h-full rounded-full bg-sprout/80" style={{ width: `${progress}%` }} />
            </div>
            <span className="shrink-0 font-display text-xs tabular-nums text-copy/70">
              {data.vocabulary.mastered}/{target}
            </span>
          </div>
        </section>

        <section aria-labelledby="skills-heading" className={cn(panel, "gap-2.5")}>
          <h2 id="skills-heading" className={sectionLabel}>
            How your German is developing
          </h2>
          {/* Nudged a fraction of the way by every evaluated message — slow on
              purpose, which is why they are shown as fills rather than counts. */}
          <dl className="flex flex-1 flex-col justify-around gap-2">
            {[
              ["Fluency", data.skills.fluency],
              ["Comprehension", data.skills.comprehension],
              ["Confidence", data.skills.confidence],
            ].map(([label, value]) => {
              const percent = Math.round(Number(value) * 100);

              return (
                <div key={String(label)} className="flex items-center gap-3">
                  <dt className="w-28 shrink-0 text-sm text-copy/70">{label}</dt>
                  <dd className="flex flex-1 items-center gap-2.5">
                    <div
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${label} estimate`}
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge/50"
                    >
                      <div
                        className="h-full rounded-full bg-sprout/80"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right font-display text-xs tabular-nums text-copy/70">
                      {percent}%
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      </div>

      <section aria-labelledby="levels-heading" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="levels-heading" className={sectionLabel}>
            Your levels
          </h2>
          <Link href="/curriculum" className={cn(linkInline, "font-display text-xs")}>
            See the whole path →
          </Link>
        </div>
        {/* A band's score is the average of its practised mini-level scores —
            with the coverage said beside it, so one strong level cannot pose
            as a finished band. */}
        <dl className="grid grid-cols-3 gap-2">
          {bands.map((band) => {
            const current = band.level === data.level.effective;

            return (
              <div
                key={band.level}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl border px-3 py-2",
                  current ? "border-brand/50 bg-brand/5" : "border-edge/70 bg-panel/70",
                )}
              >
                <dt className="flex items-baseline justify-between gap-1">
                  <span className="font-display text-xs font-semibold text-copy/60">
                    {band.level}
                  </span>
                  {current ? (
                    <span className="font-display text-[0.65rem] text-brand">now</span>
                  ) : null}
                </dt>
                <dd className="flex flex-col">
                  <span className="font-display text-xl font-semibold leading-tight tabular-nums text-copy">
                    {band.averageScore === null
                      ? "—"
                      : `${Math.round(band.averageScore * 100)}%`}
                  </span>
                  <span className="truncate text-[0.7rem] text-copy/55">
                    {band.practised === 0
                      ? "not practised"
                      : `${band.practised} of ${band.of} levels`}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="vocabulary-heading" className="flex flex-col gap-2">
        <h2 id="vocabulary-heading" className={sectionLabel}>
          Vocabulary
        </h2>
        {data.vocabulary.total === 0 ? (
          <p className="text-xs text-copy/60">
            Words you use in conversation are tracked here. Say something to start.
          </p>
        ) : null}
        {/* Each figure opens into the words behind it. A count on its own is
            something to look at; the list is something to read. */}
        <VocabularyTiles
          counts={{
            known: data.vocabulary.total,
            mastered: data.vocabulary.mastered,
            due: data.vocabulary.due,
            tricky: data.vocabulary.weak,
          }}
          words={words}
        />
      </section>

      {data.recurringMistakes.length > 0 ? (
        <section
          aria-labelledby="mistakes-heading"
          className="flex flex-col overflow-hidden rounded-2xl border border-edge/70 bg-panel/70"
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-edge/50 px-4 py-2">
            <h2 id="mistakes-heading" className={sectionLabel}>
              Keeps coming back
            </h2>
            {/* One line of purpose: this list is what the tutor is quietly
                watching for in every conversation. */}
            <span className="truncate text-xs text-copy/50">
              Jonas watches for these
            </span>
          </div>
          <ul className="divide-y divide-edge/40">
            {data.recurringMistakes.map((mistake) => (
              <li key={`${mistake.errorType}:${mistake.pattern}`}>
                {/* The category headline is deterministic English from a
                    closed set, so even a mistake recorded before the
                    evaluator explained in English still reads as teaching
                    rather than as a foreign log line. Folded to one line,
                    opened to the whole note. */}
                <details className="group">
                  <summary className={`flex cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors hover:bg-panel [&::-webkit-details-marker]:hidden ${insetRing}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm font-medium text-copy group-open:whitespace-normal">
                        {ERROR_TYPE_LABELS[mistake.errorType]}
                      </span>
                      <span className="line-clamp-1 text-sm leading-snug text-copy/60 group-open:line-clamp-none">
                        {mistake.pattern}
                      </span>
                    </span>
                    <span className="shrink-0 font-display text-sm tabular-nums text-brand">
                      ×{mistake.occurrences}
                    </span>
                    <span
                      aria-hidden
                      className="shrink-0 font-display text-copy/40 transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
