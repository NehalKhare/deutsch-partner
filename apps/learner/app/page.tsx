import type { Metadata } from "next";
import Link from "next/link";

import { Companion } from "@/components/companion/companion";
import { CompanionDemo } from "@/components/landing/companion-demo";
import { JsonLd } from "@/components/seo/json-ld";
import { Wordmark } from "@dp/ui/wordmark";
import { TUTOR } from "@dp/domain/tutor";
import { buttonPrimary } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import { companionStateFor, MAX_GROWTH_STAGE } from "@dp/domain/companion";
import { MAX_MINI_LEVEL } from "@dp/domain/cefr";
import { siteEnv } from "@/lib/env/server";
import { FAQ } from "@/lib/landing/faq";
import { ROOMS } from "@/lib/landing/rooms";
import { GUIDED_HOURS, timelinePhrase } from "@/lib/landing/timeline";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { landingStructuredData } from "@/lib/seo/structured-data";

export const metadata: Metadata = publicPageMetadata("/");

/** One representative mini-level per growth band, for the progress strip. */
const GROWTH_MARKERS = Array.from({ length: MAX_GROWTH_STAGE }, (_, index) => {
  const band = MAX_MINI_LEVEL / MAX_GROWTH_STAGE;
  const first = Math.round(index * band) + 1;
  const last = Math.round((index + 1) * band);

  return { first, last, sample: last };
});

export default function Home() {
  const structuredData = landingStructuredData(siteEnv().appUrl);

  return (
    <div className="flex min-h-dvh flex-col bg-ground font-body text-copy">
      <JsonLd data={structuredData} />
      <header className="flex items-center justify-between border-b border-edge/60 px-6 py-4 md:px-10">
        <Wordmark />
        <nav className="flex items-center gap-5 text-sm">
          <Link
            href="/auth/login"
            className="text-copy/70 underline-offset-4 hover:text-copy hover:underline"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-full border border-brand px-4 py-1.5 font-display text-brand hover:bg-brand/10"
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
            <p className="font-display text-xl text-brand">
              Just start talking.
            </p>

            <p className="max-w-md text-lg leading-relaxed text-copy/75">
              You have been learning German for a year and you still freeze at
              the bakery. The problem was never vocabulary. It was that nothing
              ever talked back.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link href="/auth/sign-up" className={buttonPrimary}>
                Start free
              </Link>
              <span className="text-sm text-copy/60">
                No card. Your first conversation takes two minutes.
              </span>
            </div>
          </div>
        </section>

        {/* The proof. Product output with the learner state shown in the
            margin — this is the thing a generic chatbot cannot put on a page. */}
        <section className="border-y border-edge/60 bg-panel">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:px-10 md:py-24">
            <div className="flex flex-col gap-3">
              <p className="font-display text-xs uppercase tracking-[0.2em] text-copy/40">
                Week three
              </p>
              <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
                It notices the mistake you keep making.
              </h2>
            </div>

            <div className="flex flex-col gap-6 rounded-2xl border border-edge/70 bg-ground/60 p-6 md:p-8">
              <div className="flex flex-col gap-2">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-copy/40">
                  You
                </p>
                <p lang="de" className="text-xl leading-relaxed">
                  Ich <mark className="bg-transparent text-brand underline decoration-brand/50 decoration-wavy underline-offset-4">habe</mark>{" "}
                  gestern nach Berlin gefahren.
                </p>
              </div>

              <div className="flex flex-col gap-2 border-l-2 border-brand/40 pl-5">
                <p className="font-display text-xs uppercase tracking-[0.16em] text-copy/40">
                  {TUTOR.name}
                </p>
                <p lang="de" className="text-xl leading-relaxed">
                  Fast! Bei „fahren“ nimmt man „sein“: Ich{" "}
                  <strong className="font-semibold text-sprout">bin</strong>{" "}
                  nach Berlin gefahren. Und wie war es?
                </p>
                <p className="text-sm text-copy/60">
                  Almost! With <em>fahren</em> you use <em>sein</em>. And how
                  was it?
                </p>
              </div>

              <p className="border-t border-edge/60 pt-4 font-display text-sm text-copy/60">
                <span className="text-sprout">Third time this month.</span>{" "}
                Perfekt with <em>sein</em> is now in your review queue, and it
                will come back in conversation until it sticks.
              </p>
            </div>

            <p className="max-w-2xl text-lg leading-relaxed text-copy/70">
              Every conversation updates what we know about you: the words you
              have met, the ones you can actually use, the patterns you reach
              for and the ones you avoid. Nothing is a fresh start.
            </p>
          </div>
        </section>

        {/* What the rooms are. Each line names a real feature and stops:
            the product is the pitch, and a claim that outruns it would be
            found out within the first session. */}
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 md:px-10 md:py-24">
          <div className="flex flex-col gap-3">
            <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
              What you actually do here
            </h2>
            <p className="max-w-xl text-lg leading-relaxed text-copy/70">
              Not exercises about German. German, used — with somebody who
              answers.
            </p>
          </div>

          <ul aria-label="What you can do here" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROOMS.map((room) => (
              <li
                key={room.name}
                className="flex flex-col gap-2 rounded-2xl border border-edge/70 bg-panel/50 p-5"
              >
                <h3 className="font-display text-lg font-semibold text-brand">
                  {room.name}
                </h3>
                <p className="text-sm leading-relaxed text-copy/70">{room.what}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Growth. A genuine sequence, so the numbering earns its place. */}
        <section className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16 md:px-10 md:py-24">
          <div className="flex flex-col gap-3">
            <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Seventy mini-levels. Your partner grows through all of them.
            </h2>
            <p className="max-w-xl text-lg leading-relaxed text-copy/70">
              Not more vocabulary each time — a different kind of thinking.
              Naming things, then combining them, then telling a story, then
              disagreeing with someone.
            </p>
          </div>

          {/* A five-column grid rather than a wrapping flex row: this is a
              sequence, and a strip that folds 4 + 1 stops reading as one. */}
          <ol aria-label="Growth stages" className="grid grid-cols-5 items-end gap-2 sm:gap-8">
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
                <span className="font-display text-xs tracking-wide text-copy/45">
                  {marker.first}–{marker.last}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Why it does not wear you out: the comfortable-difficulty policy,
            described rather than praised. This is a mechanism the product
            actually has, not a mood. */}
        <section className="border-t border-edge/60 bg-panel">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-16 md:px-10 md:py-24">
            <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Easy on purpose
            </h2>
            <div className="flex max-w-2xl flex-col gap-4 text-lg leading-relaxed text-copy/70">
              <p>
                Every reply is pitched at your level: mostly language you
                already handle comfortably, with just enough new to stretch
                you — never a wall of German you have to decode.
              </p>
              <p>
                It is how you learned your first language. Nobody handed you a
                grammar book; someone kept talking to you, always slightly
                above where you were. When you are ready, the next mini-level
                comes to you — you do not climb, it lifts.
              </p>
              <p className="text-copy/60">
                Which is why half an hour here feels like a chat, not a class.
              </p>
            </div>
          </div>
        </section>

        {/* The timeline. Language schools' own planning figures divided by
            daily minutes — a claim someone can check, phrased so rounding
            never flatters. Anything faster would be a promise the product
            cannot keep for every learner. */}
        <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:px-10 md:py-24">
          <div className="flex flex-col gap-3">
            <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
              How long it takes, honestly
            </h2>
            <p className="max-w-xl text-lg leading-relaxed text-copy/70">
              Based on the ~{GUIDED_HOURS.A1}, {GUIDED_HOURS.A2} and{" "}
              {GUIDED_HOURS.B1} guided hours language schools plan for the
              levels — just spent in conversation instead of a classroom.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-display text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-copy/40">
                <tr>
                  <th scope="col" className="py-2 pr-4">Finish</th>
                  <th scope="col" className="py-2 pr-4">30 min a day</th>
                  <th scope="col" className="py-2 pr-4">60 min a day</th>
                  <th scope="col" className="hidden py-2 sm:table-cell">
                    And then you can
                  </th>
                </tr>
              </thead>
              <tbody className="text-base">
                {(
                  [
                    ["A1", "introduce yourself, order, ask — get through the day politely"],
                    ["A2", "handle errands and small talk, tell someone about your week"],
                    ["B1", "hold your own: opinions, stories, most everyday situations"],
                  ] as const
                ).map(([level, means]) => (
                  <tr key={level} className="border-t border-edge/50">
                    <th scope="row" className="py-3 pr-4 font-semibold text-brand">
                      {level}
                    </th>
                    <td className="py-3 pr-4 text-copy/80">
                      {timelinePhrase(level, 30)}
                    </td>
                    <td className="py-3 pr-4 text-copy/80">
                      {timelinePhrase(level, 60)}
                    </td>
                    <td className="hidden py-3 text-sm text-copy/60 sm:table-cell">
                      {means}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-2xl text-sm leading-relaxed text-copy/60">
            Your pace will differ — everyone&apos;s does. The product tells you
            where you actually are, not where the calendar says you should be.
          </p>
        </section>

        {/* The questions a visitor asks before signing up, answered in the
            open. Plain headings and paragraphs rather than a disclosure
            widget: a reader can scan them, and so can a crawler — the same
            list is in the page's structured data, and Google only honours
            FAQ markup it can see on the page. */}
        <section
          id="faq"
          aria-labelledby="faq-heading"
          className="border-t border-edge/60 bg-panel"
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16 md:px-10 md:py-24">
            <h2
              id="faq-heading"
              className="max-w-xl font-display text-3xl font-semibold tracking-tight md:text-4xl"
            >
              Questions, answered plainly
            </h2>
            <div className="grid gap-8 md:grid-cols-2">
              {FAQ.map((entry) => (
                <article key={entry.question} className="flex flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold text-brand">
                    {entry.question}
                  </h3>
                  <p className="leading-relaxed text-copy/70">{entry.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Honesty, stated plainly. Everyone else overclaims here. */}
        <section className="border-t border-edge/60">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-16 md:flex-row md:items-center md:justify-between md:px-10 md:py-20">
            <div className="flex max-w-lg flex-col gap-3">
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                B1-oriented, and honest about it.
              </h2>
              <p className="leading-relaxed text-copy/70">
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

      <footer className="border-t border-edge/60 px-6 py-6 text-sm text-copy/40 md:px-10">
        Deutsch Partner — an AI conversation partner for learning German.
      </footer>
    </div>
  );
}
