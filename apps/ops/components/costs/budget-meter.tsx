import { cn } from "@dp/ui/utils";

import type { Meter, MeterState } from "@/lib/budgets";

import { formatEur } from "./format";

/**
 * Spend against one limit, as a bar with its state spelled out.
 *
 * The state comes from the server, computed by the same function the gateway
 * gates on; this only draws it (cost-dashboard-spec.md S8: tiles render a
 * budget state without recomputing it). Past warn the bar changes colour and
 * the word beside it says what the gateway is doing — degraded and denied are
 * never only a shade.
 */

const STATE_LABEL: Readonly<Record<MeterState, string>> = {
  allow: "Within budget",
  warn: "Warning",
  degrade: "Degraded",
  deny: "Denied",
  unlimited: "No limit",
};

/** What the gateway does at this state, said once for anybody not fluent in it. */
const STATE_MEANING: Readonly<Record<MeterState, string>> = {
  allow: "Calls are served normally.",
  warn: "Calls are served normally and a warning is logged.",
  degrade: "Optional calls are dropped and replies use a cheaper tier.",
  deny: "No model call is made.",
  unlimited: "The gateway allows unlimited spend at this scope.",
};

const BADGE: Readonly<Record<MeterState, string>> = {
  allow: "border-edge text-copy/60",
  warn: "border-brand/50 bg-brand/10 text-brand",
  degrade: "border-ember/50 bg-ember/10 text-ember",
  deny: "border-ember bg-ember text-on-accent",
  unlimited: "border-ember/50 border-dashed text-ember",
};

const FILL: Readonly<Record<MeterState, string>> = {
  allow: "bg-copy/40",
  warn: "bg-brand",
  degrade: "bg-ember/80",
  deny: "bg-ember",
  unlimited: "bg-copy/20",
};

export function BudgetStateBadge({ state }: { readonly state: MeterState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-display text-xs font-semibold uppercase tracking-wide",
        BADGE[state],
      )}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

export function BudgetMeter({
  meter,
  warnPct,
  degradePct,
  label,
  compact = false,
}: {
  readonly meter: Meter;
  /** Threshold marks, as fractions of the limit. Omitted when there is no limit. */
  readonly warnPct?: number;
  readonly degradePct?: number;
  /** The accessible name of the bar. */
  readonly label: string;
  readonly compact?: boolean;
}) {
  const shown = meter.ratio === null ? 0 : Math.min(meter.ratio, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-sm tabular-nums text-copy">
          <span className="font-semibold">{formatEur(meter.spentEur)}</span>
          <span className="text-copy/50">
            {meter.limitEur === null ? " spent, no limit" : ` of ${formatEur(meter.limitEur)}`}
            {meter.ratio === null ? "" : ` · ${Math.round(meter.ratio * 100)}%`}
          </span>
        </p>
        <BudgetStateBadge state={meter.state} />
      </div>

      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.ratio === null ? undefined : Math.round(Math.min(meter.ratio, 1) * 100)}
        aria-valuetext={`${STATE_LABEL[meter.state]}: ${STATE_MEANING[meter.state]}`}
        className={cn("relative w-full overflow-hidden rounded-full bg-edge/40", compact ? "h-1.5" : "h-2.5")}
      >
        <div className={cn("h-full rounded-full", FILL[meter.state])} style={{ width: `${shown * 100}%` }} />
        {meter.limitEur === null
          ? null
          : [warnPct, degradePct].map((mark, index) =>
              mark === undefined || mark >= 1 ? null : (
                <span
                  key={index}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-copy/50"
                  style={{ left: `${mark * 100}%` }}
                />
              ),
            )}
      </div>

      {compact ? null : <p className="text-xs text-copy/50">{STATE_MEANING[meter.state]}</p>}
    </div>
  );
}
