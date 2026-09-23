import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { MAX_MINI_LEVEL } from "@dp/domain/cefr";
import { MASTERY_THRESHOLDS } from "@dp/domain/learner";
import type { LearnerDetail } from "@dp/db/learner-admin-repository";
import { buttonQuiet, card, eyebrow, field, linkInline, pageTitle, prose, sectionTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import {
  clearSkippedLevelsAction,
  deleteAccountAction,
  deleteMemoryAction,
  resetDisputedCorrectionsAction,
  resetLevelPerformanceAction,
  setErrorResolvedAction,
  setMasteryThresholdAction,
  setMiniLevelAction,
} from "./actions";
import { formatUtc } from "@/components/costs/format";
import { SupportActionForm } from "@/components/learners/support-action-form";
import { SectionPanel } from "@/components/operations/section-panel";
import { createLearnerSupport, pseudonymFor } from "@/lib/api/composition";
import { isOperator } from "@/lib/auth/operator";
import { requireOperator } from "@/lib/auth/require-operator";
import { deletionPhrase } from "@/lib/learner-directory";
import { ledgerHref } from "@/lib/ledger-query";

export const metadata = { title: "Learner — Deutsch Partner" };

/**
 * Everything the product stores about one learner, and the corrections
 * support may make.
 *
 * Opening this page is an access to personal data and is audited as one,
 * under the operator's pseudonym and the learner's. The learner is named by
 * pseudonym; the email appears only in the data export, which is theirs.
 * Conversation text is not here because it is not stored: threads are
 * metadata, and the level tallies are the long-term record of a session.
 * What is here, unabridged, is what the product keeps — memories and the
 * learner's own example sentences included.
 */

const date = (value: Date | null) => (value === null ? "—" : formatUtc(value));
const pct = (value: number) => `${Math.round(value * 100)}%`;

export default async function LearnerPage({
  params,
}: {
  readonly params: Promise<{ readonly learnerId: string }>;
}) {
  const operator = await requireOperator({ route: "/learners/[learnerId]" });

  const learnerId = z.uuid().safeParse((await params).learnerId);
  if (!learnerId.success) notFound();

  const { learners, accounts, logger } = createLearnerSupport();
  const found = await learners.detail(learnerId.data);
  const learnerHash = pseudonymFor(learnerId.data);

  if (!found.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10 md:px-10">
        <h1 className={pageTitle}>Learner</h1>
        <p role="alert" className={cn(prose, "mt-4")}>This learner&rsquo;s data could not be read.</p>
      </main>
    );
  }

  // An account that signed up and never onboarded has no profile, only an auth
  // user. It still has to be deletable; an id with neither is a 404.
  if (found.data === null && (await accounts.get(learnerId.data)) === null) notFound();

  logger.info("learner.viewed", { audit: true, userIdHash: operator.hash, learnerHash });

  const detail = found.data;
  const operatorAccount = isOperator(learnerId.data);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-2">
        <Link href="/learners" className={cn(linkInline, "w-fit font-display text-sm")}>← Learners</Link>
        <h1 className={cn(pageTitle, "break-all font-mono text-2xl md:text-3xl")}>{learnerHash}</h1>
        <p className="font-display text-sm text-copy/50">
          Account {learnerId.data}
          {detail === null
            ? " · signed up, never onboarded"
            : ` · joined ${date(detail.createdAt)} · onboarded ${date(detail.onboardedAt)}`}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={ledgerHref({ days: 31, user: learnerHash })} className={buttonQuiet}>Model calls</Link>
          <Link href="/costs/budgets" className={buttonQuiet}>Budgets</Link>
          {detail === null ? null : (
            // A plain link: the route answers with an attachment. Audited there.
            <a href={`/learners/${learnerId.data}/export`} download className={buttonQuiet}>Export data (JSON)</a>
          )}
        </div>
      </header>

      {operatorAccount ? (
        <p role="note" className="rounded-xl border border-brand/50 bg-brand/10 px-4 py-3 text-sm text-brand">
          This account is on the operator allowlist.
        </p>
      ) : null}

      {detail === null ? null : <LearnerSections learnerId={learnerId.data} detail={detail} />}

      <DangerZone learnerId={learnerId.data} learnerHash={learnerHash} operatorAccount={operatorAccount} />
    </main>
  );
}

function LearnerSections({ learnerId, detail }: { readonly learnerId: string; readonly detail: LearnerDetail }) {
  const openErrors = detail.errors.filter((error) => !error.resolved).length;

  return (
    <>
      <SectionPanel id="progress-heading" title="Level and progress" defaultOpen>
        <Progress learnerId={learnerId} detail={detail} />
      </SectionPanel>

      <SectionPanel id="errors-heading" title={`Recurring errors · ${openErrors} open`} count={detail.errors.length}>
        <Errors learnerId={learnerId} errors={detail.errors} />
      </SectionPanel>

      <SectionPanel id="memories-heading" title="Memories" count={detail.memories.length}>
        <Memories learnerId={learnerId} memories={detail.memories} />
      </SectionPanel>

      <SectionPanel id="vocabulary-heading" title="Vocabulary" count={Object.values(detail.vocabulary.byStatus).reduce((a, b) => a + (b ?? 0), 0)}>
        <Vocabulary vocabulary={detail.vocabulary} />
      </SectionPanel>

      <SectionPanel id="coaching-heading" title="Trainer coaching and feedback" count={detail.feedback.length}>
        <Coaching learnerId={learnerId} detail={detail} />
      </SectionPanel>

      <SectionPanel id="activity-heading" title="Threads, assessments and recommendations" count={detail.threads.length}>
        <Activity detail={detail} />
      </SectionPanel>
    </>
  );
}

// --- progress -----------------------------------------------------------------

function Progress({ learnerId, detail }: { readonly learnerId: string; readonly detail: LearnerDetail }) {
  const state = detail.state;
  const byLevel = new Map(detail.levels.map((level) => [level.miniLevel, level]));
  const skipped = new Set(state?.skippedMiniLevels ?? []);

  return (
    <div className="flex flex-col gap-5">
      {state === null ? (
        <p className="text-sm text-copy/55">No learner state: onboarding did not finish writing it.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-display text-sm sm:grid-cols-4">
          <Fact label="Working at" value={`${state.effectiveLevel.cefr}${state.effectiveLevel.plus ? "+" : ""}`} />
          <Fact label="Chose" value={state.selectedLevel} />
          <Fact label="Estimated" value={state.estimatedLevel ?? "—"} />
          <Fact label="Mini-level" value={`${state.miniLevel} (furthest ${state.furthestMiniLevel})`} />
          <Fact label="Fluency" value={pct(state.fluency)} />
          <Fact label="Comprehension" value={pct(state.comprehension)} />
          <Fact label="Confidence" value={pct(state.confidence)} />
          <Fact label="Mastery at" value={`${detail.profile.masteryThreshold}% strong turns`} />
        </dl>
      )}

      <LevelStrip current={state?.miniLevel ?? null} byLevel={byLevel} skipped={skipped} />

      {state === null ? null : (
        <div className="flex flex-col gap-3">
          <SupportActionForm action={setMiniLevelAction} learnerId={learnerId} label="Move">
            <label htmlFor="mini-level" className="font-display text-sm text-copy/70">Move to mini-level</label>
            <input
              id="mini-level"
              name="miniLevel"
              type="number"
              min={1}
              max={MAX_MINI_LEVEL}
              required
              defaultValue={state.miniLevel}
              className={cn(field, "w-24 py-1.5 tabular-nums")}
            />
          </SupportActionForm>
          <p className="text-xs text-copy/45">
            As the learner&rsquo;s own move does: the level follows the mini-level, the estimate is
            cleared, and nothing is marked skipped.
          </p>

          <SupportActionForm action={setMasteryThresholdAction} learnerId={learnerId} label="Save">
            <label htmlFor="threshold" className="font-display text-sm text-copy/70">Mastery threshold</label>
            <select id="threshold" name="threshold" defaultValue={String(detail.profile.masteryThreshold)} className={cn(field, "w-24 py-1.5")}>
              {MASTERY_THRESHOLDS.map((value) => (
                <option key={value} value={value}>{value}%</option>
              ))}
            </select>
          </SupportActionForm>

          {state.skippedMiniLevels.length === 0 ? null : (
            <SupportActionForm action={clearSkippedLevelsAction} learnerId={learnerId} label="Clear skipped levels">
              <span className="text-sm text-copy/60">Skipped: {state.skippedMiniLevels.join(", ")}</span>
            </SupportActionForm>
          )}
        </div>
      )}

      {detail.levels.length === 0 ? null : (
        <table className="w-full text-left font-display text-sm">
          <thead className={eyebrow}>
            <tr>
              <th scope="col" className="py-1">Mini-level</th>
              <th scope="col" className="text-right">Turns</th>
              <th scope="col" className="text-right">Strong</th>
              <th scope="col" className="text-right">Score</th>
              <th scope="col" className="pl-4">Updated</th>
              <th scope="col"><span className="sr-only">Reset</span></th>
            </tr>
          </thead>
          <tbody>
            {detail.levels.map((level) => (
              <tr key={level.miniLevel} className="border-t border-edge/50 text-copy/80">
                <td className="py-1">{level.miniLevel}</td>
                <td className="text-right tabular-nums">{level.turns}</td>
                <td className="text-right tabular-nums">{level.strongTurns}</td>
                <td className="text-right tabular-nums">{pct(level.score)}</td>
                <td className="pl-4 text-copy/55">{formatUtc(level.updatedAt)}</td>
                <td className="py-1 text-right">
                  <SupportActionForm action={resetLevelPerformanceAction} learnerId={learnerId} label="Reset" className="justify-end">
                    <input type="hidden" name="miniLevel" value={level.miniLevel} />
                  </SupportActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Seventy cells: tinted by score, ringed where they are, struck where they skipped. */
function LevelStrip({
  current,
  byLevel,
  skipped,
}: {
  readonly current: number | null;
  readonly byLevel: ReadonlyMap<number, { readonly score: number; readonly turns: number }>;
  readonly skipped: ReadonlySet<number>;
}) {
  const levels = Array.from({ length: MAX_MINI_LEVEL }, (_, index) => index + 1);

  return (
    <div className="flex flex-col gap-1.5">
      <ol
        aria-label={`Seventy mini-levels: ${byLevel.size} with turns, ${skipped.size} skipped${current === null ? "" : `, currently on ${current}`}`}
        className="grid grid-cols-10 gap-1 sm:grid-cols-14"
      >
        {levels.map((level) => {
          const tally = byLevel.get(level);
          return (
            <li
              key={level}
              title={`${level}: ${tally === undefined ? "no turns" : `${pct(tally.score)} of ${tally.turns} turns`}${skipped.has(level) ? ", skipped" : ""}`}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border font-display text-[0.65rem] tabular-nums",
                level === current ? "border-brand ring-2 ring-brand/40" : "border-edge/60",
                skipped.has(level) ? "text-copy/35 line-through" : "text-copy/70",
              )}
              style={
                tally === undefined
                  ? undefined
                  : { background: `color-mix(in oklab, var(--brand) ${Math.round(20 + tally.score * 70)}%, var(--panel))` }
              }
            >
              {level}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-copy/45">Darker is a higher share of strong turns. Ringed is where they are now; struck through is skipped.</p>
    </div>
  );
}

// --- errors -------------------------------------------------------------------

function Errors({ learnerId, errors }: { readonly learnerId: string; readonly errors: LearnerDetail["errors"] }) {
  if (errors.length === 0) return <p className="text-sm text-copy/45">No recurring errors recorded.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {errors.map((error) => (
        <li key={error.id} className={cn(card, "flex flex-col gap-2 p-4", error.resolved && "opacity-60")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-sm">
              <span className={eyebrow}>{error.errorType.replaceAll("_", " ")}</span>{" "}
              <span className="font-body text-copy">{error.pattern}</span>
            </p>
            <SupportActionForm
              action={setErrorResolvedAction}
              learnerId={learnerId}
              label={error.resolved ? "Reopen" : "Mark resolved"}
            >
              <input type="hidden" name="errorId" value={error.id} />
              <input type="hidden" name="resolved" value={error.resolved ? "false" : "true"} />
            </SupportActionForm>
          </div>
          <p className="font-display text-xs text-copy/50">
            {error.occurrenceCount}× · first {formatUtc(error.firstSeenAt)} · last {formatUtc(error.lastSeenAt)}
            {error.resolved ? " · resolved" : ""}
          </p>
          {error.exampleUtterances.length === 0 ? null : (
            <details>
              <summary className="cursor-pointer font-display text-xs text-copy/60">
                {error.exampleUtterances.length} example{error.exampleUtterances.length === 1 ? "" : "s"} in the learner&rsquo;s words
              </summary>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 font-body text-sm text-copy/75">
                {error.exampleUtterances.map((utterance, index) => (
                  <li key={index} lang="de">{utterance}</li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- memories -------------------------------------------------------------------

function Memories({ learnerId, memories }: { readonly learnerId: string; readonly memories: LearnerDetail["memories"] }) {
  if (memories.length === 0) return <p className="text-sm text-copy/45">No memories stored.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {memories.map((memory) => (
        <li key={memory.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-edge/50 pt-2 first:border-t-0 first:pt-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={eyebrow}>{memory.kind.replaceAll("_", " ")} · salience {memory.salience.toFixed(2)}</span>
            <p className="font-body text-sm text-copy/85">{memory.content}</p>
            <span className="font-display text-xs text-copy/40">{formatUtc(memory.createdAt)}</span>
          </div>
          <SupportActionForm action={deleteMemoryAction} learnerId={learnerId} label="Delete" pendingLabel="Deleting…" danger>
            <input type="hidden" name="memoryId" value={memory.id} />
          </SupportActionForm>
        </li>
      ))}
    </ul>
  );
}

// --- vocabulary -------------------------------------------------------------------

function Vocabulary({ vocabulary }: { readonly vocabulary: LearnerDetail["vocabulary"] }) {
  const statuses = Object.entries(vocabulary.byStatus);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-sm text-copy/70">
        {statuses.length === 0
          ? "No words tracked yet."
          : statuses.map(([status, count]) => `${count} ${status}`).join(" · ")}
        {vocabulary.due > 0 ? ` · ${vocabulary.due} due for review` : ""}
      </p>
      {vocabulary.rows.length === 0 ? null : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-176 text-left font-display text-sm">
            <caption className="pb-1 text-left text-xs text-copy/45">The weakest {vocabulary.rows.length}, by mastery.</caption>
            <thead className={eyebrow}>
              <tr>
                <th scope="col" className="py-1">Word</th>
                <th scope="col">Meaning</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Mastery</th>
                <th scope="col" className="text-right">Right / wrong / seen</th>
                <th scope="col" className="pl-4">Next review</th>
              </tr>
            </thead>
            <tbody>
              {vocabulary.rows.map((row) => (
                <tr key={row.vocabularyItemId} className="border-t border-edge/50 text-copy/80">
                  <td className="py-1 font-body" lang="de">{row.word}</td>
                  <td className="text-copy/60">{row.englishTranslation}</td>
                  <td>{row.status}</td>
                  <td className="text-right tabular-nums">{pct(row.masteryScore)}</td>
                  <td className="text-right tabular-nums">{row.correctCount} / {row.incorrectCount} / {row.exposureCount}</td>
                  <td className="pl-4 text-copy/55">{date(row.nextReviewAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- coaching -------------------------------------------------------------------

function Coaching({ learnerId, detail }: { readonly learnerId: string; readonly detail: LearnerDetail }) {
  const coaching = detail.coaching;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-display text-sm sm:grid-cols-4">
        <Fact label="Personality" value={detail.profile.trainerPersonality} />
        <Fact label="Corrections" value={detail.profile.correctionPreference} />
        <Fact label="Input / output" value={`${detail.profile.inputPreference} / ${detail.profile.outputPreference}`} />
        <Fact label="Sessions mined" value={String(detail.minedSessions)} />
        {coaching === null ? null : (
          <>
            <Fact label="Explanations" value={coaching.explanationDepth} />
            <Fact label="Challenge" value={coaching.challenge} />
            <Fact label="Focus" value={coaching.focus} />
            <Fact label="Votes" value={`${coaching.helpfulCount} helpful / ${coaching.unhelpfulCount} not`} />
          </>
        )}
      </dl>

      {coaching === null ? (
        <p className="text-sm text-copy/45">No coaching profile yet: the Trainer has not been tuned for this learner.</p>
      ) : (
        <SupportActionForm action={resetDisputedCorrectionsAction} learnerId={learnerId} label="Reset disputed count">
          <span className="text-sm text-copy/60">{coaching.disputedCorrections} disputed correction{coaching.disputedCorrections === 1 ? "" : "s"}</span>
        </SupportActionForm>
      )}

      {detail.feedback.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5">
          {detail.feedback.map((vote) => (
            <li key={vote.id} className="border-t border-edge/50 pt-1.5 font-display text-sm text-copy/75">
              <span className={vote.verdict === "helpful" ? "text-copy" : "text-ember"}>{vote.verdict}</span>
              {vote.reasons.length === 0 ? "" : ` · ${vote.reasons.join(", ").replaceAll("_", " ")}`}
              <span className="text-copy/40"> · prompt v{vote.promptVersion} · {formatUtc(vote.createdAt)}</span>
              {vote.note === null ? null : <p className="font-body text-copy/70">&ldquo;{vote.note}&rdquo;</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- activity -------------------------------------------------------------------

function Activity({ detail }: { readonly detail: LearnerDetail }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-sm font-semibold">Threads</h3>
        <p className="text-xs text-copy/45">Titles and topics only; what was said is not stored.</p>
        {detail.threads.length === 0 ? (
          <p className="text-sm text-copy/45">None.</p>
        ) : (
          <ul className="flex flex-col gap-1 font-display text-sm text-copy/75">
            {detail.threads.map((thread) => (
              <li key={thread.id}>
                {thread.title} <span className="text-copy/45">· {thread.mode.replaceAll("_", " ")} · {thread.cefr} {thread.miniLevel} · {formatUtc(thread.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-display text-sm font-semibold">Assessments</h3>
        {detail.assessments.length === 0 ? (
          <p className="text-sm text-copy/45">None.</p>
        ) : (
          <ul className="flex flex-col gap-1 font-display text-sm text-copy/75">
            {detail.assessments.map((row) => (
              <li key={row.id}>
                {row.kind.replaceAll("_", " ")}
                <span className="text-copy/45">
                  {row.miniLevel === null ? "" : ` · level ${row.miniLevel}`}
                  {row.score === null ? "" : ` · ${pct(row.score)}`}
                  {row.passed === null ? "" : row.passed ? " · passed" : " · not passed"}
                  {row.estimatedCefr === null ? "" : ` · estimated ${row.estimatedCefr}`}
                  {` · ${formatUtc(row.createdAt)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-display text-sm font-semibold">Recommendations</h3>
        {detail.recommendations.length === 0 ? (
          <p className="text-sm text-copy/45">None.</p>
        ) : (
          <ul className="flex flex-col gap-1 font-display text-sm text-copy/75">
            {detail.recommendations.map((row) => (
              <li key={row.id}>
                {row.activityType.replaceAll("_", " ")} · {row.topic}
                <span className="text-copy/45">
                  {` · ${row.reasonKind.replaceAll("_", " ")} · score ${row.score.toFixed(2)}`}
                  {row.acceptedAt === null ? "" : " · accepted"}
                  {` · ${formatUtc(row.createdAt)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- deletion -------------------------------------------------------------------

function DangerZone({
  learnerId,
  learnerHash,
  operatorAccount,
}: {
  readonly learnerId: string;
  readonly learnerHash: string;
  readonly operatorAccount: boolean;
}) {
  const phrase = deletionPhrase(learnerHash);

  return (
    <section aria-labelledby="delete-heading" className="flex flex-col gap-3 rounded-2xl border border-ember/50 p-5">
      <h2 id="delete-heading" className={cn(sectionTitle, "text-ember")}>Delete this account</h2>
      {operatorAccount ? (
        <p className="text-sm text-copy/60">Operator accounts are not deleted from here.</p>
      ) : (
        <>
          <p className="text-sm text-copy/70">
            Removes the sign-in and every learner table with it — profile, progress, vocabulary,
            errors, memories, threads, feedback. It cannot be undone. The ledger keeps its rows under
            the pseudonym, which cannot be traced back. Export first if the learner asked for a copy.
          </p>
          <SupportActionForm action={deleteAccountAction} learnerId={learnerId} label="Delete account" pendingLabel="Deleting…" danger>
            <label htmlFor="confirm-delete" className="font-display text-sm text-copy/70">
              Type <code className="font-mono text-ember">{phrase}</code>
            </label>
            <input
              id="confirm-delete"
              name="confirm"
              required
              autoComplete="off"
              spellCheck={false}
              className={cn(field, "w-48 py-1.5 font-mono text-sm")}
            />
          </SupportActionForm>
        </>
      )}
    </section>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-copy/45">{label}</dt>
      <dd className="text-copy/85">{value}</dd>
    </div>
  );
}
