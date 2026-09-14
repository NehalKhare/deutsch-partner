# Architecture

## The layers

```
app/            Next.js routes, pages and the one API endpoint
components/     React components
  │
lib/graph/      one learner turn, as small nodes
lib/api/        request handling: validation, rate limiting, streaming
lib/dashboard/  server-side aggregation for both dashboards
  │
lib/ai/         everything that talks to a model
  ├─ prompts/     the versioned prompt catalogue and its builder
  ├─ gateway/     the only code allowed to call a provider
  ├─ evaluation/  scoring a learner message
  └─ voice/       speech in and out
lib/retrieval/  vector + lexical search, fused and ranked
lib/ingestion/  the corpus pipeline
lib/scenarios/  scenario practice: quiz grading, roleplay seeding
lib/product-ops/  the operator workflow: a LangGraph state graph over the
                stages, four tool-using agents inside them, the trusted
                validation layer the coder writes through
lib/github/    five REST calls, for the pull request the worker opens
  │
learning/       the curriculum, and the engines that move a learner through it
domain/         Zod schemas and pure rules. No I/O.
repositories/   the only code that touches the database
  │
supabase/       36 migrations: 34 tables, Row Level Security, and the
                functions that have to be atomic
scripts/        the offline workers: corpus ingestion, the FX snapshot, and
                the product-ops coding worker
scripts/scenarios/  offline Python: parse the scenario dataset, embed it,
                    evaluate retrieval with ragas
```

Dependencies point downwards. `domain/` imports nothing from above it;
`repositories/` returns domain types and never lets a Postgres error escape;
`lib/ai/gateway/` is the only directory that may open a connection to a model.

## Four rules with tests behind them

These are not conventions. Each one is a CI test that fails the build.

**1. Only the gateway may reach a model.** No file outside `lib/ai/gateway/`
may import a provider SDK or construct a request to a model endpoint. Inside the
gateway, exactly three named files may — one per provider the application
actually talks to. Ceilings, budgets, accounting and redaction cannot be
guaranteed if any module can open its own connection.

**2. No hardcoded model id outside the registry.** Application code names a
*tier* — `strong`, `mid`, `cheap`, `nano` — and one file maps tiers to models.
Swapping a model is an operations change.

**3. No hardcoded price.** Prices come from the provider's list with a
`fetched_at` stamp. A number written into code is a number that goes quietly
wrong.

**4. Prompts live in the catalogue.** No prompt-shaped string literal outside
`lib/ai/prompts/`. A prompt at its call site cannot be versioned, budgeted, or
found when quality moves.

> `tests/security/ai-boundaries.test.ts`

## The model gateway

Every model call in the application goes through one object, and it enforces
four layers in order:

| Layer | What it does | Where |
| --- | --- | --- |
| 1 | Counts tokens on the assembled prompt; sheds context in a fixed order; refuses rather than sending an oversized prompt | `budgeter.ts`, `builder.ts` |
| 2 | Always sends the provider's max-output parameter | `openrouter.ts` |
| 3 | Counts tokens as they stream and aborts at the ceiling even if the provider ignores layer 2 | `stream-guard.ts` |
| 4 | Checks euro budgets before dispatch and fails closed | `budget-gate.ts` |

Then it writes **exactly one ledger row per call**, on success and on failure
alike, because a failed call that produced tokens still cost money. The ledger
is append-only, enforced by a database trigger, and holds a pseudonymous hash
rather than a user id — financial history has to survive an account deletion,
so it must never have been able to identify anyone in the first place.

Budgets run at four scopes (per request, per user daily, per user monthly,
global daily) with thresholds at 70% warn, 90% degrade, 100% deny. Degrading
drops the tier one step and halves the output ceiling; denying makes no call at
all. Counters are incremented in the same transaction as the ledger row, so
they cannot drift from it.

### The task table

Nineteen tasks, each pinned to a tier and two token ceilings:

| Task | Tier | In | Out |
| --- | --- | --- | --- |
| `conversation.turn` (A1 / A2 / B1) | strong | 4000 / 5000 / 6000 | 300 / 450 / 700 |
| `evaluation.learner_message` | mid | 3000 | 800 |
| `extraction.errors` | cheap | 2000 | 400 |
| `summarization.thread` | cheap | 6000 | 400 |
| `classification.intent` | nano | 800 | 20 |
| `ingestion.embedding` / `retrieval.embedding` | embedding | 8191 | 0 |

A task that is not in the table does not get to call a model.

> `lib/ai/tasks.ts`, `lib/ai/gateway/`

## Data access

Every table a learner owns has Row Level Security enabled with an ownership
predicate, and every `UPDATE` policy carries both `USING` and `WITH CHECK` — the
second is what stops a learner reassigning a row to somebody else.

Anything that must be atomic, or that must derive the owner from the session
rather than from a parameter, is a `SECURITY INVOKER` database function with no
learner-id argument:

| Function | Why it exists |
| --- | --- |
| `complete_onboarding` | Profile and state must land together |
| `start_conversation_thread` | A thread must carry the level its learner is actually at |
| `record_level_turn` | Two turns finishing at once must count as two |
| `record_learner_error` | Merging a recurring mistake has to be one statement |
| `record_model_invocation` | The ledger row and its budget counters move together |
| `ingest_document` | A half-written document answers from text it no longer contains |
| `learner_dashboard` | Six queries and a reduce in React is six chances to disagree |
| `search_knowledge_vector` / `_lexical` | Filter by level before ranking, not after |
| `search_scenarios` | The scenario corpus's vector search: filter by type and level before ranking |
| `cost_dashboard` | Operator-only; granted to nobody but the secret key |
| `advance_product_ops_run` | A stage transition is a compare-and-set: two workers racing must not both win |
| `record_proposal_review` | The review row, the proposal's status and the plan's approval move together |
| `product_ops_dashboard` | Operator-only; the board is one query rather than six that can disagree |

None of them is `SECURITY DEFINER`. A migration test fails the build if one
appears.

Repositories validate every row against the domain schema on the way out.
Generated database types describe what the schema said at build time; this
checks what the database actually returned.

## The operator workflow

A second product, on the same stack, reachable only by the `OPERATOR_USER_IDS`
allowlist: research the market, propose a feature, ask a person, write a PRD,
plan an implementation, ask a person again, write the code, open a pull
request.

```
research → synthesis → human_review → prd → code_plan → plan_review
         → implementation → verification → pull_request → completed
```

The pipeline is a LangGraph state graph (`lib/product-ops/graph/`): one node
per stage, edges from the pure `nextStage` function, the two human gates as
`interrupt()` calls, and a checkpoint saver over two operator-scope tables so a
parked graph is resumed by whichever instance handles the operator's decision.
No model ever chooses the next node. Inside four of the nodes a tool-using
LangChain agent does the judgement — research, the CPO, the planner, the coder
(`lib/product-ops/agents/`) — each on the tier its task declares, with a
middleware stack that bounds it: the run's euro budget, tool and model call
caps, a fence around every tool result, a progress event per tool call and per
model call, and summarisation of an overlong transcript. The board follows a
working run's timeline live over Server-Sent Events, read forward from
Postgres rather than from the driving process, which need not be the one
serving the page. A failed run can be tried again from the stage that
failed, through the same compare-and-set and under the same euro ceiling.
`docs/product-ops-agents.md` draws the data flow.

Five properties hold it together.

**The orchestrator holds no state outside Postgres.** A node runs exactly one
stage through `advanceRun` — the idempotency check, the work event, the
compare-and-set transition — and the graph checkpoints after it. The checkpoint
carries identifiers and control flow; every artifact is re-read from its row.
Pausing, resuming, retrying and auditing are therefore the same mechanism
rather than four, and nothing in the workflow is a long-running request.

**Every stage is idempotent.** Each checks for its own output before doing any
work — this run's finding hashes, this run's proposal, this proposal's PRD, this
plan's recorded changes, this branch's pull request — and reports
`already_done` rather than repeating it. Uniqueness is a database constraint
in every case, not a check-then-write, because a constraint holds under
concurrency.

**Who moves a run is a property of its stage.** `stageOwner` answers with one
of four: the server, a person, the CLI worker, or nobody. The orchestrator
dispatches on it and the dashboard renders from it, so a run cannot look stuck
on a screen while something is quietly doing it. The four worker stages are the
ones that need a working tree, which the server does not have; it defers them
and the board says so.

**A stage that is running and one that was abandoned are the same stage.** Only
the clock separates them, so the board carries each run's `updated_at` — every
transition touches it — and quiet for longer than the slowest stage is reported
as stalled rather than working. That distinction is what the page's polling is
bounded by: it asks again only while something is genuinely moving, so a tab
left open on a run whose drive died stops querying within one stall window
without any counter or deadline in the browser. A spinner that turns forever
over dead work is worse than no spinner, because it teaches an operator to
distrust the only signal that means something is wrong.

**Deciding and operating are two pages.** `/operations/product` is the proposal
board, and nothing on it moves on its own; `/operations/product/runs` holds the
scan form, the run cards that follow their own timelines live, and the
learner-feedback aggregate. The split is what lets the runs page poll itself
every few seconds without redrawing the page an operator is reading a proposal
on. Both are dynamic routes, and a dynamic route is prefetched only as far as
its nearest loading boundary, so each has a `loading.tsx`: without one the
switch between them is a wait on a blank page rather than a click.

**Nothing writes a file without two approvals.** The proposal is approved before
a PRD exists, and the plan is approved before a file is written. The approved
plan's file lists become the coding agent's path allowlist, checked in trusted
code before every write, with a deny-list that overrides the plan regardless —
`.env*`, migrations, CI, the gateway, the prompt catalogue, the security tests,
the dependency manifests, `proxy.ts`. The agent has no shell, no way to name a
command, and no way to name a URL.

> `lib/product-ops/graph/graph.ts`, `lib/product-ops/workflow.ts`,
> `lib/product-ops/agents/`, `lib/product-ops/apply.ts`,
> `scripts/product-implement.ts`, `lib/dashboard/product-ops.ts`,
> `docs/product-ops-agents.md`, `.claude/docs/product-ops-spec.md`

## Two Supabase clients, deliberately

The request-scoped client carries the learner's session, so Row Level Security
decides what is reachable and a bug cannot reach another learner's thread. The
secret-key client bypasses RLS and is used for exactly two things: the
accounting tables, which have RLS on and no policy at all, and the shared
embedding cache.

Which client a piece of code gets is an explicit argument at the composition
root, not a default.

> `lib/api/composition.ts`

## Testing

**3603 unit and integration tests, 182 test files** — plus 31 Python tests
over the scenario parser and ingestion plan (`pnpm scenarios:test`).

| Kind | What it runs against |
| --- | --- |
| Unit | Pure functions, schemas, prompt assembly, scoring, the graph with fakes |
| Database | Real Postgres in-process via PGlite — every migration, constraints, RLS, and the functions above |
| Security | Static gates over the source tree: the four architecture rules, secret exposure, migration hygiene |
| End to end | Playwright against a production build |

The database tests are the interesting ones: they apply every migration to a
real Postgres engine, then try to read another learner's rows as that learner
and require it to fail.

### Mutation testing

Every phase is gated on it. A change is deliberately broken in the source and
the suite must fail; if it passes, the test was decoration. Roughly 360
mutations have been run across the project so far. The ones that *survived*
were the most useful — each pointed at a test that looked like coverage and was not, and
several pointed at real bugs:

- the machine-register identity block had been shipping truncated mid-sentence
  for three phases, because the version lock hashed the intended text while the
  builder shipped the rendered one
- the retrieval scorer's above-level penalty was untested, because the test that
  looked like it varied the CEFR band rather than the direction
- the document hash's separator was untested, because the example chosen for it
  happened to differ either way

## What is not built

Stated here so nobody has to discover it by reading the code.

- **Product ops ends at the plan.** Accepting a plan completes the run; the
  operator copies the plan as Markdown and carries it into their own tools.
  The plan is two documents from two calls: the file lists, which are the
  coding agent's allowlist, and an engineering breakdown — phased, sized
  requirements with technical guidance against the current stack.
  The implementation, verification and pull-request stages, the coding agent,
  the apply layer and the CLI worker all exist and are tested, but no review
  leads into them. Planning runs on the server, reading the checkout it runs
  beside; a deployment without one fails the planning stage with
  `no_repository`.

- **No chat model has ever been called.** Every test drives a fake transport;
  the real transports are tested against a fake `fetch`. The embedding
  pipelines, by contrast, *have* run for real: both corpora — 599 knowledge
  chunks and 50 scenarios — are embedded on the linked project, through
  OpenRouter, with a ledger row per call.
- **Offline scenario ingestion is not ledgered.** `pnpm scenarios:ingest` is
  Python and calls the embedding provider directly, outside the gateway, so
  its calls are not written to the usage ledger or counted against the euro
  budgets — the run prints its token usage instead. Request-time scenario
  *search* embeds through the gateway and is ledgered, budgeted and cached
  like every other call.
- **Learner feedback informs a scan; nothing acts on it automatically.** The
  aggregate of trainer votes is on the product-ops scans and runs page and
  enters every scan as an internal finding, so a prompt version that is losing shows up in
  a proposal a person reviews. No job compares prompt versions, alerts on a
  rising unhelpful share, or proposes a prompt edit on its own — the prompt
  layer is on the coding agent's deny-list on purpose.
- **No golden eval sets.** Every prompt entry declares one; none is written.
  Which tier each task belongs on is the routing document's judgement, unmeasured.
- **Rate limiting is in-memory.** Per instance, and forgiving on restart. The
  interface is what a Redis backing swaps into.
- **No pricing snapshot job.** `model_pricing_snapshots` is read correctly and
  degrades correctly when empty, and it is still empty: it is the fallback for a
  provider that reports no cost of its own, and OpenRouter reports one on every
  call the gateway makes. So the estimator behind the budget gate has nothing to
  read, and a provider that went quiet about cost would be recorded as free.
  The FX snapshot job it was listed beside now exists — `pnpm fx:refresh`,
  snapshotting the ECB daily reference rate, which is what the euro column on
  the cost dashboard is derived from. Its absence was not a degraded figure but
  a wrong one: with the rate table empty, every ledger row ever written declared
  itself unpriced and the dashboard reported months of real dollars as €0.0000.
  The cost dashboard also reads the source itself, at most once a day, and
  carries a control to ask again — the rate publishes in the afternoon.
- **Rows written before the first rate are converted for display, not fixed.**
  They carry no rate and the ledger is append-only, so their stored `cost_eur`
  stays zero for good. The dashboard converts their dollars at the newest rate
  so the page can answer "what did this cost in euro", keeps that figure apart
  from what was actually charged, and says which is which. It is right about
  the magnitude and cannot be right about the day.
- **Voice calls are not budgeted or ledgered.** Every other model call in the
  product is routed, capped, priced and written to an append-only ledger.
  Transcription and speech are not: they are billed per minute and per
  character, which the token-shaped rate table cannot express, and closing that
  gap was deliberately deferred. Until it is closed, the rate limits
  (10 transcriptions and 20 readings a minute) and the audio bounds (60 seconds,
  15 MB, 1000 characters) are the *only* ceiling on voice spend. That is a
  smaller hole than it sounds and a real one.
- **Speech rides OpenRouter, in a chat model's clothing.** It once could not:
  the router listed no speech model, so voice went direct to OpenAI on a second
  key. It now serves audio-capable chat models, so `/api/speak` and
  `/api/transcribe` go through the same key as everything else — at the cost of
  a shape. Audio output arrives only from a stream and only as headerless
  `pcm16`, so `lib/ai/voice/openrouter.ts` wraps the samples in a WAV container
  at the edge; and a chat model asked to read a line will read it and then
  remark on having done so, out loud, unless told firmly not to
  (`lib/ai/prompts/voice.ts`). Without `OPENROUTER_API_KEY` the microphone
  reports that speaking is unavailable, and reading a reply aloud falls through
  to the browser's own voice, which needs no key and costs nothing.
- **`extraction.errors` and `evaluation.learner_message` overlap.** Both return
  error instances against the same taxonomy. Whether the separate pass earns its
  call is a measurement nobody has taken.
- **Product-ops has run against a real provider only as far as synthesis.**
  The first real scans surfaced four failures the fakes could not: a
  30-second call timeout that the reasoning tier's proposal overran, proposals
  the 2000-token output ceiling cut off, PRD sections the mid tier's
  1000-token ceiling cut off, and then the mid-tier model thinking that same
  ceiling away before answering. All four are handled — per-tier timeouts and
  same-tier fallthrough on transient errors, a truncation repair, a
  compact-answer instruction in the CPO prompt, a PRD contract sized to its
  ceiling, and a bounded reasoning effort on the mid tier — and one real
  proposal has been reviewed and approved. The
  stages from planning onward are tested against fakes only. No branch has
  been pushed and no pull request opened.
- **The coding worker is a git worktree, not a container.** Isolation is the
  worktree, the path allowlist and the absence of a shell. A container is the
  documented next step rather than a gap being hidden — and the controls that
  actually hold in the meantime are the allowlist and the two human gates, not
  the isolation.
- **Prompt injection through web results and repository source is mitigated,
  not prevented.** Both are fenced as untrusted content and neither carries
  authority over the plan, the allowlist or the deny-list. That is a mitigation
  by the guardrails' own definition.
- **The CPO's `search_internal_docs` tool answers "unavailable".** The tool
  exists and the agent is told about it, but the composition wires no corpus
  behind it: the retriever wants a learner-shaped context the CPO does not
  have. Adapting it is the obvious next thing to do.
- **A plan is approved whole or rejected whole.** The gate does not yet let an
  operator drop files from the plan's lists before approving, which is the
  safer version of a quick approval. The graph's gate node is where that
  decision would be applied.
- **No agent has run against a real model.** The agents are tested with a fake
  tool-calling model and the specialists with a fake gateway. Without models
  supplied, every stage falls back to its single-shot specialist, which is the
  path the workflow tests exercise.
- **Checkpoints are never pruned.** A run's checkpoints go with the run, and
  nothing retires finished runs. A cron over terminal runs older than a month
  is the missing job.
- **A feature needing a migration stops at the PRD.** The deny-list refuses
  `supabase/migrations/**` whatever the plan says, so a schema change is
  described in the document and written by a person. Per-run operator opt-in is
  the extension point.
- **The runs page polls; nothing is pushed.** While a run is moving, the
  page asks the server again every few seconds. Postgres can push this — a
  realtime subscription on `ai_run_events` is the obvious version — and the
  reason it does not is that the polling stops on its own: a run that goes
  quiet is reported as stalled and no longer asked about. So the cost is a
  handful of indexed queries per run rather than an open connection per
  operator, for a page with a handful of operators. It is a deliberate trade at
  this size and the wrong one at a larger size.
