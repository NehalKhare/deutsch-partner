import { z } from "zod";

import { tierSchema } from "@dp/domain/tasks";
import {
  LEDGER_MAX_WINDOW_DAYS,
  invocationStatusSchema,
  type LedgerFilter,
} from "@dp/db/ledger-repository";

/**
 * The ledger explorer's URL.
 *
 * Filters live in the query string, so a view of the ledger is a link an
 * operator can paste into an incident channel, and the filter form is a plain
 * GET form that works before React has loaded. Each param is parsed on its
 * own and dropped if it does not parse: a hand-edited URL is a filter that
 * does not apply, not a page that fails.
 */

export const LEDGER_PATH = "/costs/invocations";

/** The windows the filter form offers. The repository refuses anything longer. */
export const LEDGER_WINDOWS = [1, 7, LEDGER_MAX_WINDOW_DAYS] as const;

export interface LedgerQuery {
  readonly days: number;
  readonly status?: z.infer<typeof invocationStatusSchema>;
  readonly task?: string;
  readonly tier?: z.infer<typeof tierSchema>;
  readonly model?: string;
  readonly user?: string;
  readonly request?: string;
  readonly truncated?: true;
  readonly degraded?: true;
  readonly escalated?: true;
  readonly stale?: true;
  readonly before?: number;
}

type Params = Readonly<Record<string, string | readonly string[] | undefined>>;

const text = (max: number) => z.string().trim().min(1).max(max);
const on = z.literal("1").transform(() => true as const);

const PARSERS = {
  days: z.coerce.number().int().min(1).max(LEDGER_MAX_WINDOW_DAYS),
  status: invocationStatusSchema,
  task: text(120),
  tier: tierSchema,
  model: text(200),
  user: z.string().regex(/^[0-9a-f]{32}$/),
  request: z.uuid(),
  truncated: on,
  degraded: on,
  escalated: on,
  stale: on,
  before: z.coerce.number().int().positive(),
} as const;

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === "string" ? value : value?.[0];

export function ledgerQueryFromParams(params: Params): LedgerQuery {
  const query: Record<string, unknown> = { days: 1 };

  for (const [key, parser] of Object.entries(PARSERS)) {
    const raw = first(params[key]);
    if (raw === undefined || raw.trim() === "") continue;

    const parsed = parser.safeParse(raw);
    if (parsed.success) query[key] = parsed.data;
  }

  return query as unknown as LedgerQuery;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the repository is asked for: the query's window, ending now. */
export function ledgerFilterFor(query: LedgerQuery, now: Date): LedgerFilter {
  const filter: Record<string, unknown> = {
    from: new Date(now.getTime() - query.days * DAY_MS),
    to: now,
  };
  const map: ReadonlyArray<readonly [keyof LedgerQuery, string]> = [
    ["status", "status"],
    ["task", "task"],
    ["tier", "tier"],
    ["model", "modelIdResolved"],
    ["user", "userIdHash"],
    ["request", "requestId"],
    ["truncated", "truncated"],
    ["degraded", "degraded"],
    ["escalated", "escalated"],
    ["stale", "fxStale"],
    ["before", "before"],
  ];
  for (const [from, to] of map) {
    if (query[from] !== undefined) filter[to] = query[from];
  }

  return filter as unknown as LedgerFilter;
}

/** A link to the ledger with these filters. Defaults are left out. */
export function ledgerHref(query: Partial<LedgerQuery>): string {
  const params = new URLSearchParams();

  for (const key of Object.keys(PARSERS) as Array<keyof LedgerQuery>) {
    const value = query[key];
    if (value === undefined) continue;
    if (key === "days" && value === 1) continue;
    params.set(key, value === true ? "1" : String(value));
  }

  const search = params.toString();
  return search === "" ? LEDGER_PATH : `${LEDGER_PATH}?${search}`;
}
