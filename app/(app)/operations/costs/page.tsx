import { notFound } from "next/navigation";

import {
  eyebrow,
  pageTitle,
  prose,
  sectionTitle,
  stat,
} from "@/components/ui/styles";
import { cn } from "@/lib/utils";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import {
  spendPerLearner,
  createCostRepository,
  spendAlerts,
  worstAlert,
} from "@/lib/dashboard/costs";
import { createSecretKeySupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

export const metadata = { title: "AI spend — Deutsch Partner" };

/** Configured per deployment; the gateway gates on the same number. */
const GLOBAL_DAILY_LIMIT_EUR = 50;

/**
 * The operator's AI spend, in euro.
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
  const learnerId = await requireAuthenticatedUserId();
  if (!isOperator(learnerId)) notFound();

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const client = createSecretKeySupabaseClient() as unknown as DatabaseClient;
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

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10 md:px-10 md:py-14">
      <header className="flex flex-col gap-2">
        <h1 className={pageTitle}>AI spend</h1>
        <p className="font-display text-sm text-chalk/50">
          Last 24 hours · status {worstAlert(alerts)}
          {rate
            ? ` · EUR ${rate.rate} per USD, ${rate.rateDate} (${rate.source})`
            : " · no exchange rate recorded"}
        </p>
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
        {[
          ["Spend", `€${data.totals.cost_eur.toFixed(4)}`],
          ["Calls", data.totals.call_count],
          ["Learners", data.totals.learner_count],
          ["Per learner", `€${spendPerLearner(data).toFixed(4)}`],
          ["Failures", data.totals.failures],
          ["Denied", data.totals.budget_denials],
          ["Truncated", data.totals.truncations],
          ["Degraded", data.totals.degraded],
        ].map(([label, value]) => (
          <div key={String(label)} className={stat}>
            <dt className={eyebrow}>{label}</dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
              {value}
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
            </tr>
          </thead>
          <tbody>
            {data.byTask.length === 0 ? (
              <tr className="border-t border-haze/50">
                <td colSpan={6} className="py-3 font-body text-chalk/45">
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
                <td className="text-right tabular-nums">{row.costEur.toFixed(6)}</td>
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
            </tr>
          </thead>
          <tbody>
            {data.byModel.length === 0 ? (
              <tr className="border-t border-haze/50">
                <td colSpan={3} className="py-3 font-body text-chalk/45">
                  No calls in this window.
                </td>
              </tr>
            ) : null}
            {data.byModel.map((row) => (
              <tr key={row.modelId} className="border-t border-haze/50 text-chalk/80">
                <td className="py-1">{row.modelId}</td>
                <td className="text-right tabular-nums">{row.calls}</td>
                <td className="text-right tabular-nums">{row.costEur.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
