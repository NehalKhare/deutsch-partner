import { CEFR_LEVELS, MAX_MINI_LEVEL } from "@dp/domain/cefr";
import { TUTOR } from "@dp/domain/tutor";

import { FAQ } from "@/lib/landing/faq";
import { ROOMS } from "@/lib/landing/rooms";
import { GUIDED_HOURS, timelinePhrase } from "@/lib/landing/timeline";
import { absoluteUrl, PUBLIC_PAGES, SITE } from "@/lib/seo/site";

/**
 * /llms.txt: the product, in plain Markdown, for a language model.
 *
 * The convention (llmstxt.org) is a title, a one-paragraph summary in a
 * blockquote, then short sections. It exists because an answer engine asked
 * "what is Deutsch Partner" reads this before it reads a page built for a
 * browser, and a page built for a browser is mostly markup. Everything here
 * is drawn from the same constants and copy the page uses, so what a model
 * repeats is what the product says.
 */
export function llmsText(appUrl: string): string {
  const lastLevel = CEFR_LEVELS[CEFR_LEVELS.length - 1]!;

  const lines: string[] = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    `${SITE.name} is a web application for English speakers learning German, from ` +
      `absolute beginner to ${lastLevel}. The learner talks to a tutor named ${TUTOR.name} ` +
      `in German; the tutor replies at the learner's level, corrects mistakes in the way ` +
      `that level can use, and keeps a record of what the learner knows. The curriculum ` +
      `is ${MAX_MINI_LEVEL} hand-authored mini-levels across ${CEFR_LEVELS.join(", ")}, ` +
      `all open from the first day. The site is written in English and teaches German.`,
    "",
    "## What a learner does",
    "",
    ...ROOMS.map((room) => `- **${room.name}.** ${room.what}`),
    "",
    "## How long it takes",
    "",
    `Based on the roughly ${GUIDED_HOURS.A1}, ${GUIDED_HOURS.A2} and ${GUIDED_HOURS.B1} ` +
      `guided hours language schools plan for A1, A2 and B1, spent in conversation:`,
    "",
    ...CEFR_LEVELS.map(
      (level) =>
        `- ${level}: ${timelinePhrase(level, 30)} at 30 minutes a day, ` +
        `${timelinePhrase(level, 60)} at 60 minutes a day.`,
    ),
    "",
    "Every learner's pace differs. The product reports where a learner actually is.",
    "",
    "## What it does not do",
    "",
    "- It does not issue certificates. It estimates readiness and says what the estimate is based on.",
    "- It does not teach through exercises about German. It is German, used, with somebody who answers.",
    "- It is free to start and asks for no card.",
    "",
    "## Questions",
    "",
    ...FAQ.flatMap((entry) => [`### ${entry.question}`, "", entry.answer, ""]),
    "## Pages",
    "",
    ...PUBLIC_PAGES.map(
      (page) => `- [${page.title}](${absoluteUrl(appUrl, page.path)}): ${page.description}`,
    ),
    "",
  ];

  return lines.join("\n");
}
