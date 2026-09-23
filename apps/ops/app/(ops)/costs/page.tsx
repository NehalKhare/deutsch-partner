
import { refreshFxRateAction } from "./actions";
import {
  eyebrow,
  pageTitle,
  prose,
  sectionTitle,
  stat,
} from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import { requireOperator } from "@/lib/auth/require-operator";
import {
  conversionRate,
  createCostRepository,
  inEur,
  pricedInEur,
  spendAlerts,
  spendPerLearner,
  spendPerLearnerUsd,
  worstAlert,
} from "@/lib/costs";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "AI spend — Deutsch Partner" };

/** Configured per deployment; the gateway gates on the same number. */
const GLOBAL_DAILY_LIMIT_EUR = 50;

/**
 * The operator's AI spend.
 *
 * Reported in euro, with the dollars the provider actually charged beside it.
 * Both, because the euro figure is derived: it is converted at write time
 * against the rate snapshotted that day, and a row written when no rate had
 * ever been snapshotted stores an exact dollar cost and a euro cost of zero.
 * For as long as this page showed euro alone it reported a working product as
 * free.
 *
 * Two gates, and both are server-side. The route checks an explicit operator
 * allowlist and 404s otherwise — not 403, because confirming the page exists
 * tells somebody there is one worth finding. The database function itself is
 * granted to nobody but the secret key, so a learner who somehow reached this
 * code would be refused again by Postgres.
 *
 * Nothing on this page is a learner. The ledger holds a pseudonymous hash and
 * no content, which is why an aggregate over it is safe to render at all.
 */
export default async function CostDashboardPage() {
  await requireOperator({ route: "/costs" });

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;

  // The euro rate the ledger prices in is snapshotted by the worker once a
  // day; the button in the header asks it to ask again. This page reads.
  const summary = await createCostRepository(client).summary(from, to);

  if (!summary.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-12 md:px-10">
        <h1 className={pageTitle}>AI spend</h1>
        <p className={cn(prose, "mt-4")}>The ledger could not be read.</p>
      </main>
    );
  }

  const data = summary.data;
  const alerts = spendAlerts(data, { globalDailyEur: GLOBAL_DAILY_LIMIT_EUR });

  const rate = data.fxRate[0];
  const euro = pricedInEur(data);
  const converting = conversionRate(data);

  const money = (value: number) => value.toFixed(4);
  const tiles: ReadonlyArray<{
    readonly label: string;
    readonly value: string | number;
    readonly secondary?: string;
  }> = [
    {
      label: "Spend",
      value: `€${money(euro.total)}`,
      secondary: `$${money(data.totals.cost_usd)}`,
    },
    { label: "Calls", value: data.totals.call_count },
    { label: "Learners", value: data.totals.learner_count },
    {
      // The figure that decides whether this product can ship, so it is the
      // last one that should be allowed to read zero while the ledger disagrees.
      label: "Per learner",
      value: `€${money(spendPerLearner(data))}`,
      secondary: `$${money(spendPerLearnerUsd(data))}`,
    },
    { label: "Failures", value: data.totals.failures },
    { label: "Denied", value: data.totals.budget_denials },
    { label: "Truncated", value: data.totals.truncations },
    { label: "Degraded", value: data.totals.degraded },
  ];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
      <header className="flex flex-col gap-2">
        <h1 className={pageTitle}>AI spend</h1>
        <p className="font-display text-sm text-chalk/50">
          Last 24 hours · status {worstAlert(alerts)}
          {rate
            ? ` · EUR ${rate.rate} per USD, ${rate.rateDate} (${rate.source})`
            : " · no exchange rate recorded, so every euro figure below is zero"}
        </p>

        {/* Said once, here, rather than as a banner: it is a caveat about how
            one figure was arrived at, not something wrong with the day. */}
        {euro.estimatedCalls > 0 ? (
          <p className="font-display text-sm text-chalk/40">
            €{money(euro.estimated)} of that is {euro.estimatedCalls} call
            {euro.estimatedCalls === 1 ? "" : "s"} converted at this rate — they
            were written before any rate existed and carry none of their own.
            The other €{money(euro.charged)} is what was charged.
          </p>
        ) : null}

        <form action={refreshFxRateAction}>
          <button
            type="submit"
            className="rounded-lg border border-haze/60 px-3 py-1 font-display text-xs uppercase tracking-wide text-chalk/60 transition-colors hover:border-chalk/40 hover:text-chalk"
          >
            {/* The source is read once a day on its own. This is the rest of
                the day — it publishes in the afternoon. */}
            Refresh rate
          </button>
        </form>
      </header>

      {alerts.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <li
              key={alert.scope}
              className={[
                "rounded-xl border px-4 py-2.5 text-sm",
                // Warn is the colour of the product; anything past it is not.
                alert.level === "warn"
                  ? "border-apricot/50 bg-apricot/10 text-apricot"
                  : "border-ember/50 bg-ember/10 text-ember",
              ].join(" ")}
            >
              <strong className="font-display uppercase tracking-wide">
                {alert.level}
              </strong>{" "}
              {alert.scope}: {alert.detail}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className={stat}>
            <dt className={eyebrow}>{tile.label}</dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
              {tile.value}
              {/* Euro leads and dollars sit under it, quietly: the same money
                  twice, one figure of which can be missing. */}
              {tile.secondary === undefined ? null : (
                <span className="block text-sm font-normal text-chalk/45">
                  {tile.secondary}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="task-heading" className="flex flex-col gap-2 overflow-x-auto">
        <h2 id="task-heading" className={sectionTitle}>
          By task
        </h2>
        <table className="w-full text-left font-display text-sm">
          <thead className={eyebrow}>
            <tr>
              <th scope="col" className="py-1">Task</th>
              <th scope="col">Tier</th>
              <th scope="col" className="text-right">Calls</th>
              <th scope="col" className="text-right">Tokens in</th>
              <th scope="col" className="text-right">Tokens out</th>
              <th scope="col" className="text-right">EUR</th>
              <th scope="col" className="text-right">USD</th>
            </tr>
          </thead>
          <tbody>
            {data.byTask.length === 0 ? (
              <tr className="border-t border-haze/50">
                <td colSpan={7} className="py-3 font-body text-chalk/45">
                  No calls in this window.
                </td>
              </tr>
            ) : null}
            {data.byTask.map((row) => (
              <tr
                key={`${row.task}:${row.tier}`}
                className="border-t border-haze/50 text-chalk/80"
              >
                <td className="py-1">{row.task}</td>
                <td>{row.tier}</td>
                <td className="text-right tabular-nums">{row.calls}</td>
                <td className="text-right tabular-nums">{row.inputTokens}</td>
                <td className="text-right tabular-nums">{row.outputTokens}</td>
                <td className="text-right tabular-nums">
                  {inEur(row.costEur, row.costUsdUnpriced, converting).toFixed(6)}
                </td>
                <td className="text-right tabular-nums">{row.costUsd.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="model-heading" className="flex flex-col gap-2 overflow-x-auto">
        <h2 id="model-heading" className={sectionTitle}>
          By model actually routed to
        </h2>
        <table className="w-full text-left font-display text-sm">
          <thead className={eyebrow}>
            <tr>
              <th scope="col" className="py-1">Model</th>
              <th scope="col" className="text-right">Calls</th>
              <th scope="col" className="text-right">EUR</th>
              <th scope="col" className="text-right">USD</th>
            </tr>
          </thead>
          <tbody>
            {data.byModel.length === 0 ? (
              <tr className="border-t border-haze/50">
                <td colSpan={4} className="py-3 font-body text-chalk/45">
                  No calls in this window.
                </td>
              </tr>
            ) : null}
            {data.byModel.map((row) => (
              <tr key={row.modelId} className="border-t border-haze/50 text-chalk/80">
                <td className="py-1">{row.modelId}</td>
                <td className="text-right tabular-nums">{row.calls}</td>
                <td className="text-right tabular-nums">
                  {inEur(row.costEur, row.costUsdUnpriced, converting).toFixed(6)}
                </td>
                <td className="text-right tabular-nums">{row.costUsd.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
