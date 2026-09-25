import { serializeJsonLd } from "@/lib/seo/structured-data";

/**
 * Structured data in the page.
 *
 * A native script element, not next/script: this is data for a crawler, not
 * code for a browser, and the loader would only delay it. The payload is
 * escaped by serializeJsonLd so nothing inside it can close the element.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Escaped, see serializeJsonLd: `<` can never appear in the output.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
