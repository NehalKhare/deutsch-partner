import Link from "next/link";

import { Companion } from "@/components/companion/companion";
import { CompanionDemo } from "@/components/landing/companion-demo";
import { Wordmark } from "@/components/site/wordmark";
import { TUTOR } from "@/domain/tutor";
import { buttonPrimary } from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { companionStateFor, MAX_GROWTH_STAGE } from "@/domain/companion";
import { MAX_MINI_LEVEL } from "@/domain/cefr";

/** One representative mini-level per growth band, for the progress strip. */
const GROWTH_MARKERS = Array.from({ length: MAX_GROWTH_STAGE }, (_, index) => {
  const band = MAX_MINI_LEVEL / MAX_GROWTH_STAGE;
  const first = Math.round(index * band) + 1;
  const last = Math.round((index + 1) * band);

  return { first, last, sample: last };
});

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink font-body text-chalk">
      <header className="flex items-center justify-between border-b border-haze/60 px-6 py-4 md:px-10">
        <Wordmark />
        <nav className="flex items-center gap-5 text-sm">
          <Link
            href="/auth/login"
            className="text-chalk/70 underline-offset-4 hover:text-chalk hover:underline"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-full border border-apricot px-4 py-1.5 font-display text-apricot hover:bg-apricot/10"
          >
            Start free
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero. German first, English underneath — the page works the way the
            product does: something you can nearly follow, with support right
            where you need it. */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-16 px-6 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:px-10 md:py-24">
          <CompanionDemo />

          <div className="flex flex-col gap-6">
            <h1
              lang="de"
              className="font-display text-5xl font-semibold leading-[0.95] tracking-tight md:text-7xl"
            >
              Sprich einfach los.
            </h1>
            <p className="font-display text-xl text-apricot">
              Just start talking.
            </p>

            <p className="max-w-md text-lg leading-relaxed text-chalk/75">
              You have been learning German for a year and you still freeze at
              the bakery. The problem was never vocabulary. It was that nothing
              ever talked back.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link href="/auth/sign-up" className={buttonPrimary}>
                Start free
              </Link>
              <span className="text-sm text-chalk/50">
                No card. Your first conversation takes two minutes.
              </span>
            </div>
          </div>
        </section>

        {/* The proof. Product output with the learner state shown in the
            margin — this is the thing a generic chatbot cannot put on a page. */}
        <section className="border-y border-haze/60 bg-dusk">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:px-10 md:py-24">
            <div className="flex flex-col gap-3">
              <p className="font-display text-xs uppercase tracking-[0.2em] text-chalk/40">
                Week three
              </p>
              <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
                It notices the mistake you keep making.
              </h2>
            </div>

            <div className="flex flex-col gap-6 rounded-2xl border border-haze/70 bg-ink/60 p-6 md:p-8">
              <div className="flex flex-col gap-2">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-chalk/40">
                  You
                </p>
                <p lang="de" className="text-xl leading-relaxed">
                  Ich <mark className="bg-transparent text-apricot underline decoration-apricot/50 decoration-wavy underline-offset-4">habe</mark>{" "}
                  gestern nach Berlin gefahren.
                </p>
              </div>

              <div className="flex flex-col gap-2 border-l-2 border-apricot/40 pl-5">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-chalk/40">
                  {TUTOR.name}
                </p>
                <p lang="de" className="text-xl leading-relaxed">
                  Fast! Bei „fahren“ nimmt man „sein“: Ich{" "}
                  <strong className="font-semibold text-sprout">bin</strong>{" "}
                  nach Berlin gefahren. Und wie war es?
                </p>
                <p className="text-sm text-chalk/50">
                  Almost! With <em>fahren</em> you use <em>sein</em>. And how
                  was it?
                </p>
              </div>

              <p className="border-t border-haze/60 pt-4 font-display text-sm text-chalk/55">
                <span className="text-sprout">Third time this month.</span>{" "}
                Perfekt with <em>sein</em> is now in your review queue, and it
                will come back in conversation until it sticks.
              </p>
            </div>

            <p className="max-w-2xl text-lg leading-relaxed text-chalk/70">
              Every conversation updates what we know about you: the words you
              have met, the ones you can actually use, the patterns you reach
              for and the ones you avoid. Nothing is a fresh start.
            </p>
          </div>
        </section>

        {/* Growth. A genuine sequence, so the numbering earns its place. */}
        <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16 md:px-10 md:py-24">
          <div className="flex flex-col gap-3">
            <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Seventy mini-levels. Your partner grows through all of them.
            </h2>
            <p className="max-w-xl text-lg leading-relaxed text-chalk/70">
              Not more vocabulary each time — a different kind of thinking.
              Naming things, then combining them, then telling a story, then
              disagreeing with someone.
            </p>
          </div>

          {/* A five-column grid rather than a wrapping flex row: this is a
              sequence, and a strip that folds 4 + 1 stops reading as one. */}
          <ol className="grid grid-cols-5 items-end gap-2 sm:gap-8">
            {GROWTH_MARKERS.map((marker) => (
              <li
                key={marker.first}
                className="flex flex-col items-center gap-3"
              >
                <Companion
                  state={companionStateFor({
                    miniLevel: marker.sample,
                    activity: "idle",
                  })}
                  decorative
                  className="[--companion-size:1.9rem] sm:[--companion-size:2.75rem]"
                />
                <span className="font-display text-xs tracking-wide text-chalk/45">
                  {marker.first}–{marker.last}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Honesty, stated plainly. Everyone else overclaims here. */}
        <section className="border-t border-haze/60">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between md:px-10 md:py-20">
            <div className="flex max-w-lg flex-col gap-3">
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                B1-oriented, and honest about it.
              </h2>
              <p className="leading-relaxed text-chalk/70">
                We estimate your readiness and tell you what the estimate is
                based on. We do not issue certificates, and we will never tell
                you that you have passed something you have not sat.
              </p>
            </div>
            <Link href="/auth/sign-up" className={cn(buttonPrimary, "shrink-0")}>
              Start free
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-haze/60 px-6 py-6 text-sm text-chalk/40 md:px-10">
        Deutsch Partner — an AI conversation partner for learning German.
      </footer>
    </div>
  );
}
