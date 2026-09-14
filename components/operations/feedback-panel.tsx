import { card, eyebrow, stat } from "@/components/ui/styles";
import type { LearnerFeedbackSummary } from "@/domain/trainer-coaching";
import { percent, unhelpfulShare } from "@/lib/dashboard/learner-feedback";
import { FEEDBACK_REASON_LABELS } from "@/lib/trainer/coaching";
import { cn } from "@/lib/utils";

/**
 * What learners said about the trainer, for the operator.
 *
 * The aggregate the research stage reads, drawn so a person can read it too:
 * the totals as tiles, the reasons as a ranked list, the prompt versions as
 * a table — which is the row that tells an operator whether the last prompt
 * change helped — and the most recent notes as quotes. Nothing here names a
 * learner; the only per-learner figure is a count.
 *
 * A server component with no state: the page reads once and renders. The
 * notes are learners' text and are rendered as text, never as markup.
 */

const SHOWN_TOOLS = 5;

export function FeedbackPanel({ summary }: { readonly summary: LearnerFeedbackSummary }) {
  const { totals } = summary;
  const share = unhelpfulShare(totals);
  const maxReason = Math.max(1, ...summary.byReason.map((entry) => entry.count));

  const tiles: readonly { label: string; value: string }[] = [
    { label: "Votes", value: String(totals.votes) },
    { label: "Unhelpful", value: percent(share) },
    { label: "Learners", value: String(totals.learners) },
    { label: "With a note", value: String(totals.noted) },
  ];

  if (totals.votes === 0) {
    return (
      <div data-role="feedback-panel" className={cn(card, "flex flex-col gap-2")}>
        <p className="text-sm text-chalk/70">
          No learner has rated a trainer reply in the last {summary.window.days} days.
          When they do, every scan starts from what they said.
        </p>
      </div>
    );
  }

  return (
    <div data-role="feedback-panel" className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className={stat}>
            <dt className={eyebrow}>{tile.label}</dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="reasons-heading" className={cn(card, "flex flex-col gap-3")}>
          <h3 id="reasons-heading" className={eyebrow}>
            Why replies were unhelpful
          </h3>
          {summary.byReason.length === 0 ? (
            <p className="text-sm text-chalk/55">No reasons were given.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {summary.byReason.map((entry) => (
                <li key={entry.reason} className="flex flex-col gap-1 text-sm">
                  <span className="flex items-baseline justify-between">
                    <span className="text-chalk/80">{FEEDBACK_REASON_LABELS[entry.reason]}</span>
                    <span className="tabular-nums text-chalk/55">{entry.count}</span>
                  </span>
                  <span aria-hidden className="h-1 rounded-full bg-haze/60">
                    <span
                      className="block h-1 rounded-full bg-apricot/70"
                      style={{ width: `${Math.round((entry.count / maxReason) * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="versions-heading" className={cn(card, "flex flex-col gap-3")}>
          <h3 id="versions-heading" className={eyebrow}>
            By trainer prompt version
          </h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-chalk/45">
              <tr>
                <th scope="col" className="pb-1 font-normal">Version</th>
                <th scope="col" className="pb-1 text-right font-normal">Votes</th>
                <th scope="col" className="pb-1 text-right font-normal">Unhelpful</th>
              </tr>
            </thead>
            <tbody>
              {summary.byPromptVersion.map((version) => (
                <tr key={version.promptVersion} className="border-t border-haze/40">
                  <td className="py-1 text-chalk/80">v{version.promptVersion}</td>
                  <td className="py-1 text-right tabular-nums text-chalk/70">{version.votes}</td>
                  <td className="py-1 text-right tabular-nums text-chalk/70">
                    {percent(unhelpfulShare(version))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.byTool.length > 0 ? (
            <p className="text-xs text-chalk/55">
              Most flagged tools:{" "}
              {summary.byTool
                .slice(0, SHOWN_TOOLS)
                .map((tool) => `${tool.tool} (${tool.unhelpful}/${tool.votes})`)
                .join(", ")}
            </p>
          ) : null}
        </section>
      </div>

      {summary.recentNotes.length > 0 ? (
        <section aria-labelledby="notes-heading" className={cn(card, "flex flex-col gap-3")}>
          <h3 id="notes-heading" className={eyebrow}>
            In learners&apos; own words
          </h3>
          <ul className="flex flex-col gap-3">
            {summary.recentNotes.map((entry, index) => (
              <li key={`${entry.createdAt.toISOString()}-${index}`} className="flex flex-col gap-1">
                <blockquote className="text-sm leading-relaxed text-chalk/80">
                  “{entry.note}”
                </blockquote>
                <p className="text-xs text-chalk/45">
                  {entry.verdict === "helpful" ? "Helpful" : "Not helpful"}
                  {entry.reasons.length > 0
                    ? ` · ${entry.reasons.map((reason) => FEEDBACK_REASON_LABELS[reason]).join(", ")}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
