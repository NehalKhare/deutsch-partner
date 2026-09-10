# Product Ops as a multi-agent LangGraph system — proposal

Status: implemented, 2026-09-10, with the gaps listed in `docs/architecture.md`
under "What is not built" (internal-docs search behind the CPO, plan editing at
the gate, operator questions, checkpoint pruning). `docs/product-ops-agents.md`
describes what was built and how data flows through it. The text below is the
original proposal, kept as the record of the decision. It described how to move
`lib/product-ops/` from five single-shot specialists behind a hand-rolled stage
table to a LangGraph graph of tool-using agents, while keeping every property the
product-ops spec and the guardrails already demand.

## 0. What exists today, in one paragraph

`lib/product-ops/workflow.ts` is a stateless orchestrator: `advanceRun` loads a run
from Postgres, dispatches exactly one stage from a `RUNNERS` table, records a work
event, and does a compare-and-set transition. Five "agents" (`research.ts`,
`cpo.ts`, `prd.ts`, `planner.ts`, `coder.ts`) are one-shot structured calls through
`runSpecialist`: build a catalogue prompt, call the gateway, validate with Zod, repair
once. None of them has tools. The planner only sees files the workspace chose for it;
the coder is called once per planned file; the "supervisor" is the pure `nextStage`
function. The two human gates are stages that `advanceRun` refuses to leave. The
worker half runs as a CLI in a git worktree behind a path allowlist and a command
allowlist. LangChain is already in the gateway (`lib/ai/gateway/langchain-model.ts`)
for the Trainer's `createAgent` loop, and `@langchain/langgraph` 1.4.12 is installed
transitively but not used.

The design comment at the top of `workflow.ts` says "there is no graph library here"
on purpose, and business-objective.md line 615 says not to build a multi-agent swarm
without a measurable reason. Moving to LangGraph is therefore a product decision that
has to be written into the spec set, not slipped in. Section 9 lists the edits.

## 1. Design in one picture

```
              ┌──────────────────── LangGraph StateGraph (thread_id = run_id) ────────────────────┐
              │                                                                                    │
 start scan ─►│ research ─► synthesis ─► [interrupt: human_review] ─► prd ─► code_plan ─►          │
              │            [interrupt: plan_review] ─► implementation ─► verification ─►           │
              │            pull_request ─► END                                                     │
              │                                                                                    │
              │   each node = one stage = one createAgent() with tools + middleware,               │
              │   or a deterministic function where no judgement is needed                        │
              └────────────────────────────────────────────────────────────────────────────────────┘
                                   │ checkpointer                       │ events
                                   ▼                                    ▼
                    ai_run_checkpoints (new, operator scope)   ai_runs / ai_run_events (existing)
```

Two levels, and the split is the whole idea:

- **Outer graph: deterministic.** Nodes are the nine stages. Edges are the existing
  pure `nextStage` function. Routing is never a model call; the spec's "status
  transitions are functions, not prompts" stays true. The two human gates become
  LangGraph `interrupt()` calls. Durability is a custom checkpointer over Postgres.
- **Inner agents: tool-using.** Inside a node that needs judgement, a
  `createAgent()` with a small fixed tool set and a middleware stack does the work.
  Tools are how an agent asks for context instead of being handed it. Middleware is
  where the bounds live: euro budget, tool-call limit, summarisation, untrusted-content
  fencing, redaction.

There is no LLM supervisor. A supervisor that picks the next agent by reasoning would
put the stage machine behind a prompt, which the spec forbids and which nothing here
needs: the pipeline is linear with two gates.

## 2. The outer graph

### State

```ts
const ProductOpsState = Annotation.Root({
  runId: Annotation<string>,
  stage: Annotation<ProductOpsStage>,          // mirror of ai_runs.current_stage
  brief: Annotation<string>,
  proposalId: Annotation<string | null>,
  planId: Annotation<string | null>,
  spentEur: Annotation<number>,                // reconstructed from events on entry
  lastOutcome: Annotation<StageOutcome | null>,
  errorCode: Annotation<string | null>,
  // transient: what the *current* node's agent has said, summarised (see §4)
  agentSummary: Annotation<string | null>,
});
```

Postgres rows remain the source of truth for anything a human reads (proposal, PRD,
plan, changes, PR). Graph state carries ids and control flow only. A node that needs
the proposal loads it from the repository. This keeps the existing dashboard, the
timeline, the audit trail and the RLS story untouched.

### Nodes

One node per work stage. Each node body is the current `StageRunner.run` with the
specialist call swapped for an agent (section 3), and it keeps three things exactly
as they are:

1. **Idempotency check first.** "Do I already have my output?" before any model call.
2. **Work event, then compare-and-set transition** through `runs.advanceStage`. If the
   CAS is refused the node returns a `raced` outcome and the graph ends. LangGraph's
   checkpoint is a cache of progress; the database transition is the authority.
3. **Error codes only.** A node never puts a provider message into state, because
   state is checkpointed and the checkpoint table is readable by an operator.

### Gates as interrupts

```ts
function humanReview(state) {
  const decision = interrupt<ReviewPrompt, ReviewDecision>({
    kind: "proposal", proposalId: state.proposalId,
  });
  return { stage: stageAfterReview("human_review", decision.action) };
}
```

`reviewProposalAction` becomes: record the review in Postgres (as now, atomically),
then `graph.invoke(new Command({ resume: decision }), { configurable: { thread_id } })`
inside `after()`. The database review row is still written first and is still the
audit record. The interrupt is only the mechanism that parks and resumes the graph.

### Worker stages on the server

The server has no worktree. The current code "defers" those stages. In the graph, a
conditional edge after `code_plan`'s gate checks `runtime.workspace === null` and
routes to `END` with `lastOutcome = "deferred"`. The CLI worker opens the same
thread and continues. This is a property of the runtime passed in `configurable`,
exactly as the `Workspace` port is today.

### Checkpointer

Implement `ProductOpsCheckpointSaver extends BaseCheckpointSaver`
(`@langchain/langgraph-checkpoint`) over one new table:

```sql
create table public.ai_run_checkpoints (
  thread_id       uuid not null references public.ai_runs(id) on delete cascade,
  checkpoint_ns   text not null default '',
  checkpoint_id   text not null,
  parent_id       text,
  checkpoint      jsonb not null,
  metadata        jsonb not null,
  pending_writes  jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);
-- RLS on, zero policies, revoke all from anon/authenticated, like the other nine.
```

Why not `MemorySaver`: the server is serverless-shaped and `after()` callbacks die
with the instance. Why not LangGraph's Postgres saver package: it wants its own
connection string and schema management outside `supabase/migrations`, which the
migration discipline and the secret-key-only rule both forbid. A saver of ~150 lines
through the existing `DatabaseClient` keeps it inside the rules.

Retention: prune checkpoints for runs in a terminal stage after 30 days via the
existing cron pattern. The events table stays forever; the checkpoint table is a
resume cache.

### Driving

`driveRun(runId)` becomes `graph.invoke(null, { configurable: { thread_id: runId,
workspace }, recursionLimit: MAX_DRIVE_STEPS + 2 })`. One-stage-per-invocation is
preserved by the checkpointer writing after every node with `durability: "sync"`, so
killing the process between two nodes loses nothing, which is the property the spec
actually cares about.

## 3. The inner agents

All agents get their model from one new gateway function,
`createTaskChatModel(task: TaskId, context)`, a generalisation of
`createTrainerChatModel` in `langchain-model.ts`. Same registry lookup by tier, same
ledger callback, same per-request euro budget. This is the only file that changes in
the gateway and it stays on the security test's allowlist. Structured output uses
`responseFormat: providerStrategy(schema)` so the transport's json_object mode and
the existing `parseModelJson` repair path keep working.

Each agent's system prompt is a catalogue entry in `lib/ai/prompts/` (rule 4). Tool
descriptions are also prompt-shaped strings and therefore live in the catalogue too,
as a `tools` block on the entry, so they are versioned and budgeted.

### 3.1 Research agent (`productops.market_research`, cheap tier)

Tools:

| tool | does | bound |
| --- | --- | --- |
| `search_market(query)` | one web-grounded gateway call; returns fenced results and citations | the task route's `webSearch`, unchanged: the agent cannot raise `maxResults` |
| `record_finding(finding)` | validates `marketFindingSchema`, drops uncited URLs (existing `grounded()` logic), writes the row | unique `finding_hash` per run |

What changes for the product: the agent chooses its queries from the brief instead of
three fixed angles, and stops when it judges coverage is enough or the tool-call
limit stops it. Findings land as they are recorded, so a scan that dies keeps them.

Middleware: `toolCallLimitMiddleware({ search_market: 6, record_finding: 8 })`,
`modelCallLimitMiddleware({ runLimit: 10 })`, the budget middleware (section 4),
`piiRedactionMiddleware` on tool results (web pages contain emails and phone numbers
that have no business in a finding), and the untrusted-content middleware.

### 3.2 CPO agent (`productops.proposal_synthesis`, reasoning tier)

Tools:

| tool | does |
| --- | --- |
| `read_findings()` | this run's findings, fenced as `market_research` |
| `list_prior_proposals(limit)` | titles, status, problem statements: what not to re-propose |
| `search_internal_docs(query)` | the existing `lib/retrieval` retriever over the corpus: what the product already does |

Output: `productProposalSchema` as structured response. Priority score stays a pure
function of the four impact judgements, as now.

Middleware: `summarizationMiddleware` (section 4), tool-call limit 8, budget.

### 3.3 PRD node — no agent

`prdSections` is one structured call over an approved proposal and the document is
rendered from columns. Wrapping it in an agent adds cost and no information. It stays
a plain node calling `runSpecialist`. Not everything needs a tool loop.

### 3.4 Planner agent (`productops.code_plan`, reasoning tier)

This is where the multi-agent move earns its keep. Today the workspace guesses which
files the planner should see. Instead:

| tool | does | bound |
| --- | --- | --- |
| `list_files(glob)` | paths under the worktree matching a glob | deny-list applied to the listing; max 200 paths |
| `read_file(path)` | contents, fenced as `repo_source` | must pass the path checks in `apply.ts`; max 24 KB per read |
| `search_code(pattern)` | fixed-string grep via the command allowlist (`git grep -F`) | max 50 hits, never a regex from the model |
| `read_prd()` | the stored PRD | — |

Output: `implementationPlanSchema`. Paths that the deny-list would refuse are
reported to the reviewer, as now.

Middleware: `toolCallLimitMiddleware({ read_file: 12, search_code: 8, list_files: 6 })`,
`summarizationMiddleware` (source files are big and the reasoning tier's input
ceiling is 12000), budget, untrusted-content.

### 3.5 Coder agent (`productops.code_edit`, reasoning tier)

| tool | does | bound |
| --- | --- | --- |
| `read_file(path)` | as planner | only paths in the **approved** plan's lists |
| `propose_edit({path, edits})` | runs the trusted validation layer in `apply.ts`, applies or rejects, records a `code_changes` row | anchor matches exactly once, deny-list, size caps, path in approved plan |
| `run_gate()` | `pnpm verify` via the command allowlist; returns exit status and fenced, truncated output | at most 2 calls per run: the spec's "one repair pass" |

The 2000-token output ceiling still means anchored edits. A tool argument is still
model output; `propose_edit` is where the anchored-edit schema is enforced.

The agent decides the order it edits files in and reads what it needs. It does not
decide *which* files exist in the plan, does not run arbitrary commands, and cannot
touch a path outside the approved lists. The isolation is unchanged: worktree,
allowlist, no shell.

Middleware: `toolCallLimitMiddleware({ propose_edit: 20, run_gate: 2 })`,
`summarizationMiddleware`, budget, untrusted-content (gate output is fenced as
`command_output`).

### 3.6 Release node — no agent

Branch push and PR creation are deterministic and idempotent. They stay a plain node
over `lib/github/client.ts`.

## 4. Middleware, and what each one is for

| middleware | source | purpose |
| --- | --- | --- |
| `runBudgetMiddleware` | custom `createMiddleware`, `beforeModel` | reconstructs `runSpendEur` from `ai_run_events` plus this invocation's ledger rows and throws `RunBudgetExhausted` before the next model call. Durable, as the spec requires. Replaces nothing: the gateway's per-request budget and the four persisted scopes still sit underneath. |
| `untrustedContentMiddleware` | custom, `wrapToolCall` | wraps every tool result in its delimiter tag (`web_results`, `market_research`, `repo_source`, `command_output`) with closing tags escaped, using the existing block builder in `lib/ai/prompts/blocks.ts`. The one place fencing happens, so no tool can forget. |
| `summarizationMiddleware` | langchain | when the transcript nears the task's input ceiling, replaces older tool results with a summary. The summary call is itself a task: add `productops.context_summary` on the nano or cheap tier to `lib/ai/tasks.ts` and route the middleware's model through the gateway. Never summarise the system prompt or the PRD; `keep: { messages: 4 }` plus a token trigger at 70 percent of the ceiling. |
| `toolCallLimitMiddleware` | langchain | per-tool and per-run caps from section 3; exceeding one ends the agent as a typed failure, never a hang |
| `modelCallLimitMiddleware` | langchain | hard cap on model calls per stage, second line behind the budget |
| `piiRedactionMiddleware` | langchain | emails, phone numbers, IPs out of web results before they reach the model or a row |
| `humanInTheLoopMiddleware` | langchain | see section 5; used on the coder's `run_gate`? **No.** Used for plan editing at the plan gate only. |
| `modelFallbackMiddleware` | langchain | the tier's same-tier ladder, the way the Trainer already does it |

Order matters: budget and limits first, summarisation before the model, redaction and
fencing on tool results.

## 5. Human in the loop: what changes for the operator

The two gates stay exactly where the spec puts them. Three things get better.

1. **Edit, not just approve or reject.** At `plan_review`, `humanInTheLoopMiddleware`
   style decisions apply: `approve`, `reject`, and `edit`. An edit lets the operator
   remove files from the plan or add a note before approving. The edited plan is what
   is stored as `approved`, and therefore what the coder's path allowlist is. Today an
   operator who dislikes one path has to reject the whole plan. Editing is safer than
   approving quickly, which the spec names as the failure mode.
2. **Answer a question.** An agent that is stuck can call `ask_operator(question)`,
   which raises an `interrupt`. The graph parks at the current stage with owner
   `operator`, the board shows the question, and the reply resumes the graph. Bound it:
   one question per stage, and the reply is fenced like any other untrusted input.
   This is optional and gated by a flag in the run, because it turns a background
   pipeline into a conversation.
3. **A live agent timeline.** `graph.streamEvents` emits tool starts and ends. Write
   each as a `ai_run_events` row with `status: 'progress'`, detail `{ agent, tool,
   costEur }`, never arguments or results. The existing `RunActivityPanel` then shows
   "planner read 4 files, searched twice" instead of "planning the change", and
   `updated_at` moves on every tool call, so the stall detector stops flagging a slow
   but healthy planner. The new event status needs a `CHECK` constraint change.

Nothing gets a third gate. A PR is never opened from a run whose plan was not
approved, and that is still enforced in trusted code, not by an interrupt.

## 6. Cost and routing changes

New rows for `lib/ai/tasks.ts`, all inside their tier's ceilings:

| task | tier | in | out | why |
| --- | --- | --- | --- | --- |
| `productops.context_summary` | cheap | 8000 | 400 | summarisation middleware |
| `productops.operator_question` | none | — | — | not a model task; listed so the action is auditable |

Existing five tasks keep their tiers. Expect the research and planning stages to cost
more per run because they make more calls; the per-run euro caps in `RUN_BUDGET_EUR`
should start at 1.0 for a scan and 2.0 for an implementation and be tuned from traces.
The web-plugin cost still lands on the ledger row through the transport.

## 7. Tests the move has to keep green, and the new ones

Keep: everything in section 15 of the spec. The state machine tests move from
`nextStage` plus `RUNNERS` to `nextStage` plus the graph's edge table; assert the
compiled graph's nodes equal the stage union exactly.

New:

- graph resumes from a checkpoint after a simulated crash between two nodes and does
  not repeat the finished node's model call (assert on the fake gateway's call count)
- an interrupt at each gate parks the run; `Command({resume})` with `reject` ends the
  graph; with `approve` continues
- each tool refuses what its bound says: `read_file` outside the approved plan,
  `search_code` with a regex metacharacter, `run_gate` a third time
- every tool result arrives fenced and with its closing tag escaped
- the budget middleware stops a run whose events already sum to the cap before the
  first model call
- summarisation never removes the system prompt or the PRD message
- the checkpoint table has RLS on with zero policies and authenticated is denied
- no checkpoint contains a string matching the provider-error or prompt patterns

## 8. Build order

1. `createTaskChatModel` in `langchain-model.ts` plus tests. Small, unblocks all else.
2. The two custom middlewares (budget, fencing) with tests. No graph yet.
3. Planner agent with tools, still called from the existing `codePlan` runner. This
   is the highest-value node and proves the pattern inside the current orchestrator.
4. Checkpoint table, saver, migration, RLS tests.
5. Outer graph with interrupts; port `driveRun` and `applyReview`; keep `advanceRun`
   as a thin wrapper until the dashboard tests pass on the graph.
6. Research and CPO agents.
7. Coder agent replacing per-file `proposeCodeEdit`.
8. Plan editing at the gate, progress events, operator questions.

Each step is shippable on its own and leaves `pnpm verify` green.

## 9. Documents to change first

- `.claude/docs/product-ops-spec.md` section 1: "The orchestrator is stateless" becomes
  "The orchestrator holds no state outside Postgres. A graph runtime may checkpoint
  control flow there; rows remain the truth for every artifact." Section 3 gains the
  `progress` event status. Section 11 gains the tool table and the `edit` decision.
- `.claude/docs/business-objective.md` line 615: record the measured reason. The
  honest one is that the planner cannot choose its own context today and the coder
  cannot read a second file, and both show up as `all_paths_denied` and
  `anchor_not_found` failures in the timeline. Pull those counts before writing the
  sentence, so it is measured and not asserted.
- `docs/architecture.md` "What is not built": remove the multi-agent line when step 5
  lands, not before.
- `package.json`: promote `@langchain/langgraph` and `@langchain/langgraph-checkpoint`
  to direct dependencies. They are already in the lockfile.
