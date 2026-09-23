import Link from "next/link";

import { Companion } from "@/components/companion/companion";
import { VocabularyTiles } from "@/components/dashboard/vocabulary-tiles";
import {
  card,
  eyebrow,
  pageTitle,
  prose,
  sectionTitle,
  stat,
} from "@dp/ui/styles";
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

export const metadata = { title: "Dashboard — Deutsch Partner" };

/**
 * How many progress rows to read for the vocabulary lists.
 *
 * The tiles are counted in the database over every row a learner has; this
 * caps what the lists behind them can show, and the panel says so when the two
 * differ. Two hundred is comfortably more words than the catalogue introduces
 * before B2, and small enough to send with a page.
 */
const VOCABULARY_SHOWN = 200;

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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
      {/* The companion is the progress bar a learner actually reads: it is
          this size because of what they have done, and it grew getting here. */}
      <header className="flex items-center gap-6">
        <Companion
          state={companionStateFor({
            miniLevel: data.level.miniLevel,
            activity: "idle",
          })}
          decorative
          className="[--companion-size:4.5rem]"
        />
        <div className="flex flex-col gap-1.5">
          <p className={eyebrow}>Mini-level {data.level.miniLevel} of 70</p>
          <h1 className={pageTitle}>{data.miniLevel.theme}</h1>
          <p className="text-chalk/60">
            {data.level.effective}
            {data.level.plus ? "+" : ""} — {data.miniLevel.focus}
          </p>
        </div>
      </header>

      <section aria-labelledby="progress-heading" className="flex flex-col gap-3">
        <h2 id="progress-heading" className={sectionTitle}>
          Progress through this level
        </h2>
        {/* The gate, stated as the rule it is: the tally of evaluated turns
            is what actually moves a learner up, so it is the first number on
            the page — with the bar showing accuracy against their own mark. */}
        {tally ? (
          <>
            <div
              role="progressbar"
              aria-valuenow={Math.round(tally.score * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Turn accuracy at this level, towards the ${gatePercent}% gate`}
              className="h-2.5 w-full overflow-hidden rounded-full bg-haze/50"
            >
              <div
                className="h-full rounded-full bg-apricot transition-[width] duration-700"
                style={{ width: `${Math.round(tally.score * 100)}%` }}
              />
            </div>
            <p className="text-sm text-chalk/55">
              <span className="font-display tabular-nums text-chalk">
                {Math.round(tally.score * 100)}%
              </span>{" "}
              of your {tally.turns} evaluated{" "}
              {tally.turns === 1 ? "turn" : "turns"} here were error-free. At{" "}
              {gatePercent}% over {MASTERY_MIN_TURNS} or more, you move up on
              your own.
            </p>
          </>
        ) : (
          <p className="text-sm text-chalk/55">
            No evaluated turns at this level yet —{" "}
            <Link href="/chat" className="text-apricot underline decoration-apricot/40 underline-offset-4 hover:decoration-apricot">
              have a conversation
            </Link>{" "}
            and your score appears here.
          </p>
        )}
        <p className="text-sm text-chalk/45">
          {data.vocabulary.mastered} of {target} of this level&apos;s words
          mastered ({progress}%).
        </p>
      </section>

      <section aria-labelledby="levels-heading" className="flex flex-col gap-4">
        <h2 id="levels-heading" className={sectionTitle}>
          Your levels
        </h2>
        {/* A band's score is the average of its practised mini-level scores —
            with the coverage said beside it, so one strong level cannot pose
            as a finished band. */}
        <dl className="grid gap-3 sm:grid-cols-3">
          {bands.map((band) => {
            const current = band.level === data.level.effective;

            return (
              <div
                key={band.level}
                className={cn(stat, current && "border-apricot/50 bg-apricot/5")}
              >
                <dt className="flex items-baseline justify-between">
                  <span className={eyebrow}>{band.level}</span>
                  {current ? (
                    <span className="font-display text-xs text-apricot">now</span>
                  ) : null}
                </dt>
                <dd className="mt-1 flex flex-col gap-0.5">
                  <span className="font-display text-2xl font-semibold tabular-nums text-chalk">
                    {band.averageScore === null
                      ? "—"
                      : `${Math.round(band.averageScore * 100)}%`}
                  </span>
                  <span className="text-xs text-chalk/50">
                    {band.practised === 0
                      ? "not practised yet"
                      : `across ${band.practised} of ${band.of} mini-levels`}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="skills-heading" className="flex flex-col gap-4">
        <h2 id="skills-heading" className={sectionTitle}>
          How your German is developing
        </h2>
        {/* Nudged a fraction of the way by every evaluated message — slow on
            purpose, which is why they are shown as fills rather than counts. */}
        <dl className="flex flex-col gap-3">
          {[
            ["Fluency", data.skills.fluency],
            ["Comprehension", data.skills.comprehension],
            ["Confidence", data.skills.confidence],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center gap-4">
              <dt className={cn(eyebrow, "w-32 shrink-0")}>{label}</dt>
              <dd className="flex flex-1 items-center gap-3">
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(Number(value) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${label} estimate`}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-haze/50"
                >
                  <div
                    className="h-full rounded-full bg-sprout/80"
                    style={{ width: `${Math.round(Number(value) * 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-display text-sm tabular-nums text-chalk/70">
                  {Math.round(Number(value) * 100)}%
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="curriculum-heading" className="flex flex-col gap-3">
        <h2 id="curriculum-heading" className={sectionTitle}>
          What you are learning
        </h2>
        <Link
          href="/curriculum"
          className="group flex items-center justify-between gap-4 rounded-2xl border border-haze/60 px-5 py-4 transition-colors hover:border-apricot/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
        >
          <span className="text-chalk/80">
            The whole path, every word with its article and its English
          </span>
          <span
            aria-hidden
            className="font-display text-chalk/40 transition-transform group-hover:translate-x-1 group-hover:text-apricot"
          >
            →
          </span>
        </Link>
      </section>

      <section aria-labelledby="vocabulary-heading" className="flex flex-col gap-4">
        <h2 id="vocabulary-heading" className={sectionTitle}>
          Vocabulary
        </h2>
        {data.vocabulary.total === 0 ? (
          <p className="text-sm text-chalk/55">
            Words you use in conversation are tracked here — how many you have
            met, mastered, and are due to review. Say something to start.
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

      {next ? (
        <section aria-labelledby="next-heading" className="flex flex-col gap-4">
          <h2 id="next-heading" className={sectionTitle}>
            Do this next
          </h2>
          {/* The one recommendation, given the weight of one. Offering three
              is how a learner ends up choosing none of them. */}
          <Link
            href={next.candidate.activityType === "review" ? "/review" : "/chat"}
            className="group flex items-center justify-between gap-4 rounded-2xl border border-apricot/50 bg-apricot/10 px-5 py-4 transition-colors hover:bg-apricot/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
          >
            <span className="font-display font-medium text-chalk">
              {next.candidate.title}
            </span>
            <span
              aria-hidden
              className="font-display text-apricot transition-transform group-hover:translate-x-1"
            >
              →
            </span>
          </Link>
        </section>
      ) : null}

      {data.recurringMistakes.length > 0 ? (
        <section aria-labelledby="mistakes-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="mistakes-heading" className={sectionTitle}>
              Keeps coming back
            </h2>
            <p className="text-sm text-chalk/55">
              The mistakes you have repeated, and how often each has returned.
              {" "}{/* One sentence of purpose: this list is what the tutor is
              quietly watching for in every conversation. */}
              Jonas watches for these while you talk.
            </p>
          </div>
          <ul className={cn(card, "flex flex-col divide-y divide-haze/50 p-0")}>
            {data.recurringMistakes.map((mistake) => (
              <li
                key={`${mistake.errorType}:${mistake.pattern}`}
                className="flex items-baseline justify-between gap-4 px-5 py-3"
              >
                {/* The category headline is deterministic English from a
                    closed set, so even a mistake recorded before the
                    evaluator explained in English still reads as teaching
                    rather than as a foreign log line. */}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-display text-sm font-medium text-chalk">
                    {ERROR_TYPE_LABELS[mistake.errorType]}
                  </span>
                  <span className="text-sm text-chalk/60">{mistake.pattern}</span>
                </span>
                <span className="shrink-0 font-display text-sm tabular-nums text-apricot">
                  ×{mistake.occurrences}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
