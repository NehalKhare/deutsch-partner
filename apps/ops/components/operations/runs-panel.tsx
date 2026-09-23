"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

import { RunLiveFeed } from "@/components/operations/run-live-feed";
import { PendingButton } from "@dp/ui/pending-button";
import { buttonQuiet, card, eyebrow } from "@dp/ui/styles";
import type { BoardRun } from "@dp/domain/product-ops";
import {
  explainErrorCode,
  isRemovable,
  relativeTime,
  runKindLabel,
  runReports,
  shouldPoll,
  stagePhrase,
  type RunActivity,
  type RunReport,
} from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

/**
 * Every run, as a list an operator can read top to bottom.
 *
 * This replaces three things that used to say overlapping things about the
 * same rows — a live panel, a red alert list, and a table of raw enums — with
 * one card per run. Each card leads with a single word for the state, says in
 * a sentence what is happening or what stopped it, and puts the only two
 * things an operator can do about a run — nudge it, or remove it — beside it.
 *
 * The polling stops because of the data, not because of a counter here: a run
 * that goes quiet for longer than a stage could take is reported as stalled by
 * the server's own clock, `shouldPoll` is then false, and the ticking ends.
 * Refreshes run inside a transition so the page keeps what it is showing until
 * the new render arrives, rather than flashing through a pending state.
 */

/**
 * How often to ask, while something is working. One indexed query behind one
 * RPC. Long enough not to be a load generator, or a strobe.
 */
const POLL_INTERVAL_MS = 6_000;

export function RunsPanel({
  runs,
  asOf,
  runsWithProposals,
  advance,
  retry,
  remove,
  intervalMs = POLL_INTERVAL_MS,
}: {
  readonly runs: readonly BoardRun[];
  /** The board's own clock, so "stalled" is decided by the server's time. */
  readonly asOf: Date;
  /** Runs a proposal hangs off. Those are never removable. */
  readonly runsWithProposals: ReadonlySet<string>;
  /** The nudge, for a run only the server can move. */
  readonly advance: (formData: FormData) => Promise<void>;
  /** Another go, for a run that stopped: back to the stage that failed. */
  readonly retry: (formData: FormData) => Promise<void>;
  /** Removal, for a run that stopped and left nothing behind. */
  readonly remove: (formData: FormData) => Promise<void>;
  readonly intervalMs?: number;
}) {
  const router = useRouter();
  const reports = runReports(runs, asOf);
  const polling = shouldPoll(reports);

  useEffect(() => {
    if (!polling) return;

    const timer = setInterval(() => {
      startTransition(() => router.refresh());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [polling, intervalMs, router]);

  if (runs.length === 0) {
    return (
      <p className="font-display text-sm text-copy/45">
        No runs yet. Start a scan above and it will appear here.
      </p>
    );
  }

  // Newest first, and the ones needing attention are visually distinct rather
  // than sorted apart: the order a person expects from a log is by time.
  const ordered = [...runs].toSorted(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
  const byId = new Map(reports.map((report) => [report.run.id, report]));

  return (
    <div className="flex flex-col gap-2">
      {polling ? (
        <p className="font-display text-xs text-copy/40" aria-live="polite">
          Following the work. This list updates itself while a run is moving.
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {ordered.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            asOf={asOf}
            report={byId.get(run.id) ?? null}
            removable={isRemovable(run, runsWithProposals.has(run.id))}
            advance={advance}
            retry={retry}
            remove={remove}
          />
        ))}
      </ul>
    </div>
  );
}

/** The activity of a run the reports did not cover: it stopped a while ago. */
function settledActivity(run: BoardRun): RunActivity {
  if (run.stage === "failed") return "failed";
  if (run.stage === "rejected") return "rejected";
  if (run.stage === "completed") return "done";
  if (run.stage === "human_review" || run.stage === "plan_review") return "waiting";
  return "worker";
}

const TONE: Readonly<Record<RunActivity, string>> = {
  working: "border-apricot/60 bg-apricot/10 text-apricot",
  stalled: "border-ember/60 bg-ember/10 text-ember",
  waiting: "border-apricot/60 bg-apricot/10 text-apricot",
  worker: "border-edge bg-ground/40 text-copy/70",
  done: "border-edge bg-ground/40 text-copy/60",
  failed: "border-ember/60 bg-ember/10 text-ember",
  rejected: "border-edge bg-ground/40 text-copy/60",
};

const HEADLINE: Readonly<Record<RunActivity, string>> = {
  working: "Working",
  stalled: "Stalled",
  waiting: "Your move",
  worker: "Worker",
  done: "Finished",
  failed: "Stopped",
  rejected: "Rejected",
};

function RunCard({
  run,
  asOf,
  report,
  removable,
  advance,
  retry,
  remove,
}: {
  readonly run: BoardRun;
  readonly asOf: Date;
  readonly report: RunReport | null;
  readonly removable: boolean;
  readonly advance: (formData: FormData) => Promise<void>;
  readonly retry: (formData: FormData) => Promise<void>;
  readonly remove: (formData: FormData) => Promise<void>;
}) {
  const activity = report?.activity ?? settledActivity(run);
  const explanation = activity === "failed" ? explainErrorCode(run.errorCode) : null;
  const nudgeable = activity === "working" || activity === "stalled";
  // Every stage is a resume point, so a stopped run is one to try again from
  // where it stopped — not one to start over.
  const retryable = activity === "failed";

  return (
    <li
      className={cn(
        card,
        "flex flex-col gap-2 p-4",
        activity === "stalled" && "border-ember/40",
        activity === "waiting" && "border-apricot/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-display text-[0.65rem] font-semibold uppercase tracking-wider",
            TONE[activity],
          )}
        >
          {HEADLINE[activity]}
        </span>
        <span className="font-display text-sm font-semibold text-copy">
          {runKindLabel(run)}
        </span>
        {/* The live sentence below already names the stage; a settled run
            has no sentence, so the phrase stands in the header instead. */}
        {report === null ? (
          <span className={cn(eyebrow, "normal-case tracking-normal text-copy/40")}>
            {stagePhrase(run.stage)}
          </span>
        ) : null}
        <span className="ml-auto font-display text-xs tabular-nums text-copy/40">
          {relativeTime(run.updatedAt, asOf)}
        </span>
      </div>

      {report ? (
        // A run that is moving announces its sentence; a settled one is just
        // part of the page.
        <p
          className="font-display text-sm text-copy/70"
          role={activity === "working" || activity === "stalled" ? "status" : undefined}
        >
          {report.message}
        </p>
      ) : null}

      {/* Line by line, from the run's own timeline, while it moves. */}
      <RunLiveFeed runId={run.id} working={activity === "working"} />

      {explanation ? (
        <p className="font-display text-sm text-copy/70">
          {explanation}
          {run.errorCode ? (
            <code className="ml-2 rounded bg-ground/60 px-1.5 py-0.5 font-mono text-[0.7rem] text-copy/60">
              {run.errorCode}
            </code>
          ) : null}
        </p>
      ) : null}

      {nudgeable || retryable || removable ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {nudgeable ? (
            <form action={advance}>
              <input type="hidden" name="runId" value={run.id} />
              <PendingButton className={buttonQuiet}>
                {activity === "stalled" ? "Nudge it on" : "Nudge"}
              </PendingButton>
            </form>
          ) : null}
          {retryable ? (
            <form action={retry}>
              <input type="hidden" name="runId" value={run.id} />
              <PendingButton className={buttonQuiet}>Try again from where it stopped</PendingButton>
            </form>
          ) : null}
          {removable ? (
            <form action={remove}>
              <input type="hidden" name="runId" value={run.id} />
              <PendingButton className={cn(buttonQuiet, "text-copy/60")}>
                Remove
              </PendingButton>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
