"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { linkInline, prose, focusRing } from "@/components/ui/styles";
import {
  INITIAL_DELETE_THREAD_STATE,
  type DeleteThreadAction,
} from "@/lib/chat/delete-thread";

/**
 * Recent conversations, each one deletable.
 *
 * Deleting is the only irreversible thing a learner can do in this product, so
 * it asks first. Not a browser confirm() — that is unstyleable, unreadable on
 * a phone and blocks the page — but the row itself changing into the question,
 * with the keyboard moved onto the answer.
 *
 * There is no undo, and there should not be: an undo means the conversation
 * was not deleted, which is not what the learner asked for. Asking first is
 * the honest version of the same protection.
 */

export interface RecentThread {
  readonly id: string;
  readonly title: string;
}

const rowClass =
  "flex items-center justify-between gap-3 rounded-xl border border-haze/60 " +
  "px-4 py-2.5 transition-colors hover:border-apricot/50";

const quietControl =
  `shrink-0 rounded-full px-3 py-1 font-display text-xs uppercase ` +
  `tracking-wider transition-colors ${focusRing}`;

/**
 * What to say about the rows that are no longer here.
 *
 * More than one at a time means the page was stale — somebody deleted from a
 * second tab. Saying nothing would be the same silence this exists to fix, so
 * it says how many rather than pretending to know which.
 */
function announce(gone: readonly RecentThread[]): string {
  if (gone.length === 0) return "";
  if (gone.length === 1) return `Deleted “${gone[0]?.title}”.`;
  return `Deleted ${gone.length} conversations.`;
}

export function ThreadList({
  threads,
  action,
}: {
  readonly threads: readonly RecentThread[];
  readonly action: DeleteThreadAction;
}) {
  const [known, setKnown] = useState(threads);
  const [announcement, setAnnouncement] = useState("");
  const announcer = useRef<HTMLParagraphElement>(null);

  // Success is announced by the list, not by the row, because success is the
  // one outcome that removes the row — and with it any live region inside it.
  //
  // What gets announced is what the server actually stopped sending back, not
  // what the action returned: this reads the difference between the list that
  // was rendered and the list that just arrived, so it cannot congratulate
  // anybody on a deletion that did not happen.
  if (threads !== known) {
    const gone = known.filter(
      (previous) => !threads.some((current) => current.id === previous.id),
    );
    setKnown(threads);
    setAnnouncement(announce(gone));
  }

  // The row that had focus has just been removed, so focus is on <body> and a
  // keyboard user is back at the top of the document. Moving it to the
  // confirmation is both the announcement and somewhere to stand.
  useEffect(() => {
    if (announcement) announcer.current?.focus();
  }, [announcement]);

  return (
    <div className="flex flex-col gap-2">
      {/* The empty state belongs to this component rather than to the page,
          because deleting the last conversation is the moment the list becomes
          empty — and a page that swaps the list out for a sentence unmounts
          the announcement along with it. */}
      {threads.length === 0 ? (
        <p className={prose}>
          Nothing yet.{" "}
          <Link href="/chat" className={linkInline}>
            Start one
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} action={action} />
          ))}
        </ul>
      )}

      {/* Always rendered and never display:none — a live region inserted at the
          same moment as its content is one a screen reader can miss. */}
      <p
        ref={announcer}
        role="status"
        tabIndex={-1}
        className="px-4 text-xs text-chalk/45 outline-none empty:sr-only"
      >
        {announcement}
      </p>
    </div>
  );
}

function ThreadRow({
  thread,
  action,
}: {
  readonly thread: RecentThread;
  readonly action: DeleteThreadAction;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_DELETE_THREAD_STATE,
  );
  const [confirming, setConfirming] = useState(false);
  const [settled, setSettled] = useState(state);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // A refusal disarms the row: leaving it armed after "we could not delete
  // that" invites a second press at something that just said no.
  //
  // Adjusted during render rather than in an effect. The row's armed state is
  // derived from the action's — not synchronised with it — so doing this in an
  // effect would render the armed row once more before taking it back.
  if (state !== settled) {
    setSettled(state);
    if (state.status === "error") setConfirming(false);
  }

  // The control that was pressed has just been replaced by a different one.
  // Somebody navigating by keyboard should be standing on the answer, not
  // hunting for where the question went. A focus call is a DOM effect, which
  // is what effects are actually for.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <li className="flex flex-col gap-1">
      <div className={rowClass}>
        <Link
          href={`/chat/${thread.id}`}
          className={`min-w-0 flex-1 truncate text-chalk/80 hover:text-chalk ${focusRing} rounded-sm`}
        >
          {thread.title}
        </Link>

        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="threadId" value={thread.id} />

          {confirming ? (
            <>
              <span className="hidden text-xs text-chalk/50 sm:inline">
                This cannot be undone.
              </span>
              <button
                ref={confirmRef}
                type="submit"
                disabled={pending}
                aria-label={`Delete “${thread.title}” for good`}
                className={`${quietControl} bg-ember/15 text-ember hover:bg-ember/25 disabled:opacity-60`}
              >
                {pending ? "Deleting…" : "Delete for good"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={`${quietControl} text-chalk/55 hover:text-chalk`}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete “${thread.title}”`}
              className={`${quietControl} text-chalk/40 hover:text-ember`}
            >
              Delete
            </button>
          )}
        </form>
      </div>

      {/* Present from the first render rather than added with the message, and
          clipped rather than hidden when empty: `display: none` takes a live
          region out of the accessibility tree, so a message inserted as the
          region reappears is one a screen reader can miss entirely. */}
      <p
        role="status"
        aria-live="polite"
        className="px-4 text-xs text-ember empty:sr-only"
      >
        {state.message}
      </p>
    </li>
  );
}
