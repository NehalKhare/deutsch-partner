import { cn } from "@dp/ui/utils";
import { eyebrow } from "@dp/ui/styles";
import {
  MASTERY_MIN_TURNS,
  hasMastered,
  masteryFill,
  thresholdRatio,
  type LevelTally,
  type TurnQuality,
} from "@dp/learning/mastery";

/**
 * How close this level is to being earned, said honestly.
 *
 * The gate has two parts and the strip shows both without blending them: the
 * bar is the strong-turn ratio against the learner's own pass mark — it rises
 * on an error-free turn and falls on one with errors, which is the feedback a
 * learner can act on — and the dots are the evidence floor, five evaluated
 * turns, which only ever fills. Folding the floor into the bar would make an
 * early error read as progress.
 *
 * Nothing here decides anything. The tally arrives from the server, the same
 * numbers the mastery gate itself reads, and this draws them. A quality
 * verdict is shown only when the parent saw this exact turn get counted; a
 * reload or a level move shows the state, not a judgement. And "ready" is an
 * offer, not a countdown — mastery moves nobody until they say so.
 */
export function MasteryProgress({
  tally,
  lastTurn,
  threshold = 80,
}: {
  /** The tally for the level the learner is standing on. */
  tally: LevelTally;
  /** How the newest counted turn went, or null when none was counted. */
  lastTurn: TurnQuality | null;
  /** The learner's pass mark, as the percentage they chose in settings. */
  threshold?: number;
}) {
  const ratio = thresholdRatio(threshold);
  const percent = Math.round(masteryFill(tally, ratio) * 100);
  const evaluated = Math.min(tally.turns, MASTERY_MIN_TURNS);
  const ready = hasMastered(tally, ratio);

  return (
    <section
      aria-label="Progress to the next mini-level"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
    >
      <span className={eyebrow}>Mastery</span>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`Error-free turns against your ${threshold}% bar`}
        className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-edge/60"
      >
        <div
          data-fill
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            lastTurn === "weak" ? "bg-ember" : "bg-apricot",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* The evidence floor: the gate will not open before five evaluated
          turns however clean they were, and hiding that would make a full bar
          into a promise the next message breaks. */}
      <span className="flex items-center gap-1">
        {Array.from({ length: MASTERY_MIN_TURNS }, (_, index) => (
          <span
            key={index}
            aria-hidden
            data-dot={index < evaluated ? "filled" : "empty"}
            className={cn(
              "size-1.5 rounded-full",
              index < evaluated ? "bg-copy/70" : "bg-edge/70",
            )}
          />
        ))}
        <span className="sr-only">
          {evaluated} of {MASTERY_MIN_TURNS} evaluated turns
        </span>
      </span>

      {lastTurn ? (
        <span
          data-turn-quality={lastTurn}
          className={cn(
            "font-display text-xs",
            lastTurn === "strong" ? "text-apricot" : "text-ember",
          )}
        >
          {lastTurn === "strong" ? "+ error-free" : "− had errors"}
        </span>
      ) : null}

      {ready ? (
        <span className="font-display text-xs text-apricot">
          Ready to move up — whenever you are.
        </span>
      ) : null}
    </section>
  );
}
