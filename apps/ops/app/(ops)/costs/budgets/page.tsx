import Link from "next/link";

import type { EnforcedBudgetScope } from "@dp/domain/budgets";
import type { BudgetLimit, LearnerSpend } from "@dp/db/budget-repository";
import { buttonQuiet, card, eyebrow, linkInline, pageTitle, prose, sectionTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { removeBudgetOverrideAction, saveBudgetLimitAction } from "./actions";
import { BudgetLimitForm } from "@/components/costs/budget-limit-form";
import { BudgetMeter } from "@/components/costs/budget-meter";
import { formatEur, formatUtc } from "@/components/costs/format";
import { createCostAdmin } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import { SCOPE_LABELS, budgetBoard, globalDailyLimit, globalMeter, learnerMeter } from "@/lib/budgets";
import { ledgerHref } from "@/lib/ledger-query";

export const metadata = { title: "Budgets — Deutsch Partner" };

/**
 * The euro limits the gateway enforces, and where spend stands against them.
 *
 * This is the control, not a report on it: the gateway reads these rows
 * through `budget_snapshot` before every model call, so a save here moves who
 * is served, degraded or refused from the next call on. The page therefore
 * leads with what is unlimited, because an empty table is a deployment with no
 * ceiling and the gate allows that by design.
 *
 * Learners appear as the ledger's pseudonym and nothing else
 * (cost-dashboard-spec.md S2). The hash is what an override is keyed by, and
 * a link into the ledger is how an operator finds out what that learner did.
 */

const asInput = (value: number) => String(Number(value.toFixed(4)));
const asPercent = (fraction: number) => String(Math.round(fraction * 100));

export default async function BudgetsPage() {
  await requireOperator({ route: "/costs/budgets" });

  const { budgets } = createCostAdmin();
  const overview = await budgets.overview(new Date());

  if (!overview.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10 md:px-10">
        <h1 className={pageTitle}>Budgets</h1>
        <p role="alert" className={cn(prose, "mt-4")}>
          The budget limits could not be read, so this page cannot say what the gateway is
          enforcing. Nothing has been changed.
        </p>
      </main>
    );
  }

  const data = overview.data;
  const board = budgetBoard(data);
  const today = globalMeter(data);
  const globalLimit = globalDailyLimit(data);
  const learnersFor = (scope: EnforcedBudgetScope) => data.learners.filter((row) => row.scope === scope);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-2">
        <h1 className={pageTitle}>Budgets</h1>
        <p className={cn(prose, "max-w-3xl")}>
          The gateway checks these before every model call. Daily counters reset at 00:00 UTC and
          monthly ones on the 1st. Past the warn threshold a warning is logged; past degrade,
          optional calls are dropped and replies use a cheaper tier; at 100% the call is refused.
        </p>
        <p className="font-display text-sm text-copy/45">As of {formatUtc(data.generatedAt)}</p>
      </header>

      {board.unlimited.length > 0 ? (
        <p role="alert" className="rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">
          <strong className="font-display font-semibold">No limit is set for{" "}
            {board.unlimited.map((scope) => SCOPE_LABELS[scope].toLowerCase()).join(", ")}.</strong>{" "}
          The gateway allows unlimited spend there until a default is saved below.
        </p>
      ) : null}

      <section aria-labelledby="today-heading" className={cn(card, "flex flex-col gap-3")}>
        <h2 id="today-heading" className={sectionTitle}>
          Today, whole product
        </h2>
        <BudgetMeter
          label="Whole product, per day"
          meter={today}
          warnPct={globalLimit?.warnPct}
          degradePct={globalLimit?.degradePct}
        />
      </section>

      <section aria-labelledby="defaults-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="defaults-heading" className={sectionTitle}>
            Defaults
          </h2>
          <p className="text-sm text-copy/55">
            A default can be lowered, even to zero, but not switched off: no default is no limit.
            The per-turn cap is not here — it is set in code at each call site.
          </p>
        </div>

        <ul className="grid gap-4 lg:grid-cols-3">
          {board.scopes.map(({ scope, limit }) => (
            <li key={scope} className={cn(card, "flex flex-col gap-4")}>
              <div className="flex flex-col gap-1">
                <h3 className="font-display font-semibold text-copy">{SCOPE_LABELS[scope]}</h3>
                <p className="text-xs text-copy/50">
                  {limit === null
                    ? "Not set."
                    : `${formatEur(limit.limitEur)} · warn ${asPercent(limit.warnPct)}% · degrade ${asPercent(limit.degradePct)}% · updated ${formatUtc(limit.updatedAt)}`}
                  {scope === "per_user_daily"
                    ? ` ${data.learnerCounts.daily} learner${data.learnerCounts.daily === 1 ? "" : "s"} spent today.`
                    : scope === "per_user_monthly"
                      ? ` ${data.learnerCounts.monthly} learner${data.learnerCounts.monthly === 1 ? "" : "s"} spent this month.`
                      : ""}
                </p>
              </div>
              <BudgetLimitForm
                action={saveBudgetLimitAction}
                mode="default"
                scope={scope}
                limitEur={limit === null ? "" : asInput(limit.limitEur)}
                warnPct={limit === null ? undefined : asPercent(limit.warnPct)}
                degradePct={limit === null ? undefined : asPercent(limit.degradePct)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="overrides-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="overrides-heading" className={sectionTitle}>
            Per-learner overrides
          </h2>
          <p className="text-sm text-copy/55">
            An active override replaces the default for one learner, higher or lower. Paused or
            removed, the default applies to them again.
          </p>
        </div>

        {board.overrides.length === 0 ? (
          <p className="text-sm text-copy/45">No overrides.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {board.overrides.map((row) => (
              <OverrideRow key={row.id} row={row} />
            ))}
          </ul>
        )}

        <div className={cn(card, "flex flex-col gap-3")}>
          <h3 className="font-display font-semibold text-copy">Add an override</h3>
          <BudgetLimitForm action={saveBudgetLimitAction} mode="new-override" />
        </div>
      </section>

      {(["per_user_daily", "per_user_monthly"] as const).map((scope) => (
        <LearnerTable
          key={scope}
          scope={scope}
          rows={learnersFor(scope)}
          total={scope === "per_user_daily" ? data.learnerCounts.daily : data.learnerCounts.monthly}
          period={scope === "per_user_daily" ? "today" : "this month"}
        />
      ))}

      {board.unenforced.length > 0 ? (
        <section aria-labelledby="unenforced-heading" className="flex flex-col gap-2">
          <h2 id="unenforced-heading" className={sectionTitle}>
            Not enforced
          </h2>
          <p className="text-sm text-copy/55">
            {board.unenforced.length} per-request row{board.unenforced.length === 1 ? " is" : "s are"} in
            the table ({board.unenforced.map((row) => formatEur(row.limitEur)).join(", ")}). Nothing
            reads them: the per-turn cap is a constant at each call site. Changing them changes nothing.
          </p>
        </section>
      ) : null}
    </main>
  );
}

function OverrideRow({ row }: { readonly row: BudgetLimit }) {
  const scope = row.scope as EnforcedBudgetScope;

  return (
    <li className={cn(card, "flex flex-col gap-3")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={eyebrow}>{SCOPE_LABELS[scope]}</span>
          <Link
            href={ledgerHref({ days: 7, user: row.scopeKey ?? undefined })}
            className={cn(linkInline, "truncate font-mono text-sm")}
          >
            {row.scopeKey}
          </Link>
        </div>
        <form action={removeBudgetOverrideAction}>
          <input type="hidden" name="scope" value={row.scope} />
          <input type="hidden" name="scopeKey" value={row.scopeKey ?? ""} />
          <button type="submit" className={buttonQuiet}>
            Remove
          </button>
        </form>
      </div>
      <BudgetLimitForm
        action={saveBudgetLimitAction}
        mode="override"
        scope={scope}
        scopeKey={row.scopeKey}
        limitEur={asInput(row.limitEur)}
        warnPct={asPercent(row.warnPct)}
        degradePct={asPercent(row.degradePct)}
        active={row.active}
      />
    </li>
  );
}

function LearnerTable({
  scope,
  rows,
  total,
  period,
}: {
  readonly scope: "per_user_daily" | "per_user_monthly";
  readonly rows: readonly LearnerSpend[];
  readonly total: number;
  readonly period: string;
}) {
  const id = `${scope}-heading`;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 overflow-x-auto">
      <div className="flex flex-col gap-1">
        <h2 id={id} className={sectionTitle}>
          Highest spend {period}
        </h2>
        <p className="text-sm text-copy/55">
          {rows.length < total
            ? `The ${rows.length} highest of ${total} learners with spend ${period}.`
            : `${total} learner${total === 1 ? "" : "s"} with spend ${period}.`}{" "}
          Against the limit that applies to each: their override if they have one, otherwise the
          default.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-copy/45">Nobody has spent anything {period}.</p>
      ) : (
        <table className="w-full min-w-160 text-left font-display text-sm">
          <thead className={eyebrow}>
            <tr>
              <th scope="col" className="py-1">Learner</th>
              <th scope="col" className="w-2/5">Against limit</th>
              <th scope="col">Limit from</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userIdHash} className="border-t border-edge/50 align-top text-copy/80">
                <td className="py-2 pr-3">
                  <Link
                    href={ledgerHref({ days: scope === "per_user_daily" ? 1 : 31, user: row.userIdHash })}
                    className={cn(linkInline, "font-mono text-xs")}
                  >
                    {row.userIdHash}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  <BudgetMeter
                    compact
                    label={`Learner ${row.userIdHash.slice(0, 8)}, ${period}`}
                    meter={learnerMeter(row)}
                    warnPct={row.warnPct ?? undefined}
                    degradePct={row.degradePct ?? undefined}
                  />
                </td>
                <td className="py-2 text-copy/55">
                  {row.limitEur === null ? "none" : row.overridden ? "override" : "default"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
