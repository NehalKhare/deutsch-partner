import { describe, expect, it } from "vitest";

import { PRICING_FAQ } from "@/lib/billing/copy";
import { offerCatalogue } from "@/lib/billing/offers";
import { FAQ } from "@/lib/landing/faq";
import { ROOMS } from "@/lib/landing/rooms";
import { PRIVATE_PATHS, SITE } from "@/lib/seo/site";
import {
  landingStructuredData,
  pricingStructuredData,
  serializeJsonLd,
} from "@/lib/seo/structured-data";

import { ALL_PRICES } from "../billing/fixtures";

/**
 * The landing page as schema.org describes it. The graph is what a search
 * engine shows in a rich result and what an answer engine quotes, so its
 * shape and its honesty are both pinned here.
 */

const ORIGIN = "https://deutschpartner.example";

type Node = Record<string, unknown> & { "@type": string };

function graph(): Node[] {
  return landingStructuredData(ORIGIN)["@graph"] as Node[];
}

function node(type: string): Node {
  const found = graph().find((entry) => entry["@type"] === type);
  if (!found) throw new Error(`no ${type} node`);
  return found;
}

describe("the graph", () => {
  it("declares the schema.org context once, at the top", () => {
    expect(landingStructuredData(ORIGIN)["@context"]).toBe("https://schema.org");
  });

  it("has the four nodes a product landing page needs", () => {
    expect(graph().map((entry) => entry["@type"])).toEqual([
      "Organization",
      "WebSite",
      "WebApplication",
      "FAQPage",
    ]);
  });

  it("gives every node an id on the site's own origin, so they can point at each other", () => {
    for (const entry of graph()) {
      expect(String(entry["@id"])).toMatch(new RegExp(`^${ORIGIN}/#`));
    }
    expect(node("WebSite").publisher).toEqual({ "@id": node("Organization")["@id"] });
    expect(node("WebApplication").publisher).toEqual({ "@id": node("Organization")["@id"] });
  });

  it("names no private path anywhere", () => {
    const text = JSON.stringify(landingStructuredData(ORIGIN));
    for (const path of PRIVATE_PATHS) {
      expect(text).not.toContain(`${ORIGIN}${path}`);
    }
  });
});

describe("the application", () => {
  const app = node("WebApplication");

  it("is an educational application about German, for English speakers", () => {
    expect(app.applicationCategory).toBe("EducationalApplication");
    expect(app.about).toMatchObject({ "@type": "Language", name: "German" });
    expect(app.inLanguage).toBe(SITE.language);
    expect(app.educationalLevel).toBe("CEFR A1–B1");
  });

  it("is free to start, stated as access rather than as a price", () => {
    // There is no price to state, and a price literal in code is a figure
    // that goes quietly stale; see the security tests.
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers).toBeUndefined();
  });

  it("lists the rooms the page lists, feature by feature", () => {
    expect(app.featureList).toHaveLength(ROOMS.length);
    for (const room of ROOMS) {
      expect(app.featureList).toContain(`${room.name}: ${room.what}`);
    }
  });

  it("points at the share card and the icon as its images", () => {
    expect(app.image).toBe(`${ORIGIN}/opengraph-image`);
    expect(node("Organization").logo).toBe(`${ORIGIN}/icon`);
  });
});

describe("the questions", () => {
  const faq = node("FAQPage");

  it("are exactly the ones on the page, in the same words", () => {
    const entities = faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    expect(entities.map((entry) => entry.name)).toEqual(FAQ.map((entry) => entry.question));
    expect(entities.map((entry) => entry.acceptedAnswer.text)).toEqual(FAQ.map((entry) => entry.answer));
  });

  it("include the certificate limit and the timeline, the two claims most often overstated", () => {
    const text = JSON.stringify(faq);
    expect(text).toMatch(/never tells you that you have passed/);
    expect(text).toMatch(/about two years at 30 minutes a day/);
  });

  it("still say starting is free and asks for no card, now that there are paid plans", () => {
    const start = FAQ.find((entry) => /cost anything to start/.test(entry.question))!;
    expect(start.answer).toMatch(/^No\./);
    expect(start.answer).toMatch(/No card/);
  });

  it("say what the paid plans add, and that none of them changes a grade", () => {
    expect(FAQ.some((entry) => /Plus and Premium/.test(entry.question))).toBe(true);
    expect(FAQ.some((entry) => /assessed/.test(entry.question))).toBe(true);
  });
});

describe("the pricing page's graph", () => {
  const catalogue = offerCatalogue({ status: "ready", prices: ALL_PRICES });
  const pricing = (list = catalogue) => pricingStructuredData(ORIGIN, list)["@graph"] as Node[];
  const app = (list = catalogue) => pricing(list).find((entry) => entry["@type"] === "WebApplication")!;
  type Offer = {
    "@type": string;
    name: string;
    price: string;
    priceCurrency: string;
    url: string;
    priceSpecification: { valueAddedTaxIncluded: boolean; price: string };
  };
  const offers = (list = catalogue) => app(list).offers as Offer[];

  it("describes the same application as the landing page, by the same id", () => {
    expect(app()["@id"]).toBe(node("WebApplication")["@id"]);
  });

  it("offers Free and every priced plan and pass", () => {
    expect(offers().map((offer) => offer.name)).toEqual([
      "Free",
      "Plus, monthly",
      "Plus, yearly",
      "Premium, monthly",
      "Premium, yearly",
      "Plus pass",
      "Premium pass",
    ]);
  });

  it("states each price as Stripe's cents turned into a decimal, VAT included", () => {
    const plus = offers().find((offer) => offer.name === "Plus, monthly")!;
    expect(plus).toMatchObject({ "@type": "Offer", price: "9.99", priceCurrency: "EUR" });
    expect(plus.priceSpecification).toMatchObject({ price: "9.99", valueAddedTaxIncluded: true });
    expect(offers().find((offer) => offer.name === "Free")).toMatchObject({ price: "0", priceCurrency: "EUR" });
  });

  it("says what each price buys: a month, a year, or a pass's days", () => {
    const duration = (name: string) =>
      (offers().find((offer) => offer.name === name) as unknown as { eligibleDuration: unknown }).eligibleDuration;
    expect(duration("Plus, monthly")).toMatchObject({ value: 1, unitCode: "MON" });
    expect(duration("Premium, yearly")).toMatchObject({ value: 1, unitCode: "ANN" });
    expect(duration("Plus pass")).toMatchObject({ value: 180, unitCode: "DAY" });
  });

  it("points every offer at the pricing page, never at the order page behind sign-in", () => {
    for (const offer of offers()) {
      expect(offer.url).toBe(`${ORIGIN}/pricing`);
    }
    const text = JSON.stringify(pricingStructuredData(ORIGIN, catalogue));
    for (const path of PRIVATE_PATHS) {
      expect(text).not.toContain(`${ORIGIN}${path}`);
    }
  });

  it("invents nothing when there are no prices: Free alone", () => {
    const empty = offerCatalogue({ status: "unavailable" });
    expect(offers(empty).map((offer) => offer.name)).toEqual(["Free"]);
  });

  it("asks the pricing questions the pricing page answers", () => {
    const faq = pricing().find((entry) => entry["@type"] === "FAQPage")!;
    const names = (faq.mainEntity as Array<{ name: string }>).map((entry) => entry.name);
    expect(names).toEqual(PRICING_FAQ.map((entry) => entry.question));
    expect(String(faq["@id"])).toBe(`${ORIGIN}/pricing#faq`);
  });
});

describe("serializeJsonLd", () => {
  it("is JSON a reader can parse back", () => {
    const data = landingStructuredData(ORIGIN);
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("never lets a string close the script element", () => {
    const output = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(output).not.toContain("<");
    expect(JSON.parse(output)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});
