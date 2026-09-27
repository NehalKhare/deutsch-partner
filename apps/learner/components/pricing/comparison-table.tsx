import { Check, Minus } from "lucide-react";

import { PLAN_CODES } from "@dp/domain/plans";

import { COMPARISON_ROWS, planName } from "@/lib/billing/copy";

/**
 * Every plan against every dimension, from the catalogue.
 *
 * The landing page's timeline table, in its register: real header cells with
 * scopes, so a screen reader announces "Plus, Tutor turns a day, 150" rather
 * than a bare number, and a horizontal scroll on a phone rather than a table
 * squeezed until it cannot be read. A tick or a dash is drawn, and said in
 * words underneath for whoever cannot see it.
 */
export function ComparisonTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left font-display text-sm">
        <thead className="text-xs uppercase tracking-[0.16em] text-copy/40">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">
              What you get
            </th>
            {PLAN_CODES.map((plan) => (
              <th key={plan} scope="col" className="py-2 pr-4 font-medium">
                {planName(plan)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label} className="border-t border-edge/50">
              <th scope="row" className="py-3 pr-4 font-medium text-copy/85">
                {row.label}
                {row.comingSoon ? <span className="text-copy/50"> (coming soon)</span> : null}
              </th>
              {PLAN_CODES.map((plan) => {
                const value = row.values[plan];
                return (
                  <td key={plan} className="py-3 pr-4 text-copy/75">
                    {typeof value === "boolean" ? (
                      value ? (
                        <>
                          <Check aria-hidden className="size-4 text-sprout" />
                          <span className="sr-only">Included</span>
                        </>
                      ) : (
                        <>
                          <Minus aria-hidden className="size-4 text-copy/35" />
                          <span className="sr-only">Not included</span>
                        </>
                      )
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
