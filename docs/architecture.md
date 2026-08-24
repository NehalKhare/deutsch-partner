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
  │
learning/       the curriculum, and the engines that move a learner through it
domain/         Zod schemas and pure rules. No I/O.
repositories/   the only code that touches the database
  │
supabase/       25 migrations: 22 tables, Row Level Security, and the
                functions that have to be atomic
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

None of them is `SECURITY DEFINER`. A migration test fails the build if one
appears.

Repositories validate every row against the domain schema on the way out.
Generated database types describe what the schema said at build time; this
checks what the database actually returned.

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

**2519 unit and integration tests, 135 test files** — plus 31 Python tests
over the scenario parser and ingestion plan (`pnpm scenarios:test`).

| Kind | What it runs against |
| --- | --- |
| Unit | Pure functions, schemas, prompt assembly, scoring, the graph with fakes |
| Database | Real Postgres in-process via PGlite — 25 migrations, constraints, RLS, and the functions above |
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
- **No golden eval sets.** Every prompt entry declares one; none is written.
  Which tier each task belongs on is the routing document's judgement, unmeasured.
- **Rate limiting is in-memory.** Per instance, and forgiving on restart. The
  interface is what a Redis backing swaps into.
- **No pricing snapshot job and no FX snapshot job.** Both tables are read
  correctly and both degrade correctly when empty.
- **Voice calls are not budgeted or ledgered.** Every other model call in the
  product is routed, capped, priced and written to an append-only ledger.
  Transcription and speech are not: they are billed per minute and per
  character, which the token-shaped rate table cannot express, and closing that
  gap was deliberately deferred. Until it is closed, the rate limits
  (10 transcriptions and 20 readings a minute) and the audio bounds (60 seconds,
  15 MB, 1000 characters) are the *only* ceiling on voice spend. That is a
  smaller hole than it sounds and a real one.
- **Speech needs an OpenAI key.** OpenRouter carries all chat, completion and
  embedding traffic, but lists no speech-to-text or text-to-speech model at
  all — so `/api/transcribe` and
  `/api/speak` go direct to OpenAI. Without `OPENAI_API_KEY` the microphone
  reports that speaking is unavailable, and reading a reply aloud falls through
  to the browser's own voice, which needs no key and costs nothing.
- **`extraction.errors` and `evaluation.learner_message` overlap.** Both return
  error instances against the same taxonomy. Whether the separate pass earns its
  call is a measurement nobody has taken.
