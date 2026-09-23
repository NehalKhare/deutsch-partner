"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

import {
  LIVE_FEED_LENGTH,
  describeTimelineEntry,
  liveRunEventSchema,
  liveTimelineEventSchema,
  relativeTime,
  timelineEntryFrom,
  type TimelineEntry,
} from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

/**
 * What a working run is doing, line by line, as it does it.
 *
 * The card above this says which stage the run is at. This says what the
 * agent inside that stage just did — searched the web, read a finding, got a
 * reply from the model — from the run's own timeline, streamed by the server
 * as each row lands. Between rows the agent is always waiting on a model, so
 * the last line says so; that minute of silence on a reasoning-tier call is
 * the one this feed exists to explain.
 *
 * Every frame is validated before a field of it is trusted, and nothing
 * arrives that the timeline does not carry: tool arguments, results and model
 * replies never reached the timeline. When the stream says the run has moved
 * on, the page is refreshed so the card catches up at once rather than on
 * the next poll; when it says the run has settled, the feed closes.
 *
 * No EventSource — a test runtime, an old browser — means no feed and no
 * error: the polling card is still the truth, just slower.
 */

type FeedState = "connecting" | "live" | "closed";

/** What the browser hands over to reconnect from: the highest id it has seen. */
function endpointFor(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/events`;
}

export function RunLiveFeed({
  runId,
  working,
}: {
  readonly runId: string;
  /** Whether the card believes the run is moving. Nothing is opened otherwise. */
  readonly working: boolean;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<readonly TimelineEntry[]>([]);
  const [state, setState] = useState<FeedState>("connecting");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!working) return;
    if (typeof EventSource === "undefined") return;

    const source = new EventSource(endpointFor(runId));
    let stage: string | null = null;

    const onTimeline = (message: MessageEvent<string>) => {
      const parsed = liveTimelineEventSchema.safeParse(safeJson(message.data));
      if (!parsed.success) return;
      const entry = timelineEntryFrom(parsed.data);
      setState("live");
      setNow(new Date());
      setEntries((current) =>
        current.some((existing) => existing.id === entry.id)
          ? current
          : [...current, entry].slice(-LIVE_FEED_LENGTH),
      );
    };

    const onRun = (message: MessageEvent<string>) => {
      const parsed = liveRunEventSchema.safeParse(safeJson(message.data));
      if (!parsed.success) return;
      setState("live");
      // The first frame says where the run already is; only a later one
      // means it moved while this was open, and that is what a refresh is for.
      if (stage !== null && stage !== parsed.data.stage) {
        startTransition(() => router.refresh());
      }
      stage = parsed.data.stage;
    };

    const onDone = () => {
      setState("closed");
      source.close();
      startTransition(() => router.refresh());
    };

    source.addEventListener("timeline", onTimeline as EventListener);
    source.addEventListener("run", onRun as EventListener);
    source.addEventListener("done", onDone);

    // The relative times on each line age while nothing else arrives.
    const clock = setInterval(() => setNow(new Date()), 15_000);

    return () => {
      clearInterval(clock);
      source.close();
    };
  }, [runId, working, router]);

  if (!working || state === "connecting") return null;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-haze/50 bg-ink/40 px-3 py-2">
      <ol className="flex flex-col gap-0.5" aria-label="What the run is doing">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline justify-between gap-3 font-display text-xs text-chalk/60"
          >
            <span className={cn(entry.status === "failed" && "text-ember")}>
              {describeTimelineEntry(entry)}
            </span>
            <span className="shrink-0 tabular-nums text-chalk/35">
              {relativeTime(entry.at, now)}
            </span>
          </li>
        ))}
      </ol>
      {state === "live" ? (
        <p
          className="flex items-center gap-2 font-display text-xs text-apricot/80"
          role="status"
        >
          <span
            aria-hidden="true"
            className="inline-block size-1.5 animate-pulse rounded-full bg-apricot"
          />
          Waiting on the model…
        </p>
      ) : null}
    </div>
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
