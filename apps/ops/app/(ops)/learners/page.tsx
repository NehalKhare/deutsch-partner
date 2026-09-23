import Link from "next/link";

import { CEFR_LEVELS } from "@dp/domain/cefr";
import type { LearnerListRow } from "@dp/db/learner-admin-repository";
import {
  buttonQuiet,
  eyebrow,
  field,
  linkInline,
  pageTitle,
  prose,
  statPill,
  statPillLabel,
  statPillValue,
} from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { findLearnerAction } from "./actions";
import { formatUtc } from "@/components/costs/format";
import { FindLearnerForm } from "@/components/learners/find-learner-form";
import { createLearnerSupport, pseudonymFor } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import {
  INACTIVE_WINDOWS,
  LEARNERS_PATH,
  cursorFor,
  learnerListQuery,
  learnerParams,
  learnersHref,
} from "@/lib/learner-query";

export const metadata = { title: "Learners — Deutsch Partner" };

/**
 * The learners, as support finds them.
 *
 * Listed by the ledger's pseudonym — the same hash the spend pages carry —
 * and never by email. An operator who has an email uses the lookup, which
 * goes to one learner and lists nothing. Each row is where the learner stands
 * on the path and when they were last seen doing anything; opening one is an
 * audited view of their personal data.
 */

export default async function LearnersPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator({ route: "/learners" });

  const params = learnerParams(await searchParams);
  const { learners } = createLearnerSupport();
  const page = await learners.list(learnerListQuery(params));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className={pageTitle}>Learners</h1>
          {page.ok ? (
            <>
              <span className={statPill}>
                <span className={statPillLabel}>Accounts</span>
                <span className={statPillValue}>{page.data.totals.learners}</span>
              </span>
              <span className={statPill}>
                <span className={statPillLabel}>Onboarded</span>
                <span className={statPillValue}>{page.data.totals.onboarded}</span>
              </span>
            </>
          ) : null}
        </div>
        <p className={cn(prose, "max-w-3xl")}>
          Learners are shown by pseudonym, the same one the ledger and budgets use. Opening a
          learner is recorded as an access to their data.
        </p>
      </header>

      {params.deleted === undefined ? null : (
        <p role="status" className="rounded-xl border border-edge px-4 py-3 text-sm text-copy/70">
          Account {params.deleted}… deleted, with every learner table. Its ledger rows remain under the pseudonym.
        </p>
      )}

      <FindLearnerForm action={findLearnerAction} />

      <form method="get" action={LEARNERS_PATH} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-cefr" className="font-display text-xs font-medium text-copy/70">Level</label>
          <select id="f-cefr" name="cefr" defaultValue={params.cefr ?? ""} className={field}>
            <option value="">Any</option>
            {CEFR_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-onboarded" className="font-display text-xs font-medium text-copy/70">Onboarding</label>
          <select id="f-onboarded" name="onboarded" defaultValue={params.onboarded ?? ""} className={field}>
            <option value="">Any</option>
            <option value="yes">Finished</option>
            <option value="no">Not finished</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-inactive" className="font-display text-xs font-medium text-copy/70">Inactive for</label>
          <select id="f-inactive" name="inactive" defaultValue={params.inactive === undefined ? "" : String(params.inactive)} className={field}>
            <option value="">Any</option>
            {INACTIVE_WINDOWS.map((days) => (
              <option key={days} value={days}>{days}+ days</option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonQuiet}>Apply</button>
        <Link href={LEARNERS_PATH} className={cn(linkInline, "font-display text-sm")}>Clear</Link>
      </form>

      {!page.ok ? (
        <p role="alert" className="rounded-xl border border-ember/50 bg-ember/10 px-4 py-3 text-sm text-ember">
          The learners could not be read.
        </p>
      ) : (
        <>
          <LearnerTable rows={page.data.rows} />
          <nav aria-label="Pages" className="flex gap-2">
            {params.before === undefined ? null : (
              <Link href={learnersHref({ ...params, before: undefined })} className={buttonQuiet}>Newest</Link>
            )}
            {page.data.next === null ? null : (
              <Link href={learnersHref({ ...params, before: cursorFor(page.data.next) })} className={buttonQuiet}>
                Older
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}

function LearnerTable({ rows }: { readonly rows: readonly LearnerListRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-240 text-left font-display text-sm">
        <thead className={eyebrow}>
          <tr>
            <th scope="col" className="py-1">Learner</th>
            <th scope="col">Level</th>
            <th scope="col" className="text-right">Mini-level</th>
            <th scope="col" className="text-right">Open errors</th>
            <th scope="col" className="pl-4">Last active</th>
            <th scope="col">Joined</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-edge/50">
              <td colSpan={6} className="py-3 font-body text-copy/45">No learners match.</td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-edge/50 text-copy/80">
              <td className="py-1.5">
                <Link href={`${LEARNERS_PATH}/${row.id}`} className={cn(linkInline, "font-mono text-xs")}>
                  {pseudonymFor(row.id)}
                </Link>
                {row.onboardedAt === null ? (
                  <span className="block text-xs text-copy/40">not onboarded</span>
                ) : null}
              </td>
              <td>
                {row.effectiveCefr === null ? "—" : `${row.effectiveCefr}${row.effectivePlus ? "+" : ""}`}
                {row.selectedLevel !== row.effectiveCefr ? (
                  <span className="block text-xs text-copy/40">chose {row.selectedLevel}</span>
                ) : null}
              </td>
              <td className="text-right tabular-nums">
                {row.miniLevel ?? "—"}
                {row.furthestMiniLevel !== null && row.furthestMiniLevel !== row.miniLevel ? (
                  <span className="block text-xs text-copy/40">furthest {row.furthestMiniLevel}</span>
                ) : null}
              </td>
              <td className="text-right tabular-nums">{row.openErrors}</td>
              <td className="pl-4 whitespace-nowrap text-copy/60">
                {row.lastActiveAt === null ? "never" : formatUtc(row.lastActiveAt)}
              </td>
              <td className="whitespace-nowrap text-copy/60">{formatUtc(row.createdAt).slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
