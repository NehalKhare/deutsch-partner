"use client";

import { useActionState, useId } from "react";

import { PER_USER_BUDGET_SCOPES, type EnforcedBudgetScope } from "@dp/domain/budgets";
import { buttonQuiet, control, field } from "@dp/ui/styles";
import { cn } from "@dp/ui/utils";

import { BUDGET_FORM_IDLE, SCOPE_LABELS, type BudgetFormState } from "@/lib/budgets";

/**
 * One budget limit, as an operator edits it.
 *
 * Three shapes of the same form. A scope's default has no key and no "active"
 * box, because a default cannot be switched off — only lowered, even to zero.
 * An existing override is keyed by the learner's pseudonym and can be paused.
 * A new override asks for the scope and the pseudonym, which an operator
 * copies from the table of learners below or from the ledger; an email or an
 * account id is refused, because neither belongs in an operator table.
 *
 * Percentages are whole numbers, as the routing document states them. The
 * action validates everything again: this is a convenience, not a check.
 */

export interface BudgetLimitFormProps {
  readonly action: (state: BudgetFormState, formData: FormData) => Promise<BudgetFormState>;
  readonly mode: "default" | "override" | "new-override";
  readonly scope?: EnforcedBudgetScope;
  readonly scopeKey?: string | null;
  /** Current values, as the form shows them: euro as typed, percentages whole. */
  readonly limitEur?: string;
  readonly warnPct?: string;
  readonly degradePct?: string;
  readonly active?: boolean;
}

const labelClass = "font-display text-xs font-medium text-copy/70";

export function BudgetLimitForm({
  action,
  mode,
  scope,
  scopeKey = null,
  limitEur = "",
  warnPct = "70",
  degradePct = "90",
  active = true,
}: BudgetLimitFormProps) {
  const [state, formAction, pending] = useActionState(action, BUDGET_FORM_IDLE);
  const id = useId();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {mode === "new-override" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-scope`} className={labelClass}>
              Scope
            </label>
            <select id={`${id}-scope`} name="scope" defaultValue="per_user_daily" className={field}>
              {PER_USER_BUDGET_SCOPES.map((option) => (
                <option key={option} value={option}>
                  {SCOPE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-key`} className={labelClass}>
              Learner pseudonym
            </label>
            <input
              id={`${id}-key`}
              name="scopeKey"
              required
              pattern="[0-9a-f]{32}"
              autoComplete="off"
              spellCheck={false}
              placeholder="32 hex characters, as in the ledger"
              className={cn(field, "font-mono text-sm")}
            />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="scopeKey" value={scopeKey ?? ""} />
        </>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-limit`} className={labelClass}>
            Limit (EUR)
          </label>
          <input
            id={`${id}-limit`}
            name="limitEur"
            required
            inputMode="decimal"
            defaultValue={limitEur}
            autoComplete="off"
            className={cn(field, "tabular-nums")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-warn`} className={labelClass}>
            Warn at %
          </label>
          <input
            id={`${id}-warn`}
            name="warnPct"
            required
            type="number"
            min={1}
            max={100}
            step={1}
            defaultValue={warnPct}
            className={cn(field, "tabular-nums")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-degrade`} className={labelClass}>
            Degrade at %
          </label>
          <input
            id={`${id}-degrade`}
            name="degradePct"
            required
            type="number"
            min={1}
            max={100}
            step={1}
            defaultValue={degradePct}
            className={cn(field, "tabular-nums")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {mode === "default" ? (
          // A default is always on; the database refuses anything else.
          <input type="hidden" name="active" value="on" />
        ) : (
          <label className="flex items-center gap-2 font-display text-sm text-copy/70">
            <input
              type="checkbox"
              name="active"
              defaultChecked={mode === "new-override" ? true : active}
              className={control}
            />
            Active
          </label>
        )}

        <button type="submit" disabled={pending} className={buttonQuiet}>
          {pending ? "Saving…" : mode === "new-override" ? "Add override" : "Save"}
        </button>

        <p
          role="status"
          aria-live="polite"
          className={cn("text-sm", state.status === "error" ? "text-ember" : "text-copy/60")}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
