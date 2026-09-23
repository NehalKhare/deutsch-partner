import { card, eyebrow, sectionTitle } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";
import {
  longDayLabel,
  modelsOf,
  tasksOf,
  type DaySpend,
} from "@/lib/spend-series";
import { formatCount, formatEur, formatTokens } from "./format";

/**
 * One day, opened up.
 *
 * What the calendar cannot say: which tasks the money went on, which tier
 * each of them was routed to, and how many tokens went in and came back. The
 * cell carries magnitude and the figure; this carries the reason, and the
 * reason is the point — "Tuesday cost thirty euro" is not actionable and
 * "Tuesday cost thirty euro and twenty-eight of it was one embedding
 * backfill" is.
 *
 * It is also the table view the chart's tooltip leans on. Every figure the
 * hover layer shows is reachable here without hovering at all, which is what
 * makes the hover layer an enhancement rather than a gate.
 */

export interface DayDetailProps {
  readonly day: DaySpend;
  readonly limitEur: number;
}

export function DayDetail({ day, limitEur }: DayDetailProps) {
  const models = modelsOf(day);
  const tasks = tasksOf(day);
  const overLimit = limitEur > 0 && day.costEur >= limitEur;

  return (
    <section
      aria-labelledby="day-detail-heading"
      className={cn(card, "flex flex-col gap-5")}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="day-detail-heading" className={sectionTitle}>
          {longDayLabel(day.day)}
        </h3>
        <span className="font-display text-sm text-copy/50 tabular-nums">
          {day.day}
        </span>
      </header>

      {day.calls === 0 ? (
        <p className="font-body text-copy/45">
          No model was called on this day.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure label="Spend" value={formatEur(day.costEur)} tone={overLimit ? "alert" : "normal"} />
            <Figure label="Calls" value={formatCount(day.calls)} />
            <Figure label="Tokens in" value={formatTokens(day.inputTokens)} />
            <Figure label="Tokens out" value={formatTokens(day.outputTokens)} />
          </dl>

          {overLimit ? (
            // Icon and words, never the colour on its own.
            <p className="flex items-start gap-2 rounded-xl border border-ember/50 bg-ember/10 px-3.5 py-2.5 text-sm text-ember">
              <span aria-hidden>▲</span>
              <span>
                <strong className="font-display font-semibold">
                  Over the daily limit.
                </strong>{" "}
                This day spent {formatEur(day.costEur)} against a ceiling of{" "}
                {formatEur(limitEur)}, so the gateway will have been denying
                calls before it ended.
              </span>
            </p>
          ) : null}

          {day.failures > 0 ? (
            <p className="font-display text-sm text-copy/60">
              {formatCount(day.failures)} call
              {day.failures === 1 ? "" : "s"} failed. Retries are separate rows
              in the ledger, so their cost is already counted above.
            </p>
          ) : null}

          <Breakdown
            heading="Models routed to"
            columns={["Model", "Calls", "EUR"]}
            rows={models.map((model) => ({
              key: model.modelId,
              cells: [
                model.modelId,
                formatCount(model.calls),
                formatEur(model.costEur),
              ],
            }))}
          />

          <Breakdown
            heading="Tasks"
            columns={["Task", "Tier", "Calls", "Tokens", "EUR"]}
            rows={tasks.map((task) => ({
              key: `${task.task}:${task.tier}`,
              cells: [
                task.task,
                task.tier,
                formatCount(task.calls),
                formatTokens(task.inputTokens + task.outputTokens),
                formatEur(task.costEur),
              ],
            }))}
          />
        </>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "normal",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "normal" | "alert";
}) {
  return (
    <div>
      <dt className={eyebrow}>{label}</dt>
      {/* Proportional figures: these are standalone values, and tabular digits
          make a large number look gappy. The columns below get tabular. */}
      <dd
        className={cn(
          "mt-1 font-display text-xl font-semibold",
          tone === "alert" ? "text-ember" : "text-copy",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Breakdown({
  heading,
  columns,
  rows,
}: {
  readonly heading: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<{ readonly key: string; readonly cells: readonly string[] }>;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      <h4 className={eyebrow}>{heading}</h4>
      <table className="w-full text-left font-display text-sm">
        <thead className={eyebrow}>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={cn("py-1", index > 0 && "text-right")}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-edge/50 text-copy/80">
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index] ?? index}
                  className={cn("py-1", index > 0 && "text-right tabular-nums")}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
