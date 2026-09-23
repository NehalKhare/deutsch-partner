import Link from "next/link";
import { notFound } from "next/navigation";

import { retryRunAction, reviewProposalAction } from "../actions";
import { PlanCopy } from "@/components/operations/plan-copy";
import { ProposalDecisions } from "@/components/operations/proposal-decisions";
import {
  ProposalOutline,
  type OutlineItem,
} from "@/components/operations/proposal-outline";
import { RunActivityPanel } from "@/components/operations/run-activity";
import { SectionPanel } from "@/components/operations/section-panel";
import { RichText } from "@dp/ui/rich-text";
import {
  card,
  eyebrow,
  hairline,
  linkInline,
  page,
  pageTitle,
  prose,
  stat,
} from "@dp/ui/styles";
import {
  failedStageOf,
  isDeniedPath,
  stageOwner,
  type EngineeringBreakdown,
  type TShirtSize,
  type ProposalReview,
  type StoredProposal,
} from "@dp/domain/product-ops";
import { createProductOpsReader } from "@/lib/api/composition";
import { requireOperator } from "@/lib/auth/require-operator";
import {
  boardRunFrom,
  planMarkdown,
  runReports,
  sizeLabel,
  timelineEntries,
  workerCommandFor,
} from "@dp/product-ops/view";
import { cn } from "@dp/ui/utils";

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
  await requireOperator({ route: "/product/[proposalId]" });

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
  // Where a failed run stopped, so the decision panel can offer to try again
  // from there and say where "there" is.
  const failedAt = events?.ok ? failedStageOf(events.data) : null;
  const spentEur = timeline.reduce((total, entry) => total + entry.costEur, 0);

  // Approving hands work back to the server for three background stages, so
  // this page needs the same live account of them the board has. asOf is this
  // process's clock rather than the database's, which the board gets for free
  // from generatedAt; a few seconds of drift against a three-minute stall
  // window does not change an answer.
  const reports = run.ok ? runReports([boardRunFrom(run.data)], new Date()) : [];

  const evidenceCount = proposal.data.supportingResearch.length;
  const reviewCount = reviews.ok ? reviews.data.length : 0;
  const hasPrd = prd.ok && prd.data !== null;
  const hasPlan = plan.ok && plan.data !== null;
  const scanFindings = findings.ok ? findings.data : [];
  // The two stages where a button on this page actually moves the run. The
  // outline draws that entry in the accent, so an operator who came here to
  // decide something can see from the rail that there is something to decide.
  const atGate = stage === "human_review" || stage === "plan_review";

  // Built here rather than inside the rail: which sections exist is a property
  // of what was read above, and a rail that worked it out again could disagree
  // with the page it is indexing.
  const outline: readonly OutlineItem[] = [
    { id: "proposal-heading", label: "The proposal" },
    { id: "evidence-heading", label: "Evidence", count: evidenceCount },
    ...(hasPrd ? [{ id: "prd-heading", label: "PRD" }] : []),
    ...(hasPlan ? [{ id: "plan-heading", label: "Implementation plan" }] : []),
    ...(scanFindings.length > 0
      ? [{ id: "findings-heading", label: "What the scan found", count: scanFindings.length }]
      : []),
    { id: "timeline-heading", label: "Timeline", count: timeline.length },
    ...(reviewCount > 0
      ? [{ id: "decisions-heading", label: "Decisions", count: reviewCount }]
      : []),
    ...(owner === "worker"
      ? [{ id: "worker-heading", label: "Over to the worker" }]
      : []),
    { id: "actions-heading", label: "Your decision", accent: atGate },
  ];

  return (
    <main className={cn(page, "max-w-6xl")}>
      <header className="flex flex-col gap-2">
        <p className={eyebrow}>
          <Link href="/product" className={linkInline}>
            Feature proposals
          </Link>
        </p>
        <h1 className={pageTitle}>{proposal.data.title}</h1>
        <p className="font-display text-sm text-copy/60">
          {proposal.data.status.replace(/_/g, " ")}
          {stage ? ` · run at ${stage.replace(/_/g, " ")}` : ""}
          {` · €${spentEur.toFixed(4)} spent`}
        </p>
      </header>

      <RunActivityPanel reports={reports} />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={stat}>
          <dt className={eyebrow}>Priority</dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-copy">
            {proposal.data.priorityScore}
            <span className="text-sm font-normal text-copy/45">/100</span>
          </dd>
        </div>
        <div className={stat}>
          <dt className={eyebrow}>Effort</dt>
          <dd className="mt-1 font-display text-xl font-semibold text-copy">
            {proposal.data.complexity}
          </dd>
        </div>
        <div className={stat}>
          <dt className={eyebrow}>Evidence</dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-copy">
            {proposal.data.supportingResearch.length}
          </dd>
        </div>
        <div className={stat}>
          <dt className={eyebrow}>Decisions</dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-copy">
            {reviews.ok ? reviews.data.length : 0}
          </dd>
        </div>
      </dl>

      <div className="grid items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Prose proposal={proposal.data} />

          <SectionPanel id="evidence-heading" title="Evidence" count={evidenceCount} defaultOpen>
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
          </SectionPanel>

          {prd.ok && prd.data ? (
            <SectionPanel id="prd-heading" title="PRD">
              <p className="font-display text-xs text-copy/40">
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
            </SectionPanel>
          ) : null}

          {plan.ok && plan.data ? (
            <SectionPanel id="plan-heading" title="Implementation plan" defaultOpen>
              <p className="font-display text-xs text-copy/40">
                {plan.data.status === "approved"
                  ? "Accepted. This is the run's deliverable; copy it below."
                  : "Not yet accepted. Read it, copy it if you want it, then decide below."}
              </p>
              <PlanCopy
                markdown={planMarkdown(proposal.data.title, plan.data.plan, plan.data.breakdown)}
              />
              {plan.data.breakdown ? (
                <Breakdown breakdown={plan.data.breakdown} />
              ) : (
                <p className="font-display text-xs text-copy/40">
                  The engineering breakdown has not been written yet. If the run
                  stopped, trying it again writes only this half.
                </p>
              )}
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
            </SectionPanel>
          ) : null}

          {scanFindings.length > 0 ? (
            <SectionPanel
              id="findings-heading"
              title="What the scan found"
              count={scanFindings.length}
            >
              <ul className="flex flex-col gap-3">
                {scanFindings.map((finding) => (
                  <li key={finding.id} className={cn(card, "flex flex-col gap-1 p-3.5")}>
                    <p className="font-display text-sm font-semibold text-copy">
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
                    <p className="font-display text-xs text-copy/40">
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
            </SectionPanel>
          ) : null}

          <SectionPanel id="timeline-heading" title="Timeline" count={timeline.length}>
            <div className="overflow-x-auto">
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
                  <tr className="border-t border-edge/50">
                    <td colSpan={4} className="py-3 font-body text-copy/45">
                      Nothing recorded yet.
                    </td>
                  </tr>
                ) : null}
                {timeline.map((entry) => (
                  <tr key={entry.id} className="border-t border-edge/50 text-copy/80">
                    <td className="py-1">{entry.stage.replace(/_/g, " ")}</td>
                    <td className={entry.status === "failed" ? "text-ember" : undefined}>
                      {entry.entered ? "entered" : entry.status.replace(/_/g, " ")}
                      {entry.errorCode ? ` · ${entry.errorCode}` : ""}
                    </td>
                    <td className="text-right tabular-nums text-copy/60">
                      {entry.costEur === 0 ? "—" : entry.costEur.toFixed(6)}
                    </td>
                    <td className="text-copy/45">
                      {entry.notes
                        .map((note) => `${note.label}: ${note.value}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </SectionPanel>

          {reviews.ok && reviews.data.length > 0 ? (
            <SectionPanel id="decisions-heading" title="Decisions" count={reviews.data.length}>
              <ul className="flex flex-col gap-2">
                {reviews.data.map((review) => (
                  <li key={review.id} className={cn(card, "p-3.5")}>
                    <Decision review={review} />
                  </li>
                ))}
              </ul>
            </SectionPanel>
          ) : null}

          {owner === "worker" ? (
            <SectionPanel id="worker-heading" title="Over to the worker" defaultOpen>
              <p className={cn(prose, "text-sm")}>
                The next stage needs a working tree, which this server does not
                have. Run this where the repository is checked out; it is safe to
                run twice.
              </p>
              <code className="overflow-x-auto rounded bg-ground/60 px-3 py-2 font-mono text-xs text-copy/70">
                {workerCommandFor(proposal.data.id)}
              </code>
            </SectionPanel>
          ) : null}

          <ProposalDecisions
            proposalId={proposal.data.id}
            priorityScore={proposal.data.priorityScore}
            stage={stage}
            review={reviewProposalAction}
            run={
              run.ok
                ? { id: run.data.id, errorCode: run.data.errorCode, failedAt: failedAt }
                : null
            }
            retry={retryRunAction}
          />
        </div>

        <ProposalOutline items={outline} />
      </div>
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
    <SectionPanel id="proposal-heading" title="The proposal" defaultOpen>
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
    </SectionPanel>
  );
}

/**
 * The engineering manager's half of the plan: phases as tables, then the
 * guidance as now-versus-recommendation cards. Rendered from the stored
 * document, never from model text as HTML.
 */
function Breakdown({ breakdown }: { readonly breakdown: EngineeringBreakdown }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className={eyebrow}>Engineering breakdown</h3>
        <p className={cn(prose, "text-sm")}>{breakdown.summary}</p>
        <p className="font-display text-xs text-copy/60">
          Overall size <SizeBadge size={breakdown.overallSize} />
        </p>
      </div>

      {breakdown.phases.map((phase, index) => (
        <div key={phase.name} className="flex flex-col gap-2 overflow-x-auto">
          <h4 className="font-display text-sm font-semibold text-copy">
            Phase {index + 1}: {phase.name}
          </h4>
          <p className={cn(prose, "text-sm")}>{phase.goal}</p>
          <table className="w-full text-left font-display text-xs">
            <thead className="text-copy/45">
              <tr>
                <th className="py-1 pr-3 font-medium">ID</th>
                <th className="py-1 pr-3 font-medium">Requirement</th>
                <th className="py-1 pr-3 font-medium">Size</th>
                <th className="py-1 pr-3 font-medium">Depends on</th>
              </tr>
            </thead>
            <tbody>
              {phase.requirements.map((requirement) => (
                <tr key={requirement.id} className={cn("border-t align-top", hairline)}>
                  <td className="py-2 pr-3 font-mono text-copy/60">{requirement.id}</td>
                  <td className="py-2 pr-3">
                    <p className="text-copy">{requirement.title}</p>
                    <p className="mt-0.5 text-copy/60">{requirement.description}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <SizeBadge size={requirement.size} />
                  </td>
                  <td className="py-2 pr-3 font-mono text-copy/60">
                    {requirement.dependsOn.length === 0 ? "—" : requirement.dependsOn.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <h4 className="font-display text-sm font-semibold text-copy">Technical guidance</h4>
        <ul className="grid gap-2 md:grid-cols-2">
          {breakdown.technicalGuidance.map((guidance) => (
            <li key={guidance.topic} className={cn(card, "flex flex-col gap-1.5 p-3.5")}>
              <p className="font-display text-sm font-semibold text-copy">{guidance.topic}</p>
              <p className={cn(prose, "text-sm")}>
                <span className="text-copy/45">Now: </span>
                {guidance.current}
              </p>
              <p className={cn(prose, "text-sm")}>
                <span className="text-copy/45">Recommendation: </span>
                {guidance.recommendation}
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                <ul className="font-display text-xs text-copy/60">
                  {guidance.pros.map((pro) => (
                    <li key={pro}>+ {pro}</li>
                  ))}
                </ul>
                <ul className="font-display text-xs text-copy/60">
                  {guidance.cons.map((con) => (
                    <li key={con}>− {con}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SizeBadge({ size }: { readonly size: TShirtSize }) {
  return (
    <span className="rounded-full border border-edge px-2 py-0.5 font-display text-[0.65rem] font-semibold uppercase tracking-wider text-brand">
      {sizeLabel(size)}
    </span>
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
      {note ? <p className="font-display text-xs text-copy/35">{note}</p> : null}
      {items.length === 0 ? (
        <p className="font-display text-sm text-copy/35">None.</p>
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
        <p className="font-display text-sm text-copy/35">None.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {paths.map((path) => {
            const denied = isDeniedPath(path);

            return (
              <li key={path} className="font-mono text-xs">
                <span className={denied ? "text-ember" : "text-copy/70"}>
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
      <p className="font-display text-sm text-copy/80">
        {review.action.replace(/_/g, " ")}
        {moved ? ` · ${review.previousPriority ?? "—"} → ${review.newPriority}` : ""}
        <span className="ml-2 text-xs text-copy/40">
          {review.createdAt.toISOString().slice(0, 16)}
        </span>
      </p>
      {review.comment ? (
        <p className={cn(prose, "text-sm")}>{review.comment}</p>
      ) : null}
    </div>
  );
}
