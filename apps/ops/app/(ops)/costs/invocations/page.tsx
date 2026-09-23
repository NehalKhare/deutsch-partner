import Link from "next/link";

import { TIERS } from "@dp/domain/tasks";
import { INVOCATION_STATUSES, type Invocation } from "@dp/db/ledger-repository";
import { buttonQuiet, control, eyebrow, field, linkInline, pageTitle, prose } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { formatTokens, formatUtc } from "@/components/costs/format";
import { createCostAdmin } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import {
  LEDGER_PATH,
  LEDGER_WINDOWS,
  ledgerFilterFor,
  ledgerHref,
  ledgerQueryFromParams,
  type LedgerQuery,
} from "@/lib/ledger-query";

export const metadata = { title: "Ledger — Deutsch Partner" };

/**
 * The usage ledger, one row per model call.
 *
 * For explaining an aggregate: which calls a task failed on, what one learner
 * was denied, where the truncations are. Read-only — the table is append-only
 * — and bounded to a month, because a longer question belongs to the daily
 * rollup. Filters are the URL, so a view is a link.
 *
 * Learners are the ledger's pseudonym; there is no content here to show
 * (cost-dashboard-spec.md S2).
 */

export default async function LedgerPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator({ route: "/costs/invocations" });

  const query = ledgerQueryFromParams(await searchParams);
  const { ledger } = createCostAdmin();
  const page = await ledger.list(ledgerFilterFor(query, new Date()));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-2">
        <h1 className={pageTitle}>Ledger</h1>
        <p className={cn(prose, "max-w-3xl")}>
          Every model call, newest first: what was asked for, what ran, what it cost and how it
          ended. Euro is as charged on the day; a call written before any rate existed shows its
          dollars only.
        </p>
      </header>

      <FilterForm query={query} />

      {!page.ok ? (
        <p role="alert" className="rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">
          The ledger could not be read.
        </p>
      ) : (
        <>
          <CallTable rows={page.data.rows} />
          <nav aria-label="Pages" className="flex gap-2">
            {query.before === undefined ? null : (
              <Link href={ledgerHref({ ...query, before: undefined })} className={buttonQuiet}>
                Newest
              </Link>
            )}
            {page.data.nextBefore === null ? null : (
              <Link href={ledgerHref({ ...query, before: page.data.nextBefore })} className={buttonQuiet}>
                Older
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}

const labelClass = "font-display text-xs font-medium text-copy/70";

function FilterForm({ query }: { readonly query: LedgerQuery }) {
  const flags = [
    ["truncated", "Truncated"],
    ["degraded", "Degraded"],
    ["escalated", "Escalated"],
    ["stale", "Stale or no rate"],
  ] as const;

  return (
    <form method="get" action={LEDGER_PATH} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-days" className={labelClass}>Window</label>
          <select id="f-days" name="days" defaultValue={String(query.days)} className={field}>
            {LEDGER_WINDOWS.map((days) => (
              <option key={days} value={days}>
                Last {days === 1 ? "24 hours" : `${days} days`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-status" className={labelClass}>Status</label>
          <select id="f-status" name="status" defaultValue={query.status ?? ""} className={field}>
            <option value="">Any</option>
            {INVOCATION_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-tier" className={labelClass}>Tier</label>
          <select id="f-tier" name="tier" defaultValue={query.tier ?? ""} className={field}>
            <option value="">Any</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>{tier}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-task" className={labelClass}>Task</label>
          <input id="f-task" name="task" defaultValue={query.task ?? ""} placeholder="conversation.turn" className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-model" className={labelClass}>Model that ran</label>
          <input id="f-model" name="model" defaultValue={query.model ?? ""} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-user" className={labelClass}>Learner pseudonym</label>
          <input
            id="f-user"
            name="user"
            defaultValue={query.user ?? ""}
            pattern="[0-9a-f]{32}"
            spellCheck={false}
            className={cn(field, "font-mono text-sm")}
          />
        </div>
        <div className="flex flex-col gap-1 lg:col-span-2">
          <label htmlFor="f-request" className={labelClass}>Request id</label>
          <input
            id="f-request"
            name="request"
            defaultValue={query.request ?? ""}
            spellCheck={false}
            className={cn(field, "font-mono text-sm")}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {flags.map(([name, label]) => (
          <label key={name} className="flex items-center gap-2 font-display text-sm text-copy/70">
            <input type="checkbox" name={name} value="1" defaultChecked={query[name] === true} className={control} />
            {label}
          </label>
        ))}
        <button type="submit" className={buttonQuiet}>Apply</button>
        <Link href={LEDGER_PATH} className={cn(linkInline, "font-display text-sm")}>Clear</Link>
      </div>
    </form>
  );
}

function flagsOf(row: Invocation): string[] {
  return [
    row.truncated ? "truncated" : null,
    row.degraded ? "degraded" : null,
    row.escalated ? "escalated" : null,
    row.fxRateEurPerUsd === null ? "no rate" : row.fxStale ? "stale rate" : null,
    row.attemptNumber > 1 ? `attempt ${row.attemptNumber}` : null,
  ].filter((flag): flag is string => flag !== null);
}

function CallTable({ rows }: { readonly rows: readonly Invocation[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-240 text-left font-display text-sm">
        <thead className={eyebrow}>
          <tr>
            <th scope="col" className="py-1">When</th>
            <th scope="col">Task</th>
            <th scope="col">Model that ran</th>
            <th scope="col">Status</th>
            <th scope="col" className="text-right">In / out</th>
            <th scope="col" className="text-right">Latency</th>
            <th scope="col" className="text-right">EUR</th>
            <th scope="col" className="pl-4">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-edge/50">
              <td colSpan={8} className="py-3 font-body text-copy/45">
                No calls match.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-edge/50 text-copy/80">
              <td className="py-1.5 whitespace-nowrap">
                <Link href={`${LEDGER_PATH}/${row.id}`} className={linkInline}>
                  {formatUtc(row.createdAt)}
                </Link>
              </td>
              <td className="whitespace-nowrap">
                {row.task}
                <span className="block text-xs text-copy/40">{row.tier}</span>
              </td>
              <td className="whitespace-nowrap">{row.modelIdResolved}</td>
              <td className={cn("whitespace-nowrap", row.status === "ok" ? "text-copy/60" : "text-ember")}>
                {row.status}
                {row.errorCode === null ? null : <span className="block text-xs">{row.errorCode}</span>}
              </td>
              <td className="text-right tabular-nums whitespace-nowrap">
                {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
              </td>
              <td className="text-right tabular-nums">{row.latencyMs === null ? "—" : `${row.latencyMs} ms`}</td>
              <td className="text-right tabular-nums">
                {row.fxRateEurPerUsd === null ? (
                  <span className="text-copy/45">${row.costUsd.toFixed(4)}</span>
                ) : (
                  // Four places on a per-call figure: rounding to cents makes
                  // high-volume nano traffic look free (cost-dashboard-spec.md S7).
                  `€${row.costEur.toFixed(4)}`
                )}
              </td>
              <td className="pl-4 text-xs text-copy/55">{flagsOf(row).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 0 ? (
        <p className="mt-2 text-xs text-copy/45">
          {rows.length} call{rows.length === 1 ? "" : "s"} on this page. Totals are on the spend page,
          which reads them from the database rather than adding up a page.
        </p>
      ) : null}
    </div>
  );
}
