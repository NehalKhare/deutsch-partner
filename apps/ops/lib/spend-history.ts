import { z } from "zod";

import { fail, ok, repositoryError, type RepositoryResult } from "@dp/db/errors";
import type { DatabaseClient } from "@dp/db/types";

import { dayKey, type DaySpend, type DayModelSpend, type DayTaskSpend } from "./spend-series";

/**
 * The historical series, read from the rollup.
 *
 * `cost_rollup_daily`, never the raw ledger. The spec's S4 rule is explicit
 * about it and the reason is the shape of the two tables: the ledger has a row
 * per model call, so a year of it is millions of rows to answer a question the
 * rollup already answered once, on a schedule, idempotently.
 *
 * The rollup is keyed on (day, task, tier, model, status), so one day is
 * several rows and the grouping happens here — on the server, in a function a
 * test can call, rather than in the component that draws the calendar.
 */

/** A rollup row, validated on the way out of the database like every other. */
const rollupRowSchema = z.object({
  day: z.string(),
  task: z.string(),
  tier: z.string(),
  model_id_resolved: z.string(),
  status: z.string(),
  call_count: z.coerce.number().int().min(0),
  input_tokens: z.coerce.number().int().min(0),
  output_tokens: z.coerce.number().int().min(0),
  cost_eur: z.coerce.number().min(0),
});

const rollupRowsSchema = z.array(rollupRowSchema);

/**
 * The ceiling on one read.
 *
 * A year at roughly thirty tasks across a handful of models and statuses runs
 * to low tens of thousands of rows. The cap is well above that and exists so a
 * misconfigured retention policy cannot turn one page load into an unbounded
 * scan. Reaching it is reported rather than silently truncated: a calendar
 * quietly missing December is worse than one that says it could not be read.
 */
const ROW_CAP = 60_000;

const round = (value: number) => Math.round(value * 1e8) / 1e8;

export interface SpendHistoryRepository {
  series(from: Date, to: Date): Promise<RepositoryResult<readonly DaySpend[]>>;
}

export function createSpendHistoryRepository(
  client: DatabaseClient,
): SpendHistoryRepository {
  return {
    async series(from, to) {
      const outcome = await client
        .from("cost_rollup_daily")
        .select(
          "day, task, tier, model_id_resolved, status, call_count, input_tokens, output_tokens, cost_eur",
        )
        .gte("day", dayKey(from))
        .lte("day", dayKey(to))
        .order("day", { ascending: true })
        .limit(ROW_CAP);

      if (outcome.error) return fail(repositoryError("unavailable", outcome.error));

      const parsed = rollupRowsSchema.safeParse(outcome.data ?? []);
      if (!parsed.success) return fail(repositoryError("invalid_data", parsed.error));

      if (parsed.data.length >= ROW_CAP) {
        return fail(
          repositoryError("unavailable", {
            message: `the rollup returned ${ROW_CAP} rows or more for this range, so the series would be incomplete`,
          }),
        );
      }

      return ok(groupByDay(parsed.data));
    },
  };
}

type RollupRow = z.infer<typeof rollupRowSchema>;

/**
 * Rollup rows into days.
 *
 * Exported because this is the part worth asserting: the grouping is what
 * turns five rows about one Tuesday into one Tuesday, and getting it wrong
 * is how a day's cost ends up counted once per model.
 */
export function groupByDay(rows: readonly RollupRow[]): readonly DaySpend[] {
  const days = new Map<
    string,
    {
      calls: number;
      costEur: number;
      inputTokens: number;
      outputTokens: number;
      failures: number;
      tasks: Map<string, DayTaskSpend>;
      models: Map<string, DayModelSpend>;
    }
  >();

  for (const row of rows) {
    const day =
      days.get(row.day) ??
      {
        calls: 0,
        costEur: 0,
        inputTokens: 0,
        outputTokens: 0,
        failures: 0,
        tasks: new Map<string, DayTaskSpend>(),
        models: new Map<string, DayModelSpend>(),
      };

    day.calls += row.call_count;
    day.costEur = round(day.costEur + row.cost_eur);
    day.inputTokens += row.input_tokens;
    day.outputTokens += row.output_tokens;
    // Anything that is not `ok` cost money and produced nothing. The rollup
    // keeps status as a dimension precisely so this is countable.
    if (row.status !== "ok") day.failures += row.call_count;

    const taskKey = `${row.task}:${row.tier}`;
    const task = day.tasks.get(taskKey);
    day.tasks.set(taskKey, {
      task: row.task,
      tier: row.tier,
      calls: (task?.calls ?? 0) + row.call_count,
      costEur: round((task?.costEur ?? 0) + row.cost_eur),
      inputTokens: (task?.inputTokens ?? 0) + row.input_tokens,
      outputTokens: (task?.outputTokens ?? 0) + row.output_tokens,
    });

    const model = day.models.get(row.model_id_resolved);
    day.models.set(row.model_id_resolved, {
      modelId: row.model_id_resolved,
      calls: (model?.calls ?? 0) + row.call_count,
      costEur: round((model?.costEur ?? 0) + row.cost_eur),
    });

    days.set(row.day, day);
  }

  return [...days.entries()]
    .map(([day, totals]) => ({
      day,
      calls: totals.calls,
      costEur: totals.costEur,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      failures: totals.failures,
      byTask: [...totals.tasks.values()],
      byModel: [...totals.models.values()],
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
