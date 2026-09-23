"use client";

import { useState } from "react";

import { Companion } from "@/components/companion/companion";
import { companionStateFor, type CompanionActivity } from "@dp/domain/companion";
import { TUTOR } from "@dp/domain/tutor";

/**
 * The hero is the real component, not a picture of one.
 *
 * The three turns are the actual conversation loop: the partner speaks, the
 * learner speaks, the learner gets something wrong. A visitor can drive it
 * and see how the companion responds before signing up for anything.
 */

interface Turn {
  readonly activity: CompanionActivity;
  readonly label: string;
  readonly line: string;
  readonly gloss: string;
}

const TURNS: readonly Turn[] = [
  {
    activity: "speaking",
    label: `${TUTOR.name} speaks`,
    line: "Wie war dein Wochenende?",
    gloss: "How was your weekend?",
  },
  {
    activity: "listening",
    label: "You speak",
    line: "…",
    gloss: "Take your time. It waits.",
  },
  {
    activity: "struggling",
    label: "You slip up",
    line: "Fast! Bei „fahren“ nimmt man „sein“.",
    gloss: "Almost! With fahren you use sein.",
  },
];

/** Mid-path, so the companion on the landing page is visibly half-grown. */
const DEMO_MINI_LEVEL = 34;

export function CompanionDemo() {
  const [turnIndex, setTurnIndex] = useState(0);
  const turn = TURNS[turnIndex] ?? TURNS[0];

  const state = companionStateFor({
    miniLevel: DEMO_MINI_LEVEL,
    activity: turn.activity,
  });

  return (
    <div className="flex flex-col items-center gap-8">
      <Companion state={state} className="[--companion-size:11rem]" />

      <div className="flex min-h-24 max-w-xs flex-col items-center gap-2 text-center">
        <p
          data-testid="companion-line"
          lang="de"
          className="font-body text-xl text-copy"
        >
          {turn.line}
        </p>
        <p data-testid="companion-gloss" className="text-sm text-copy/60">
          {turn.gloss}
        </p>
      </div>

      {/* A radio group: these are one choice with three options, not three
          independent buttons, and arrow keys should move between them. */}
      <fieldset className="flex flex-wrap justify-center gap-2">
        <legend className="sr-only">Try a turn of the conversation</legend>
        {TURNS.map((option, index) => (
          <label
            key={option.activity}
            className={[
              "cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors",
              "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand",
              index === turnIndex
                ? "border-brand bg-brand/15 text-brand"
                : "border-edge text-copy/60 hover:border-copy/40 hover:text-copy",
            ].join(" ")}
          >
            <input
              type="radio"
              name="turn"
              className="sr-only"
              checked={index === turnIndex}
              onChange={() => setTurnIndex(index)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
