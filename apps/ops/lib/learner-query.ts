import { z } from "zod";

import { cefrLevelSchema } from "@dp/domain/cefr";
import type { LearnerListQuery } from "@dp/db/learner-admin-repository";

/**
 * The learner list's URL.
 *
 * Filters are the query string, like the ledger's, so a view is a link and
 * the filter form is a plain GET. A param that does not parse is dropped.
 * The keyset cursor is the last row's creation time and id, joined by `_`.
 */

export const LEARNERS_PATH = "/learners";

export const INACTIVE_WINDOWS = [7, 14, 30] as const;

export interface LearnerListParams {
  readonly cefr?: z.infer<typeof cefrLevelSchema>;
  readonly onboarded?: "yes" | "no";
  readonly inactive?: number;
  readonly before?: string;
  /** The pseudonym prefix of an account just deleted, for the notice. */
  readonly deleted?: string;
}

type Params = Readonly<Record<string, string | readonly string[] | undefined>>;

const first = (value: string | readonly string[] | undefined) =>
  typeof value === "string" ? value : value?.[0];

const PARSERS = {
  cefr: cefrLevelSchema,
  onboarded: z.enum(["yes", "no"]),
  inactive: z.coerce.number().int().min(1).max(365),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[0-9a-f-]{36}$/),
  deleted: z.string().regex(/^[0-9a-f]{8}$/),
} as const;

export function learnerParams(params: Params): LearnerListParams {
  const parsed: Record<string, unknown> = {};
  for (const [key, parser] of Object.entries(PARSERS)) {
    const raw = first(params[key]);
    if (raw === undefined || raw.trim() === "") continue;
    const value = parser.safeParse(raw.trim());
    if (value.success) parsed[key] = value.data;
  }
  return parsed as LearnerListParams;
}

export function learnerListQuery(params: LearnerListParams): LearnerListQuery {
  const [createdAt, id] = params.before?.split("_") ?? [];

  return {
    cefr: params.cefr,
    onboarded: params.onboarded === undefined ? undefined : params.onboarded === "yes",
    inactiveDays: params.inactive,
    before: createdAt !== undefined && id !== undefined ? { createdAt: new Date(createdAt), id } : undefined,
  };
}

export const cursorFor = (row: { readonly createdAt: Date; readonly id: string }) =>
  `${row.createdAt.toISOString()}_${row.id}`;

export function learnersHref(params: LearnerListParams): string {
  const search = new URLSearchParams();
  for (const key of ["cefr", "onboarded", "inactive", "before"] as const) {
    const value = params[key];
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query === "" ? LEARNERS_PATH : `${LEARNERS_PATH}?${query}`;
}
