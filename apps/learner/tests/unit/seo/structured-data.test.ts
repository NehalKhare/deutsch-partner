import { describe, expect, it } from "vitest";

import { FAQ } from "@/lib/landing/faq";
import { ROOMS } from "@/lib/landing/rooms";
import { PRIVATE_PATHS, SITE } from "@/lib/seo/site";
import { landingStructuredData, serializeJsonLd } from "@/lib/seo/structured-data";

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
