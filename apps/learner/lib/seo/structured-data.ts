import { OFFER_KEYS } from "@dp/domain/billing";
import { CEFR_LEVELS } from "@dp/domain/cefr";

import { PRICING_FAQ, planName } from "@/lib/billing/copy";
import { minorToDecimal } from "@/lib/billing/format";
import { PRICING_PATH, type OfferCatalogue, type PriceView } from "@/lib/billing/offers";
import { FAQ, type Faq } from "@/lib/landing/faq";
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
      faqPage(`${home}#faq`, FAQ),
    ],
  };
}

function faqPage(id: string, entries: readonly Faq[]): Record<string, unknown> {
  return {
    "@type": "FAQPage",
    "@id": id,
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/** UN/CEFACT unit codes, which is what schema.org's unitCode speaks. */
const UNIT_CODES = { month: "MON", year: "ANN", day: "DAY" } as const;

function offerName(view: PriceView): string {
  if (view.kind === "pass") return `${planName(view.plan)} pass`;
  return `${planName(view.plan)}, ${view.interval === "year" ? "yearly" : "monthly"}`;
}

function offerNode(view: PriceView, url: string): Record<string, unknown> {
  const amount = minorToDecimal(view.amountMinor, view.currency);
  const currency = view.currency.toUpperCase();
  return {
    "@type": "Offer",
    name: offerName(view),
    price: amount,
    priceCurrency: currency,
    url,
    category: view.kind === "pass" ? "one-off pass" : "subscription",
    // What the price buys: a month, a year, or a pass's days. A subscription
    // renews at the end of it; a pass simply ends.
    eligibleDuration: {
      "@type": "QuantitativeValue",
      value: view.kind === "pass" ? (view.passDays ?? 1) : 1,
      unitCode: view.kind === "pass" ? UNIT_CODES.day : UNIT_CODES[view.interval ?? "month"],
    },
    priceSpecification: {
      "@type": "PriceSpecification",
      price: amount,
      priceCurrency: currency,
      // Consumer prices, VAT inclusive, as the page states them (spec S11).
      valueAddedTaxIncluded: true,
    },
  };
}

/**
 * The pricing page as schema.org describes it: the same application the
 * landing page describes — the same @id, so the two graphs are one thing —
 * now with its offers, and the pricing questions.
 *
 * Every price is a row of the Stripe mirror, turned from integer cents into
 * a decimal string only here, at render. With no rows there is nothing to
 * state but Free, and nothing is invented to fill the gap. Offers point at
 * the pricing page, never at the order page, which is behind sign-in.
 */
export function pricingStructuredData(appUrl: string, catalogue: OfferCatalogue): Record<string, unknown> {
  const home = absoluteUrl(appUrl, "/");
  const pricing = absoluteUrl(appUrl, PRICING_PATH);

  const offers = [
    {
      "@type": "Offer",
      name: planName("free"),
      price: "0",
      priceCurrency: catalogue.currency.toUpperCase(),
      url: pricing,
      category: "free",
    },
    ...OFFER_KEYS.flatMap((key) => {
      const view = catalogue.offers[key];
      return view ? [offerNode(view, pricing)] : [];
    }),
  ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${home}#application`,
        name: SITE.name,
        url: home,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Any",
        isAccessibleForFree: true,
        offers,
      },
      faqPage(`${pricing}#faq`, PRICING_FAQ),
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
