import Link from "next/link";

import {
  chooseMiniLevelAction,
  practiseMiniLevelAction,
  switchLevelAction,
} from "@/app/(app)/curriculum/actions";
import { PendingButton } from "@dp/ui/pending-button";
import { SwitchLevel } from "@/components/curriculum/switch-level";
import {
  ARTICLE_COLOR,
  buttonQuiet,
  card,
  eyebrow,
  focusRing,
  pageTitle,
  prose,
  sectionTitle,
} from "@dp/ui/styles";
import { CEFR_LEVELS, miniLevelRangeFor } from "@dp/domain/cefr";
import { browseBand, levelToBrowse } from "@/lib/curriculum/browse";
import { miniLevelForLevel, wasSkipped } from "@dp/learning/progression";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { getMiniLevel } from "@dp/learning/mini-levels";
import { cn } from "@dp/ui/utils";
import { createLearnerRepository } from "@dp/db/learner-repository";
import { createPerformanceRepository } from "@dp/db/performance-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "Curriculum — Deutsch Partner" };

const ARTICLE_BORDER: Readonly<Record<string, string>> = {
  der: "border-t-der/60",
  die: "border-t-die/60",
  das: "border-t-das/60",
};

/**
 * The syllabus, open — and walkable.
 *
 * Seventy mini-levels, four hundred and twenty words with their article, their
 * plural and their English. Every level is somewhere a learner can stand:
 * each row carries a "start here", and a "practise" that moves them there and
 * opens a conversation at it, because a syllabus you can read but not enter
 * is a brochure.
 *
 * Which band is on screen lives in the URL rather than in state: it survives a
 * reload, it can be linked to, and it costs no JavaScript.
 */
/**
 * What a failed action says. A closed set: the notice arrives in a URL, and
 * an unknown value renders nothing rather than echoing attacker text.
 */
const NOTICES: Readonly<Record<string, string>> = {
  move_failed: "We could not move you just now. You are still where you were.",
  practise_failed:
    "You were moved, but the conversation could not be opened. Try Practise again.",
};

export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; notice?: string }>;
}) {
  const learnerId = await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const [state, tallies] = await Promise.all([
    createLearnerRepository(supabase).getState(learnerId),
    createPerformanceRepository(supabase).listForLearner(learnerId),
  ]);

  // Scores are seasoning here, not structure: a page that cannot read them
  // still shows the whole syllabus.
  const scoreFor = new Map(
    (tallies.ok ? tallies.data : [])
      .filter((tally) => tally.turns > 0)
      .map((tally) => [tally.miniLevel, tally]),
  );

  const params = await searchParams;
  const notice = NOTICES[params.notice ?? ""] ?? null;
  const learner = state.ok ? state.data : null;
  const at = learner?.miniLevel ?? null;
  const showing = levelToBrowse(
    params.level,
    learner?.effectiveLevel.cefr ?? "A1",
  );
  const band = browseBand(showing);
  const isCurrentBand = learner?.effectiveLevel.cefr === showing;
  const wouldLandOn = miniLevelForLevel(showing, learner?.furthestMiniLevel ?? 1);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
      <header className="flex flex-col gap-3">
        <p className={eyebrow}>The whole path · {band.wordCount} words at this level</p>
        <h1 className={pageTitle}>What you are learning</h1>
        <p className={`${prose} max-w-2xl`}>
          Seventy mini-levels from your first <span lang="de">Hallo</span> to
          holding an opinion. Every noun keeps its colour —{" "}
          <span lang="de" className="font-medium text-der">der</span>,{" "}
          <span lang="de" className="font-medium text-die">die</span>,{" "}
          <span lang="de" className="font-medium text-das">das</span> — because
          genders are not guessable and pretending otherwise wastes a year.
        </p>
      </header>

      {/* Links, not buttons: looking at a level is a different act from moving
          to one, and only one of them should change anything. */}
      <nav aria-label="Level" className="flex flex-wrap items-center gap-2">
        {CEFR_LEVELS.map((level) => {
          const active = level === showing;
          const range = miniLevelRangeFor(level);

          return (
            <Link
              key={level}
              href={`/curriculum?level=${level}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-baseline gap-2 rounded-full border px-5 py-2 font-display text-sm transition-colors",
                active
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-edge text-copy/60 hover:border-copy/40 hover:text-copy",
                focusRing,
              )}
            >
              <span className="font-semibold">{level}</span>
              <span className="text-xs tabular-nums opacity-60">
                {range.first}–{range.last}
              </span>
              {learner?.effectiveLevel.cefr === level ? (
                <span className="text-xs text-copy/60">you are here</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {notice ? (
        <p
          role="alert"
          className="rounded-xl border border-ember/40 bg-ember/10 px-4 py-2.5 text-sm text-ember"
        >
          {notice}
        </p>
      ) : null}

      {learner ? (
        <div className={cn(card, "flex flex-col gap-3")}>
          <p className="text-copy/80">
            You are on <strong className="text-copy">mini-level {at}</strong> —{" "}
            <span lang="de">{getMiniLevel(learner.miniLevel).theme}</span>, which
            is {learner.effectiveLevel.cefr}.
          </p>
          {isCurrentBand ? (
            <p className="text-xs text-copy/45">
              This is the level you are being taught at. Pick any mini-level
              below to stand somewhere else.
            </p>
          ) : (
            <SwitchLevel
              level={showing}
              miniLevel={wouldLandOn}
              theme={getMiniLevel(wouldLandOn).theme}
              action={switchLevelAction}
            />
          )}
        </div>
      ) : null}

      {/* The article practice, first. It is the reason most of the words on
          this page are hard, and it cannot be learned from a list where the
          articles are scattered through seventy separate tables. */}
      <section aria-labelledby="articles-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="articles-heading" className={sectionTitle}>
            <span lang="de">
              <span className="text-der">Der</span>,{" "}
              <span className="text-die">die</span>,{" "}
              <span className="text-das">das</span>
            </span>
          </h2>
          <p className="text-sm text-copy/60">
            Every noun {showing} teaches, in its own column. {band.nounCount} of
            them.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {band.byArticle.map((group) => (
            <div
              key={group.article}
              className={cn(
                card,
                "flex flex-col gap-2 border-t-2 p-4",
                ARTICLE_BORDER[group.article],
              )}
            >
              <p
                className={cn(
                  "font-display text-lg font-semibold",
                  ARTICLE_COLOR[group.article],
                )}
                lang="de"
              >
                {group.article}
                <span className="ml-2 text-xs font-normal tabular-nums text-copy/40">
                  {group.words.length}
                </span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {group.words.map((word) => (
                  <li key={word.word} className="text-sm leading-snug">
                    <span lang="de" className="text-copy">
                      {word.word}
                    </span>
                    <span className="text-copy/60"> — {word.english}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="levels-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="levels-heading" className={sectionTitle}>
            Mini-levels {band.first} to {band.last}
          </h2>
          <p className="text-sm text-copy/60">
            Open one to see its words — or stand on it and practise.
          </p>
        </div>

        <ol className="flex flex-col gap-3">
          {band.levels.map((level) => {
            const here = level.miniLevel === at;
            const skipped = learner ? wasSkipped(learner, level.miniLevel) : false;
            const tally = scoreFor.get(level.miniLevel);

            return (
              <li key={level.miniLevel}>
                {/* Closed by default: seventy open levels is not a page a
                    learner reads, it is one they scroll past. */}
                <details
                  open={here}
                  className={cn(
                    card,
                    "group p-0",
                    here && "border-brand/50 bg-brand/5",
                  )}
                >
                  <summary
                    className={cn(
                      "flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl px-5 py-3.5",
                      focusRing,
                    )}
                  >
                    {/* Styling the summary as flex removes the browser's own
                        disclosure triangle, so one is drawn back: rows must
                        say they open before somebody happens to click one. */}
                    <span
                      aria-hidden
                      className="self-center text-[0.6rem] text-copy/40 transition-transform group-open:rotate-90"
                    >
                      ▶
                    </span>
                    <span className="w-6 text-right font-display text-xs tabular-nums text-copy/40">
                      {level.miniLevel}
                    </span>
                    <span lang="de" className="font-display font-medium text-copy">
                      {level.theme}
                    </span>
                    <span className="text-sm text-copy/60">{level.focus}</span>
                    {tally ? (
                      <span className="font-display text-xs tabular-nums text-sprout/90">
                        {Math.round(tally.score * 100)}% · {tally.turns}{" "}
                        {tally.turns === 1 ? "turn" : "turns"}
                      </span>
                    ) : null}
                    {here ? (
                      <span className="ml-auto font-display text-xs uppercase tracking-wider text-brand">
                        you are here
                      </span>
                    ) : skipped ? (
                      <span className="ml-auto font-display text-xs uppercase tracking-wider text-copy/60">
                        skipped
                      </span>
                    ) : null}
                  </summary>

                  <div className="flex flex-col gap-4 border-t border-edge/50 px-5 py-4">
                    {/* Standing somewhere and talking from it are one gesture
                        apart. Practise moves you there and opens the
                        conversation; Start here just moves you. */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <form action={practiseMiniLevelAction}>
                        <input
                          type="hidden"
                          name="miniLevel"
                          value={level.miniLevel}
                        />
                        <PendingButton
                          className={cn(buttonQuiet, "border-brand/50 text-brand hover:bg-brand/10")}
                        >
                          Practise this level →
                        </PendingButton>
                      </form>
                      {!here ? (
                        <form action={chooseMiniLevelAction}>
                          <input
                            type="hidden"
                            name="miniLevel"
                            value={level.miniLevel}
                          />
                          <PendingButton className={buttonQuiet}>
                            Start here
                          </PendingButton>
                        </form>
                      ) : null}
                    </div>

                    {level.grammar.length > 0 ? (
                      <p className="text-sm text-copy/60">
                        <span className={eyebrow}>Grammar</span>{" "}
                        {level.grammar.join(" · ")}
                      </p>
                    ) : null}

                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">
                        Words taught at mini-level {level.miniLevel}
                      </caption>
                      <thead className={eyebrow}>
                        <tr>
                          <th scope="col" className="py-1">German</th>
                          <th scope="col">English</th>
                          <th scope="col" className="hidden sm:table-cell">Plural</th>
                        </tr>
                      </thead>
                      <tbody>
                        {level.words.map((word) => (
                          <tr key={word.word} className="border-t border-edge/40">
                            <td lang="de" className="py-1.5 pr-3">
                              {word.article ? (
                                <>
                                  <span className={cn("font-medium", ARTICLE_COLOR[word.article])}>
                                    {word.article}
                                  </span>{" "}
                                  <span className="text-copy">
                                    {word.word.replace(/^(der|die|das)\s+/u, "")}
                                  </span>
                                </>
                              ) : (
                                <span className="text-copy">{word.word}</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-copy/60">
                              {word.english}
                            </td>
                            <td
                              lang="de"
                              className="hidden py-1.5 text-copy/60 sm:table-cell"
                            >
                              {word.plural ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
