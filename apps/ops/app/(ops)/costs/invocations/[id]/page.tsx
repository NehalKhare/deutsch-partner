import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { Invocation } from "@dp/db/ledger-repository";
import { card, eyebrow, linkInline, pageTitle, prose, sectionTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { formatUtc } from "@/components/costs/format";
import { createCostAdmin } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import { LEDGER_PATH, ledgerHref } from "@/lib/ledger-query";

export const metadata = { title: "Model call — Deutsch Partner" };

/**
 * One model call, and every attempt its request made.
 *
 * A turn that retried, escalated or fell back is several rows sharing a
 * request id; the per-turn cost is their sum, which is why they are shown
 * together (cost-dashboard-spec.md S8). The trace id is printed for finding
 * the generation in the tracing tool; nothing of the generation is here.
 */

export default async function InvocationPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  await requireOperator({ route: "/costs/invocations/[id]" });

  const id = z.coerce.number().int().positive().safeParse((await params).id);
  if (!id.success) notFound();

  const { ledger } = createCostAdmin();
  const found = await ledger.get(id.data);

  if (!found.ok) {
    if (found.error.kind === "not_found") notFound();
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10 md:px-10">
        <h1 className={pageTitle}>Model call</h1>
        <p role="alert" className={cn(prose, "mt-4")}>The ledger could not be read.</p>
      </main>
    );
  }

  const { call, request } = found.data;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-2">
        <Link href={LEDGER_PATH} className={cn(linkInline, "w-fit font-display text-sm")}>
          ← Ledger
        </Link>
        <h1 className={pageTitle}>
          {call.task} <span className="text-copy/40">#{call.id}</span>
        </h1>
        <p className="font-display text-sm text-copy/45">
          {formatUtc(call.createdAt)} · {call.status}
          {call.errorCode === null ? "" : ` (${call.errorCode})`}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Facts
          title="Routing"
          rows={[
            ["Tier", call.tier],
            ["Asked for", call.modelId],
            ["Ran", call.modelIdResolved],
            ["Provider", call.provider],
            ["Prompt", call.promptName === null ? "—" : `${call.promptName} v${call.promptVersion ?? "?"}`],
            ["Attempt", String(call.attemptNumber)],
          ]}
        />
        <Facts
          title="Tokens and time"
          rows={[
            ["Input", String(call.inputTokens)],
            ["Cached input", call.cachedInputTokens === null ? "—" : String(call.cachedInputTokens)],
            ["Output", `${call.outputTokens} of ${call.maxOutputTokens}`],
            ["Reasoning", call.reasoningTokens === null ? "—" : String(call.reasoningTokens)],
            ["Latency", call.latencyMs === null ? "—" : `${call.latencyMs} ms`],
            ["First token", call.firstTokenMs === null ? "—" : `${call.firstTokenMs} ms`],
          ]}
        />
        <Facts
          title="Cost"
          rows={[
            ["USD", `$${call.costUsd.toFixed(8)}`],
            ["EUR", call.fxRateEurPerUsd === null ? "not priced" : `€${call.costEur.toFixed(8)}`],
            ["Rate", call.fxRateEurPerUsd === null ? "none existed" : `${call.fxRateEurPerUsd}${call.fxStale ? " (carried forward)" : ""}`],
            ["Budget hit", call.budgetScopeHit ?? "—"],
            ["Flags", flags(call)],
          ]}
        />
      </div>

      <section aria-labelledby="ids-heading" className={cn(card, "flex flex-col gap-2")}>
        <h2 id="ids-heading" className={sectionTitle}>Identifiers</h2>
        <dl className="grid gap-x-6 gap-y-1 font-display text-sm sm:grid-cols-[auto_1fr]">
          <Id label="Learner" value={call.userIdHash} href={call.userIdHash === null ? undefined : ledgerHref({ days: 7, user: call.userIdHash })} />
          <Id label="Request" value={call.requestId} />
          <Id label="Trace" value={call.traceId} />
          <Id label="Thread" value={call.threadId} />
          <Id label="Message" value={call.messageId} />
        </dl>
      </section>

      <section aria-labelledby="attempts-heading" className="flex flex-col gap-2 overflow-x-auto">
        <h2 id="attempts-heading" className={sectionTitle}>
          This request
        </h2>
        <p className="text-sm text-copy/55">
          {request.length === 1
            ? "One call: no retry, escalation or fallback."
            : `${request.length} calls shared this request id.`}
        </p>
        <table className="w-full min-w-176 text-left font-display text-sm">
          <thead className={eyebrow}>
            <tr>
              <th scope="col" className="py-1">Call</th>
              <th scope="col">Task</th>
              <th scope="col">Ran</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">EUR</th>
              <th scope="col" className="text-right">USD</th>
            </tr>
          </thead>
          <tbody>
            {request.map((row) => (
              <tr
                key={row.id}
                aria-current={row.id === call.id ? "true" : undefined}
                className={cn("border-t border-edge/50", row.id === call.id ? "text-copy" : "text-copy/70")}
              >
                <td className="py-1.5">
                  {row.id === call.id ? (
                    `#${row.id}`
                  ) : (
                    <Link href={`${LEDGER_PATH}/${row.id}`} className={linkInline}>#{row.id}</Link>
                  )}
                </td>
                <td>{row.task}</td>
                <td className="whitespace-nowrap">{row.modelIdResolved}</td>
                <td className={row.status === "ok" ? undefined : "text-ember"}>{row.status}</td>
                <td className="text-right tabular-nums">
                  {row.fxRateEurPerUsd === null ? "—" : `€${row.costEur.toFixed(4)}`}
                </td>
                <td className="text-right tabular-nums">${row.costUsd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function flags(call: Invocation): string {
  const set = [
    call.truncated ? "truncated" : null,
    call.degraded ? "degraded" : null,
    call.escalated ? "escalated" : null,
  ].filter((flag): flag is string => flag !== null);
  return set.length === 0 ? "—" : set.join(", ");
}

function Facts({ title, rows }: { readonly title: string; readonly rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <section className={cn(card, "flex flex-col gap-2")}>
      <h2 className={sectionTitle}>{title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-display text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-copy/50">{label}</dt>
            <dd className="min-w-0 truncate tabular-nums text-copy/85" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Id({ label, value, href }: { readonly label: string; readonly value: string | null; readonly href?: string }) {
  return (
    <>
      <dt className="text-copy/50">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-xs text-copy/80">
        {value === null ? "—" : href === undefined ? value : <Link href={href} className={linkInline}>{value}</Link>}
      </dd>
    </>
  );
}
