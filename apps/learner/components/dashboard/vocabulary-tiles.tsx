"use client";

import { useId, useState } from "react";

import { ARTICLE_COLOR, focusRing } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import {
  VOCABULARY_BUCKETS,
  type PractisedWord,
  type VocabularyBucket,
  type VocabularyWords,
} from "@/lib/dashboard/vocabulary";

/**
 * The four vocabulary figures, and the words behind them.
 *
 * "45 known" is a number a learner can do nothing with. Opened, it is the list
 * of words they know — which is the thing they actually wanted to see, and the
 * thing that makes the number mean something.
 *
 * The words arrive with the page rather than being fetched on the click. They
 * are already on the server when the counts are, they are small, and a
 * disclosure that spins is a disclosure nobody opens twice.
 *
 * Open state and nothing else lives here, which is why this is the only client
 * component on the dashboard.
 */

const LABELS: Readonly<Record<VocabularyBucket, string>> = {
  known: "Known",
  mastered: "Mastered",
  due: "Due",
  tricky: "Tricky",
};

/** Said when a bucket is empty. Never "no words": say why there are none. */
const WHEN_EMPTY: Readonly<Record<VocabularyBucket, string>> = {
  known: "No words yet. Have a conversation and the ones you use appear here.",
  mastered: "Nothing mastered yet. A word gets here by coming back correctly.",
  due: "Nothing is due. Words reappear here when it is time to see them again.",
  tricky: "Nothing tricky. A word lands here after going wrong a few times.",
};

export interface VocabularyTilesProps {
  /** Counted in the database over every row, which is why they are passed. */
  readonly counts: Readonly<Record<VocabularyBucket, number>>;
  readonly words: VocabularyWords;
}

function Word({ word }: { readonly word: PractisedWord }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span lang="de" className="min-w-0">
        {word.article ? (
          <>
            <span className={cn("font-medium", ARTICLE_COLOR[word.article])}>
              {word.article}
            </span>{" "}
          </>
        ) : null}
        <span className="text-copy">{word.word}</span>
      </span>
      <span className="shrink-0 text-sm text-copy/60">{word.english}</span>
    </li>
  );
}

export function VocabularyTiles({ counts, words }: VocabularyTilesProps) {
  const [open, setOpen] = useState<VocabularyBucket | null>(null);
  const panelId = useId();

  const shown = open === null ? [] : words[open];
  // The tile counts every row in the database; the list carries the words the
  // page was able to load. Saying so is better than a list that quietly stops.
  const missing = open === null ? 0 : Math.max(0, counts[open] - shown.length);

  return (
    <div className="flex flex-col gap-2">
      {/* One row of four even on a phone: they are figures, not cards, and a
          2×2 block doubles the height to say the same four numbers. */}
      <div className="grid grid-cols-4 gap-2">
        {VOCABULARY_BUCKETS.map((bucket) => {
          const isOpen = open === bucket;

          return (
            <button
              key={bucket}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : bucket)}
              className={cn(
                "flex flex-col gap-0.5 rounded-xl border border-edge/70 bg-panel/70 px-2.5 py-2",
                "text-left transition-colors hover:border-brand/50",
                isOpen && "border-brand/60 bg-brand/5",
                focusRing,
              )}
            >
              <span className="block truncate font-display text-[0.7rem] font-medium text-copy/55">
                {LABELS[bucket]}
              </span>
              <span className="block font-display text-xl font-semibold leading-tight tabular-nums text-copy">
                {counts[bucket]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Rendered whether or not anything is open, so the control it is
          labelled by always points at something a screen reader can reach. */}
      <div id={panelId} hidden={open === null}>
        {open === null ? null : (
          <div className="rounded-2xl border border-edge/60 bg-panel/50 px-4 py-2">
            {shown.length === 0 ? (
              <p className="py-1 text-sm text-copy/60">{WHEN_EMPTY[open]}</p>
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-edge/40">
                  {shown.map((word) => (
                    <Word key={`${open}:${word.id}`} word={word} />
                  ))}
                </ul>
                {missing > 0 ? (
                  <p className="pt-2 text-xs text-copy/40">
                    Showing {shown.length} of {counts[open]}.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
