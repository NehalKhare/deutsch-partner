import {
  buttonPrimary,
  buttonQuiet,
  card,
  eyebrow,
  field,
  prose,
  sectionTitle,
} from "@/components/ui/styles";
import type { ProductOpsStage } from "@/domain/product-ops";
import { cn } from "@/lib/utils";

/**
 * The human gate.
 *
 * Which buttons exist is decided by where the *run* stands, not by what the
 * proposal's status column says. The stage is what the transition is compared
 * against, so offering an approval anywhere else would be offering a decision
 * the compare-and-set is going to refuse — and an operator pressing a button
 * that does nothing is worse than one seeing no button.
 *
 * Accepting the plan ends the run. The plan is what the operator takes away,
 * so the page offers a copy of it beside the decision rather than a button
 * that would pretend to write code.
 */
export function ProposalDecisions({
  proposalId,
  priorityScore,
  stage,
  review,
}: {
  readonly proposalId: string;
  readonly priorityScore: number;
  /** Where the run stands. Null when the run could not be read. */
  readonly stage: ProductOpsStage | null;
  readonly review: (formData: FormData) => Promise<void>;
}) {
  const atProposalGate = stage === "human_review";
  const atPlanGate = stage === "plan_review";

  return (
    <section
      aria-labelledby="actions-heading"
      className={cn(card, "flex flex-col gap-4")}
    >
      <h2 id="actions-heading" className={sectionTitle}>
        Your decision
      </h2>

      {!atProposalGate && !atPlanGate ? (
        <p className={cn(prose, "text-sm")}>
          This run is not waiting on you. You can still leave a comment or
          change the priority, both of which are recorded.
        </p>
      ) : null}

      {atPlanGate ? (
        <p className={cn(prose, "text-sm")}>
          The plan above is the run&apos;s deliverable. Accepting it finishes the
          run and records your decision; nothing in this workflow writes to the
          repository. Copy the plan first if you want to carry it into your own
          tools.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {atProposalGate ? (
          <form action={review}>
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="action" value="approve" />
            <button type="submit" className={buttonPrimary}>
              Approve, and write the PRD
            </button>
          </form>
        ) : null}

        {atPlanGate ? (
          <form action={review}>
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="action" value="approve_plan" />
            <button type="submit" className={buttonPrimary}>
              Accept the plan
            </button>
          </form>
        ) : null}

        {atProposalGate || atPlanGate ? (
          <form action={review}>
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="action" value="reject" />
            <button type="submit" className={buttonQuiet}>
              Reject
            </button>
          </form>
        ) : null}
      </div>

      <form action={review} className="flex flex-col gap-2">
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="action" value="comment" />
        <label className="flex flex-col gap-1">
          <span className={eyebrow}>Comment</span>
          <textarea
            name="comment"
            rows={3}
            maxLength={2000}
            className={field}
            placeholder="Recorded against the proposal. Does not move the run."
          />
        </label>
        <button type="submit" className={cn(buttonQuiet, "self-start")}>
          Leave a comment
        </button>
      </form>

      <form action={review} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="action" value="reprioritise" />
        <label className="flex flex-col gap-1">
          <span className={eyebrow}>Priority</span>
          <input
            type="number"
            name="priority"
            min={0}
            max={100}
            defaultValue={priorityScore}
            className={cn(field, "w-28")}
          />
        </label>
        <button type="submit" className={buttonQuiet}>
          Change the priority
        </button>
      </form>

      <p className="font-display text-xs text-chalk/35">
        The score is computed from four judgements — reach, severity, how well
        the evidence supports it, and how well it fits a German tutor for
        English speakers — so changing it by hand is a deliberate override, and
        it is recorded as one.
      </p>
    </section>
  );
}
