import Link from "next/link";
import { notFound } from "next/navigation";

import { reviewProposalAction } from "../actions";
import { PlanCopy } from "@/components/operations/plan-copy";
import { ProposalDecisions } from "@/components/operations/proposal-decisions";
import { RunActivityPanel } from "@/components/operations/run-activity";
import { RichText } from "@/components/ui/rich-text";
import {
  card,
  eyebrow,
  linkInline,
  page,
  pageTitle,
  prose,
  sectionTitle,
  stat,
} from "@/components/ui/styles";
import {
  isDeniedPath,
  stageOwner,
  type ProposalReview,
  type StoredProposal,
} from "@/domain/product-ops";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { isOperator } from "@/lib/auth/operator";
import {
  boardRunFrom,
  planMarkdown,
  runReports,
  timelineEntries,
  workerCommandFor,
} from "@/lib/dashboard/product-ops";
import { cn } from "@/lib/utils";

export const metadata = { title: "Proposal — Deutsch Partner" };

/**
 * One proposal, and every decision anybody has made about it.
 *
 * The page a human gate actually happens on, so it is built to be read before
 * a decision rather than after one: the evidence the proposal rests on, the
 * priority and how it was arrived at, the plan's file list in full, and the
 * timeline of what the pipeline did. The two buttons that matter are the two
 * that let an agent write code, and they are the last thing on the page for
 * the same reason sign-out is the last thing in the account menu.
 *
 * Everything the model wrote is rendered through RichText — React elements
 * from a parsed tree, never a string of HTML. Markup is not expressible here
 * rather than escaped correctly.
 */
export default async function ProposalPage({
  params,
}: {
  readonly params: Promise<{ readonly proposalId: string }>;
}) {
  const learnerId = await requireAuthenticatedUserId();
  if (!isOperator(learnerId)) notFound();

  const { proposalId } = await params;
  const { runs } = createProductOpsReader();

  const proposal = await runs.getProposal(proposalId);
  if (!proposal.ok) notFound();

  // In parallel: five bounded reads against one proposal, none of which the
  // others depend on.
  const [run, prd, plan, reviews, findings] = await Promise.all([
    runs.getRun(proposal.data.runId),
    runs.findPrdForProposal(proposalId),
    runs.findPlanForProposal(proposalId),
    runs.listReviews(proposalId),
    runs.listFindings(proposal.data.runId),
  ]);

  const events = run.ok ? await runs.listEvents(run.data.id) : null;
  const stage = run.ok ? run.data.currentStage : null;
  const owner = stage === null ? "nobody" : stageOwner(stage);
  const timeline = events?.ok ? timelineEntries(events.data) : [];
  const spentEur = timeline.reduce((total, entry) => total + entry.costEur, 0);

  // Approving hands work back to the server for three background stages, so
  // this page needs the same live account of them the board has. asOf is this
  // process's clock rather than the database's, which the board gets for free
  // from generatedAt; a few seconds of drift against a three-minute stall
  // window does not change an answer.
  const reports = run.ok ? runReports([boardRunFrom(run.data)], new Date()) : [];

  return (
    <main className={cn(page, "max-w-4xl")}>
      <header className="flex flex-col gap-2">
        <p className={eyebrow}>
          <Link href="/operations/product" className={linkInline}>
            Product ops
          </Link>
        </p>
        <h1 className={pageTitle}>{proposal.data.title}</h1>
        <p className="font-display text-sm text-chalk/50">
          {proposal.data.status.replace(/_/g, " ")}
          {stage ? ` · run at ${stage.replace(/_/g, " ")}` : ""}
          {` · €${spentEur.toFixed(4)} spent`}
        </p>
      </header>

      <RunActivityPanel reports={reports} />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={stat}>
          <dt className={eyebrow}>Priority</dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
            {proposal.data.priorityScore}
            <span className="text-sm font-normal text-chalk/45">/100</span>
          </dd>
        </div>
        <div className={stat}>
          <dt className={eyebrow}>Effort</dt>
          <dd className="mt-1 font-display text-xl font-semibold text-chalk">
            {proposal.data.complexity}
          </dd>
        </div>
        <div className={stat}>
          <dt className={eyebrow}>Evidence</dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
            {proposal.data.supportingResearch.length}
          </dd>
        </div>
        <div className={stat}>
          <dt className={eyebrow}>Decisions</dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-chalk">
            {reviews.ok ? reviews.data.length : 0}
          </dd>
        </div>
      </dl>

      <Prose proposal={proposal.data} />

      <section aria-labelledby="evidence-heading" className="flex flex-col gap-2">
        <h2 id="evidence-heading" className={sectionTitle}>
          Evidence
        </h2>
        {proposal.data.supportingResearch.length === 0 ? (
          <p className={prose}>
            None cited, which for a proposal is a reason to reject it.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {proposal.data.supportingResearch.map((item, index) => (
              <li key={`${item.url ?? "no-url"}-${index}`} className={cn(prose, "text-sm")}>
                {/* The scheme was narrowed to http and https on the way in,
                    and any url the provider did not actually return was
                    dropped before this was stored. */}
                {item.url ? (
                  <a
                    href={item.url}
                    rel="noreferrer nofollow"
                    target="_blank"
                    className={linkInline}
                  >
                    {item.finding}
                  </a>
                ) : (
                  item.finding
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {prd.ok && prd.data ? (
        <section aria-labelledby="prd-heading" className="flex flex-col gap-3">
          <h2 id="prd-heading" className={sectionTitle}>
            PRD
          </h2>
          <p className="font-display text-xs text-chalk/40">
            Stored in the database, projected to{" "}
            <code className="font-mono">{prd.data.filePath}</code> for the
            worker. If the two disagree, the row is right.
          </p>
          <Bullets label="User stories" items={prd.data.sections.userStories} />
          <Bullets
            label="Functional requirements"
            items={prd.data.sections.functionalRequirements}
          />
          <Bullets
            label="Acceptance criteria"
            items={prd.data.sections.acceptanceCriteria}
          />
          <Bullets label="Non-goals" items={prd.data.sections.nonGoals} />
        </section>
      ) : null}

      {plan.ok && plan.data ? (
        <section aria-labelledby="plan-heading" className="flex flex-col gap-3">
          <h2 id="plan-heading" className={sectionTitle}>
            Implementation plan
          </h2>
          <p className="font-display text-xs text-chalk/40">
            {plan.data.status === "approved"
              ? "Accepted. This is the run's deliverable; copy it below."
              : "Not yet accepted. Read it, copy it if you want it, then decide below."}
          </p>
          <PlanCopy markdown={planMarkdown(proposal.data.title, plan.data.plan)} />
          <PlanFiles label="Files to modify" paths={plan.data.plan.filesToModify} />
          <PlanFiles label="Files to create" paths={plan.data.plan.filesToCreate} />
          <PlanFiles label="Tests" paths={plan.data.plan.tests} />
          <Bullets
            label="Database changes"
            items={plan.data.plan.databaseChanges}
            note="Described, never written. A migration is a person's decision."
          />
          <Bullets label="Dependencies" items={plan.data.plan.dependencies} />
          <Bullets label="Risks" items={plan.data.plan.risks} />
        </section>
      ) : null}

      {findings.ok && findings.data.length > 0 ? (
        <section aria-labelledby="findings-heading" className="flex flex-col gap-2">
          <h2 id="findings-heading" className={sectionTitle}>
            What the scan found
          </h2>
          <ul className="flex flex-col gap-3">
            {findings.data.map((finding) => (
              <li key={finding.id} className={cn(card, "flex flex-col gap-1 p-3.5")}>
                <p className="font-display text-sm font-semibold text-chalk">
                  {finding.sourceUrl ? (
                    <a
                      href={finding.sourceUrl}
                      rel="noreferrer nofollow"
                      target="_blank"
                      className={linkInline}
                    >
                      {finding.title}
                    </a>
                  ) : (
                    finding.title
                  )}
                </p>
                <p className="font-display text-xs text-chalk/40">
                  {finding.sourceType}
                  {finding.relevanceScore === null
                    ? ""
                    : ` · relevance ${finding.relevanceScore.toFixed(2)}`}
                </p>
                <p className={cn(prose, "text-sm")}>
                  <RichText content={finding.summary} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-2 overflow-x-auto">
        <h2 id="timeline-heading" className={sectionTitle}>
          Timeline
        </h2>
        <table className="w-full text-left font-display text-sm">
          <thead className={eyebrow}>
            <tr>
              <th scope="col" className="py-1">
                Stage
              </th>
              <th scope="col">What happened</th>
              <th scope="col" className="text-right">
                EUR
              </th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {timeline.length === 0 ? (
              <tr className="border-t border-haze/50">
                <td colSpan={4} className="py-3 font-body text-chalk/45">
                  Nothing recorded yet.
                </td>
              </tr>
            ) : null}
            {timeline.map((entry) => (
              <tr key={entry.id} className="border-t border-haze/50 text-chalk/80">
                <td className="py-1">{entry.stage.replace(/_/g, " ")}</td>
                <td className={entry.status === "failed" ? "text-ember" : undefined}>
                  {entry.entered ? "entered" : entry.status.replace(/_/g, " ")}
                  {entry.errorCode ? ` · ${entry.errorCode}` : ""}
                </td>
                <td className="text-right tabular-nums text-chalk/55">
                  {entry.costEur === 0 ? "—" : entry.costEur.toFixed(6)}
                </td>
                <td className="text-chalk/45">
                  {entry.notes
                    .map((note) => `${note.label}: ${note.value}`)
                    .join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {reviews.ok && reviews.data.length > 0 ? (
        <section aria-labelledby="decisions-heading" className="flex flex-col gap-2">
          <h2 id="decisions-heading" className={sectionTitle}>
            Decisions
          </h2>
          <ul className="flex flex-col gap-2">
            {reviews.data.map((review) => (
              <li key={review.id} className={cn(card, "p-3.5")}>
                <Decision review={review} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {owner === "worker" ? (
        <section aria-labelledby="worker-heading" className={cn(card, "flex flex-col gap-2")}>
          <h2 id="worker-heading" className={sectionTitle}>
            Over to the worker
          </h2>
          <p className={cn(prose, "text-sm")}>
            The next stage needs a working tree, which this server does not
            have. Run this where the repository is checked out; it is safe to
            run twice.
          </p>
          <code className="overflow-x-auto rounded bg-ink/60 px-3 py-2 font-mono text-xs text-chalk/70">
            {workerCommandFor(proposal.data.id)}
          </code>
        </section>
      ) : null}

      <ProposalDecisions
        proposalId={proposal.data.id}
        priorityScore={proposal.data.priorityScore}
        stage={stage}
        review={reviewProposalAction}
      />
    </main>
  );
}

function Prose({ proposal }: { readonly proposal: StoredProposal }) {
  const sections: readonly { label: string; body: string }[] = [
    { label: "Problem", body: proposal.problemStatement },
    { label: "Target users", body: proposal.targetUsers },
    { label: "Why now", body: proposal.marketJustification },
    { label: "Expected impact", body: proposal.userImpact },
    { label: "Proposed solution", body: proposal.proposedSolution },
  ];

  return (
    <section aria-labelledby="proposal-heading" className="flex flex-col gap-4">
      <h2 id="proposal-heading" className={sectionTitle}>
        The proposal
      </h2>
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <h3 className={eyebrow}>{section.label}</h3>
          <div className={prose}>
            <RichText content={section.body} />
          </div>
        </div>
      ))}
      {proposal.implementationOutline.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className={eyebrow}>Outline</h3>
          <ol className={cn(prose, "list-inside list-decimal")}>
            {proposal.implementationOutline.map((step, index) => (
              <li key={`${index}-${step.slice(0, 12)}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function Bullets({
  label,
  items,
  note,
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={eyebrow}>{label}</h3>
      {note ? <p className="font-display text-xs text-chalk/35">{note}</p> : null}
      {items.length === 0 ? (
        <p className="font-display text-sm text-chalk/35">None.</p>
      ) : (
        <ul className={cn(prose, "list-inside list-disc text-sm")}>
          {items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 12)}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanFiles({
  label,
  paths,
}: {
  readonly label: string;
  readonly paths: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={eyebrow}>{label}</h3>
      {paths.length === 0 ? (
        <p className="font-display text-sm text-chalk/35">None.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {paths.map((path) => {
            const denied = isDeniedPath(path);

            return (
              <li key={path} className="font-mono text-xs">
                <span className={denied ? "text-ember" : "text-chalk/70"}>
                  {path}
                </span>
                {/* Shown rather than removed: the plan asked for it, and the
                    person approving should see that the apply layer will
                    refuse it whatever this approval says. */}
                {denied ? (
                  <span className="ml-2 font-display text-[0.7rem] text-ember/80">
                    refused — not the agent&apos;s to change
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Decision({ review }: { readonly review: ProposalReview }) {
  const moved =
    review.newPriority !== null && review.newPriority !== review.previousPriority;

  return (
    <div className="flex flex-col gap-1">
      <p className="font-display text-sm text-chalk/80">
        {review.action.replace(/_/g, " ")}
        {moved ? ` · ${review.previousPriority ?? "—"} → ${review.newPriority}` : ""}
        <span className="ml-2 text-xs text-chalk/40">
          {review.createdAt.toISOString().slice(0, 16)}
        </span>
      </p>
      {review.comment ? (
        <p className={cn(prose, "text-sm")}>{review.comment}</p>
      ) : null}
    </div>
  );
}
