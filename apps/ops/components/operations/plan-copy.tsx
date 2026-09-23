"use client";

import { useState } from "react";

import { buttonQuiet } from "@dp/ui/styles";

/**
 * The plan, as text an operator can take away.
 *
 * The workflow ends at the plan, so this is its deliverable: the Markdown
 * rendered from the stored columns, shown in full and copied in one press.
 * The clipboard call is the only thing here that can fail — a browser may
 * refuse it outside a secure context — and the text is on the page regardless,
 * so a refusal costs a select-all rather than the plan.
 */
export function PlanCopy({ markdown }: { readonly markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("refused");
    }
    setTimeout(() => setState("idle"), 2_500);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={copy} className={buttonQuiet}>
          Copy the plan as Markdown
        </button>
        <span role="status" className="font-display text-xs text-copy/60">
          {state === "copied"
            ? "Copied."
            : state === "refused"
              ? "The browser refused the clipboard. Select the text below instead."
              : ""}
        </span>
      </div>
      <pre className="max-h-96 overflow-auto rounded-xl border border-edge/60 bg-ground/60 p-4 font-mono text-xs leading-relaxed text-copy/75 whitespace-pre-wrap">
        {markdown}
      </pre>
    </div>
  );
}
