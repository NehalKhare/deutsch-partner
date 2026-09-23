import type { FxSnapshot, ModelPrice } from "@dp/db/pricing-repository";
import { buttonQuiet, card, eyebrow, field, pageTitle, prose, sectionTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { refreshFxRateAction } from "../actions";
import { rebuildCostRollupAction, refreshPricingAction } from "./actions";
import { formatPerMillion, formatUtc } from "@/components/costs/format";
import { createCostAdmin } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import { priceChange, rateChange, snapshotAgeDays } from "@/lib/pricing";

export const metadata = { title: "Pricing — Deutsch Partner" };

/**
 * The figures every euro on the spend page was derived from.
 *
 * Two snapshots, both taken by the worker: the provider's price list, daily,
 * which the gateway uses to estimate a call before making it; and the euro
 * rate, which converts what a call actually cost. Neither is typed in here —
 * a price written down by hand is one nobody remembers to refresh — so the
 * page's job is to show whether the jobs are still running and when a figure
 * moved, which is what explains a step in spend that no traffic change does.
 */

/** The price list is fetched daily at 04:13 UTC; two days without one is a stopped job. */
const PRICING_STALE_AFTER_DAYS = 2;

/** The rate source publishes on business days, so a long weekend is still normal. */
const FX_STALE_AFTER_DAYS = 4;

export default async function PricingPage() {
  await requireOperator({ route: "/costs/pricing" });

  const now = new Date();
  const { pricing } = createCostAdmin();
  const overview = await pricing.overview();

  if (!overview.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10 md:px-10">
        <h1 className={pageTitle}>Pricing</h1>
        <p role="alert" className={cn(prose, "mt-4")}>
          The price list and exchange rates could not be read.
        </p>
      </main>
    );
  }

  const { models, fx, lastFetchedAt } = overview.data;
  const pricingAge = lastFetchedAt === null ? null : snapshotAgeDays(lastFetchedAt, now);
  const newestRate = fx[0];
  const fxAge =
    newestRate === undefined ? null : snapshotAgeDays(new Date(`${newestRate.rateDate}T00:00:00Z`), now);

  const warnings = [
    lastFetchedAt === null
      ? "No price list has ever been fetched. Pre-flight estimates have nothing to go on."
      : pricingAge !== null && pricingAge > PRICING_STALE_AFTER_DAYS
        ? `The newest price list is ${Math.floor(pricingAge)} days old; the daily snapshot job has stopped.`
        : null,
    newestRate === undefined
      ? "No euro rate has ever been fetched. Every call is being written with a euro cost of zero."
      : fxAge !== null && fxAge > FX_STALE_AFTER_DAYS
        ? `The newest euro rate is from ${newestRate.rateDate}; the rate job has stopped.`
        : null,
  ].filter((warning): warning is string => warning !== null);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <h1 className={pageTitle}>Pricing</h1>
        <p className={cn(prose, "max-w-3xl")}>
          The provider&rsquo;s price list estimates a call before it is made; what the call cost
          is what the provider reported, and is never restated from these. The euro rate converts
          that cost on the day it was written.
        </p>
        <p className="font-display text-sm text-copy/45">
          {lastFetchedAt === null ? "Price list never fetched" : `Price list fetched ${formatUtc(lastFetchedAt)}`}
          {newestRate === undefined
            ? " · no euro rate"
            : ` · EUR ${newestRate.rate} per USD, ${newestRate.rateDate} (${newestRate.source})`}
        </p>
        <div className="flex flex-wrap gap-2">
          <form action={refreshPricingAction}>
            <button type="submit" className={buttonQuiet}>
              Refresh prices
            </button>
          </form>
          <form action={refreshFxRateAction}>
            <button type="submit" className={buttonQuiet}>
              Refresh rate
            </button>
          </form>
        </div>
        <p className="text-xs text-copy/45">
          Both ask the worker, which fetches and writes; the page updates once it has.
        </p>
      </header>

      {warnings.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-2">
          {warnings.map((warning) => (
            <li
              key={warning}
              className="rounded-xl border border-ember/50 bg-ember/10 px-4 py-2.5 text-sm text-ember"
            >
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <ModelTable models={models} />

      <FxTable fx={fx} />

      <section aria-labelledby="rollup-heading" className={cn(card, "flex flex-col gap-3")}>
        <h2 id="rollup-heading" className={sectionTitle}>
          Rebuild the daily rollup
        </h2>
        <p className="text-sm text-copy/55">
          The spend calendar reads a daily rollup the worker rebuilds every hour, redoing only its
          newest day and the one before. Rebuild further back after an outage, or when an older
          day gained rows late.
          Rebuilding a day twice is harmless.
        </p>
        <form action={rebuildCostRollupAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="since-days" className="font-display text-xs font-medium text-copy/70">
              Days back, ending today
            </label>
            <input
              id="since-days"
              name="sinceDays"
              type="number"
              min={1}
              max={3650}
              step={1}
              defaultValue={7}
              required
              className={cn(field, "w-32 tabular-nums")}
            />
          </div>
          <button type="submit" className={buttonQuiet}>
            Rebuild
          </button>
        </form>
      </section>
    </main>
  );
}

function ModelTable({ models }: { readonly models: readonly ModelPrice[] }) {
  return (
    <section aria-labelledby="models-heading" className="flex flex-col gap-2 overflow-x-auto">
      <h2 id="models-heading" className={sectionTitle}>
        Price per model
      </h2>
      <p className="text-sm text-copy/55">USD per million tokens, as of each model&rsquo;s newest snapshot.</p>
      <table className="w-full min-w-176 text-left font-display text-sm">
        <thead className={eyebrow}>
          <tr>
            <th scope="col" className="py-1">Model</th>
            <th scope="col" className="text-right">Input</th>
            <th scope="col" className="text-right">Output</th>
            <th scope="col" className="pl-4">Last change</th>
            <th scope="col">Fetched</th>
            <th scope="col" className="text-right">Snapshots</th>
          </tr>
        </thead>
        <tbody>
          {models.length === 0 ? (
            <tr className="border-t border-edge/50">
              <td colSpan={6} className="py-3 font-body text-copy/45">
                No prices recorded.
              </td>
            </tr>
          ) : null}
          {models.map((model) => {
            const change = priceChange(model);
            return (
              <tr key={`${model.provider}:${model.modelId}`} className="border-t border-edge/50 text-copy/80">
                <td className="py-1.5">
                  <span className="whitespace-nowrap">{model.modelId}</span>
                  <span className="block text-xs text-copy/40">{model.provider}</span>
                </td>
                <td className="text-right tabular-nums">{formatPerMillion(model.inputUsdPerToken)}</td>
                <td className="text-right tabular-nums">{formatPerMillion(model.outputUsdPerToken)}</td>
                <td className="pl-4 tabular-nums">
                  {change === null ? (
                    <span className="text-copy/40">never</span>
                  ) : (
                    <span className={change.up ? "text-ember" : "text-copy/70"}>
                      {change.summary}
                      <span className="block text-xs text-copy/40">since {formatUtc(change.since)}</span>
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap text-copy/55">{formatUtc(model.fetchedAt)}</td>
                <td className="text-right tabular-nums text-copy/55">{model.snapshots}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function FxTable({ fx }: { readonly fx: readonly FxSnapshot[] }) {
  return (
    <section aria-labelledby="fx-heading" className="flex flex-col gap-2 overflow-x-auto">
      <h2 id="fx-heading" className={sectionTitle}>
        Euro rate
      </h2>
      <p className="text-sm text-copy/55">EUR per USD, newest first. A day with no row carried the previous rate forward.</p>
      <table className="w-full min-w-lg text-left font-display text-sm">
        <thead className={eyebrow}>
          <tr>
            <th scope="col" className="py-1">Date</th>
            <th scope="col" className="text-right">Rate</th>
            <th scope="col" className="text-right">Change</th>
            <th scope="col" className="pl-4">Source</th>
            <th scope="col">Fetched</th>
          </tr>
        </thead>
        <tbody>
          {fx.length === 0 ? (
            <tr className="border-t border-edge/50">
              <td colSpan={5} className="py-3 font-body text-copy/45">
                No rates recorded.
              </td>
            </tr>
          ) : null}
          {fx.map((row, index) => (
            <tr key={row.rateDate} className="border-t border-edge/50 text-copy/80">
              <td className="py-1.5 tabular-nums">{row.rateDate}</td>
              <td className="text-right tabular-nums">{row.rate.toFixed(4)}</td>
              <td className="text-right tabular-nums text-copy/55">{rateChange(row, fx[index + 1])}</td>
              <td className="pl-4 text-copy/55">{row.source}</td>
              <td className="whitespace-nowrap text-copy/55">{formatUtc(row.fetchedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
