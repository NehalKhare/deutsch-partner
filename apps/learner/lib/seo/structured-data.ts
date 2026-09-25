import { CEFR_LEVELS } from "@dp/domain/cefr";

import { FAQ } from "@/lib/landing/faq";
import { ROOMS } from "@/lib/landing/rooms";
import { absoluteUrl, SITE } from "@/lib/seo/site";

/**
 * The landing page as schema.org describes it, for search engines and for
 * the answer engines that read the same graph.
 *
 * Four nodes, each with an id so they can point at each other: the
 * organisation, the site, the application, and the questions. The questions
 * are the same objects the page renders, because FAQ markup that says
 * something the page does not is markup that gets the site penalised.
 *
 * Plain objects rather than a typed schema library: the graph is small,
 * and the shape is asserted by a test rather than by a dependency.
 */
export function landingStructuredData(appUrl: string): Record<string, unknown> {
  const home = absoluteUrl(appUrl, "/");
  const organization = `${home}#organization`;
  const website = `${home}#website`;
  const application = `${home}#application`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization,
        name: SITE.name,
        url: home,
        logo: absoluteUrl(appUrl, "/icon"),
      },
      {
        "@type": "WebSite",
        "@id": website,
        url: home,
        name: SITE.name,
        description: SITE.description,
        inLanguage: SITE.language,
        publisher: { "@id": organization },
      },
      {
        "@type": "WebApplication",
        "@id": application,
        name: SITE.name,
        url: home,
        description: SITE.description,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        inLanguage: SITE.language,
        // Free to start, and no card. Stated as accessibility rather than as
        // an offer with a price, because there is no price to state.
        isAccessibleForFree: true,
        image: absoluteUrl(appUrl, "/opengraph-image"),
        featureList: ROOMS.map((room) => `${room.name}: ${room.what}`),
        about: {
          "@type": "Language",
          name: "German",
          alternateName: "de",
        },
        audience: {
          "@type": "EducationalAudience",
          educationalRole: "student",
          audienceType: "English speakers learning German",
        },
        educationalLevel: `CEFR ${CEFR_LEVELS[0]}–${CEFR_LEVELS[CEFR_LEVELS.length - 1]}`,
        publisher: { "@id": organization },
      },
      {
        "@type": "FAQPage",
        "@id": `${home}#faq`,
        mainEntity: FAQ.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
      },
    ],
  };
}

/**
 * JSON for a `<script type="application/ld+json">`.
 *
 * JSON.stringify does not escape `<`, and a `</script>` inside a string
 * would end the element early. The angle bracket becomes its unicode escape,
 * which JSON readers decode and HTML parsers never see.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
