import { z } from "zod";

import { OFFER_KEYS, OFFERS, PASS_DAYS_MAX, offerKeySchema } from "@dp/domain/billing";

/**
 * The shape of packages/billing/catalogue.json (billing-and-plans-spec.md S7).
 *
 * The amounts a new Stripe account's Prices are created with, and nothing
 * more: once a Price exists, Stripe is its source of truth and the pricing
 * page reads the mirror, never this file. Which plan, interval and kind each
 * entry is comes from the domain's offers by lookup key, so the file cannot
 * disagree with them.
 *
 * Integer minor units, VAT inclusive. Further currencies are Stripe currency
 * options on the same Price; the file carries none today, and adding one is
 * an entry here and a bootstrap, not a code change.
 */

const currency = z.string().regex(/^[a-z]{3}$/, "an ISO 4217 code, lower case");
/** Whole cents, and within the price mirror's 32-bit column. */
const amountMinor = z.number().int().positive().max(2_147_483_647);

const product = z.object({
  /** Stripe product ids may be chosen; a fixed one makes the bootstrap idempotent. */
  id: z.string().regex(/^[a-z][a-z0-9_]{2,60}$/),
  name: z.string().min(1).max(250),
});

const cataloguePrice = z.object({
  lookupKey: offerKeySchema,
  amountMinor,
  passDays: z.number().int().min(1).max(PASS_DAYS_MAX).optional(),
  currencyOptions: z.record(currency, amountMinor).optional(),
});

export const catalogueSchema = z
  .object({
    currency,
    // EU consumers are shown what they pay (spec S7).
    taxBehavior: z.literal("inclusive"),
    products: z.object({ plus: product, premium: product }),
    prices: z.array(cataloguePrice),
  })
  .superRefine((catalogue, ctx) => {
    const keys = catalogue.prices.map((price) => price.lookupKey);
    for (const key of OFFER_KEYS) {
      const count = keys.filter((candidate) => candidate === key).length;
      if (count !== 1) ctx.addIssue({ code: "custom", message: `${key} must be priced exactly once`, path: ["prices"] });
    }
    catalogue.prices.forEach((price, index) => {
      if ((OFFERS[price.lookupKey].kind === "pass") !== (price.passDays !== undefined)) {
        ctx.addIssue({ code: "custom", message: "a pass, and only a pass, has a length", path: ["prices", index, "passDays"] });
      }
      if (price.currencyOptions !== undefined && catalogue.currency in price.currencyOptions) {
        ctx.addIssue({
          code: "custom",
          message: "the base currency is the price's own, not an option",
          path: ["prices", index, "currencyOptions"],
        });
      }
    });
  });

export type Catalogue = z.infer<typeof catalogueSchema>;
export type CataloguePrice = Catalogue["prices"][number];

export function parseCatalogue(json: unknown) {
  return catalogueSchema.safeParse(json);
}
