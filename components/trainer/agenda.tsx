"use client";

import { cn } from "@/lib/utils";

/**
 * What the session covers, beside the session rather than inside it.
 *
 * It used to sit at the top of the transcript, where it pushed the
 * conversation down and scrolled away with it — a plan you cannot see while
 * you work through it is a plan you have to remember instead. In a column of
 * its own it stays put, and the transcript gets the height back.
 *
 * Hidden below the breakpoint rather than stacked. On a phone the column would
 * be a block above the conversation, which is exactly where it was and exactly
 * what was wrong with it — and the trainer opens every session by saying what
 * it is going to cover, so the plan is in the transcript too. The panel is the
 * convenience of not scrolling back for it, and a convenience is the right
 * thing to drop when there is no room.
 */

/** One line of the session's agenda, as the server planned it. */
export interface AgendaItem {
  readonly kind: string;
  readonly subject: string;
}

/** An agenda line the learner has already been through. */
export interface AgendaEntry {
  readonly subject: string;
  readonly kind: string | null;
  readonly done: boolean;
}

/**
 * What each kind of practice asks of the learner, and the colour it wears.
 *
 * One colour per kind of work, used consistently so the panel can be read at
 * a glance: vocabulary practice is green (the growth colour this product
 * already uses for skills), a recurring mistake is ember (it is the one thing
 * here that went wrong), a grammar drill is rose (grammar work, but nothing
 * has gone wrong), and the reading item is blue. The accent stays out of it —
 * apricot marks what is happening now, not what kind of thing it is.
 */
const KINDS: Readonly<
  Record<string, { readonly label: string; readonly dot: string; readonly tint: string }>
> = {
  recognise: { label: "meaning", dot: "bg-sprout", tint: "text-sprout/80" },
  recall: { label: "recall", dot: "bg-sprout", tint: "text-sprout/80" },
  use_in_sentence: {
    label: "use in a sentence",
    dot: "bg-sprout",
    tint: "text-sprout/80",
  },
  correct_the_mistake: {
    label: "fix the mistake",
    dot: "bg-ember",
    tint: "text-ember/90",
  },
  grammar_drill: {
    label: "grammar practice",
    dot: "bg-die",
    tint: "text-die/90",
  },
  // Chalk, deliberately: the semantic colours are spoken for, and the accent
  // marks what is happening now — a culture note is the one line here that is
  // neither review nor a slip, so it wears the page's own voice.
  culture_drill: {
    label: "culture note",
    dot: "bg-chalk/60",
    tint: "text-chalk/60",
  },
  read_the_news: { label: "read today's news", dot: "bg-der", tint: "text-der/90" },
};

const FALLBACK_KIND = { label: "", dot: "bg-haze", tint: "text-chalk/40" };

export interface TrainerAgendaProps {
  readonly plan: readonly AgendaEntry[];
  /** True once nothing is left, which is a different thing from never planned. */
  readonly finished: boolean;
}

export function TrainerAgenda({ plan, finished }: TrainerAgendaProps) {
  if (plan.length === 0) return null;

  const done = plan.filter((item) => item.done).length;
  // The item the session is standing on. Everything done is dimmed, everything
  // ahead waits its turn; this one carries the accent.
  const current = plan.findIndex((item) => !item.done);

  return (
    <section
      data-role="agenda"
      aria-label="What this session covers"
      className="rounded-2xl border border-haze/70 bg-dusk/70 px-4 py-3"
    >
      <p className="flex items-baseline justify-between text-xs uppercase tracking-[0.14em] text-chalk/45">
        <span>This session{finished ? " — done" : null}</span>
        <span className="tabular-nums normal-case tracking-normal">
          {done}/{plan.length}
        </span>
      </p>
      <ol className="mt-2.5 flex flex-col gap-2">
        {plan.map((item, index) => {
          const kind = item.kind ? (KINDS[item.kind] ?? FALLBACK_KIND) : FALLBACK_KIND;
          const now = index === current;
          // A mistake's subject is an English label ("The dative case") and a
          // grammar or culture drill's is a pattern name; everything else on
          // this list is German. A screen reader told the wrong language reads
          // teaching as gibberish.
          const german =
            item.kind !== "correct_the_mistake" &&
            item.kind !== "grammar_drill" &&
            item.kind !== "culture_drill";

          return (
            <li
              key={`${item.subject}-${String(item.done)}`}
              data-done={String(item.done)}
              data-current={String(now)}
              className={cn(
                "-mx-1.5 flex items-baseline gap-2 rounded-lg px-1.5 py-0.5 text-sm",
                now && "bg-apricot/10",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mb-0.5 size-1.5 shrink-0 self-center rounded-full",
                  item.done ? "bg-haze" : kind.dot,
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span
                  lang={german ? "de" : undefined}
                  className={
                    item.done
                      ? "text-chalk/35 line-through"
                      : now
                        ? "font-medium text-chalk"
                        : "text-chalk/75"
                  }
                >
                  {item.subject}
                </span>
                {item.kind ? (
                  <span
                    className={cn("text-xs", item.done ? "text-chalk/30" : kind.tint)}
                  >
                    {kind.label || item.kind}
                    {now ? (
                      <span className="text-apricot"> · now</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
