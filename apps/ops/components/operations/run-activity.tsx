"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

import { RunLiveFeed } from "@/components/operations/run-live-feed";
import { card, eyebrow } from "@dp/ui/styles";
import { shouldPoll, type RunReport } from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

/**
 * What the pipeline is doing right now.
 *
 * A scan is several model calls driven in the background after the response
 * has gone out, so pressing the button and getting the page back tells an
 * operator nothing about whether anything is happening. This is the part that
 * does: it names the stage in words, and it asks the server for the board
 * again while there is something to see.
 *
 * The polling stops because of the *data*, not because of a counter here. A
 * run that goes quiet for longer than a stage could take is reported as
 * stalled by the server's own clock, `shouldPoll` is then false, and the
 * ticking ends — so a tab left open on a run whose drive died stops querying
 * within one stall window rather than forever. Nothing in the browser has to
 * keep a deadline for that to hold.
 *
 * A stalled run gets a sentence telling the operator to nudge it, which is
 * the honest thing to show: every stage is a resume point, and an animation
 * over a run nobody is driving is worse than no animation at all.
 */

/**
 * How often to ask, while something is working.
 *
 * One indexed query behind one RPC. Short enough that a stage finishing shows
 * up while an operator is still looking at the page, long enough that it is
 * not a load generator.
 */
const POLL_INTERVAL_MS = 6_000;

export function RunActivityPanel({
  reports,
  intervalMs = POLL_INTERVAL_MS,
}: {
  readonly reports: readonly RunReport[];
  readonly intervalMs?: number;
}) {
  const router = useRouter();
  const polling = shouldPoll(reports);

  useEffect(() => {
    if (!polling) return;

    const timer = setInterval(() => {
      // In a transition, so the page keeps showing what it has while the
      // new render arrives rather than flashing through a pending state.
      startTransition(() => router.refresh());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [polling, intervalMs, router]);

  // Nothing in flight and nothing recently stopped renders nothing at all.
  // The board below is already the answer to what exists; an empty box saying
  // so would just be furniture.
  if (reports.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(card, "flex flex-col gap-2")}
    >
      {reports.map((report) => (
        <div key={report.run.id} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <span
              className={cn(
                eyebrow,
                "shrink-0",
                report.activity === "working" && "text-apricot",
                report.activity === "stalled" && "text-ember",
                report.activity === "failed" && "text-ember",
              )}
            >
              {/* The word an operator scans for, before reading the sentence. */}
              {headline(report)}
            </span>
            <p className="font-display text-sm text-chalk/70">{report.message}</p>
          </div>
          <RunLiveFeed runId={report.run.id} working={report.activity === "working"} />
        </div>
      ))}

      {polling ? (
        <p className="font-display text-xs text-chalk/40">
          This page is updating itself while the work runs.
        </p>
      ) : null}
    </div>
  );
}

/** One word for the state, distinct from the sentence that explains it. */
function headline(report: RunReport): string {
  const scanning = report.run.runType === "manual_market_scan";

  switch (report.activity) {
    case "working":
      return scanning ? "Scanning" : "Working";
    case "stalled":
      return "Stalled";
    case "waiting":
      return "Your move";
    case "worker":
      return "Worker";
    case "done":
      return "Finished";
    case "failed":
      return "Stopped";
    case "rejected":
      return "Rejected";
  }
}
