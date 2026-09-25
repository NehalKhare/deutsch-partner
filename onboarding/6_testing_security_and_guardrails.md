# 7. Testing, Security and the Guardrail Harness

The hands-on companion to document 1's sections 5 and 6. Those sections explain *what* the tests and guardrails are. This document shows *how* to write each kind of test, how the fakes work, how the CI gates are built and extended, how one request is defended at every layer, and where to look when something breaks. Every example is copied from a real file in the repository.

---

## 1. The test layers and where they run

| Layer | Runner | Environment | Where | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest | Node | `packages/*/tests/*.test.ts`, `apps/*/tests/unit/**` (non-React) | `pnpm turbo run test --filter=@dp/<pkg>` |
| Component | Vitest | jsdom + React Testing Library + MSW | `apps/*/tests/unit/**/*.test.tsx`, `packages/ui/tests` | same |
| Database | Vitest | PGlite (real Postgres in WebAssembly) | `*/tests/db/*.test.ts` | `pnpm test:db` |
| Security | Vitest | Node, static scan of source text | `packages/security-tests/tests` | `pnpm turbo run test --filter=@dp/security-tests` |
| End to end | Playwright | Real Chromium against a production build | `apps/learner/tests/e2e/*.spec.ts` | `pnpm test:e2e` |
| Python | pytest | uv | `apps/learner/scripts/scenarios/tests` | `pnpm scenarios:test` |

Every package's `vitest.config.mts` composes presets from `packages/config/vitest/base.ts`. There are three: `nodeProject`, `jsdomProject` and `dbProject`. The presets turn `globals` off (import `describe`, `it`, `expect` from `vitest`), clear and restore mocks between tests, and give the database project `fileParallelism: false` because two PGlite engines starting at once starve each other.

`pnpm verify` runs all of it except e2e and Python, through Turborepo, and is the definition of done.

---

## 2. Writing a unit test

A unit test drives a pure function or a module whose dependencies are injected. The pattern everywhere in this codebase is: build the dependencies as plain objects, hand them in, assert on what came back and on what the fakes recorded.

### 2.1 A pure function

```ts
import { describe, expect, it } from "vitest";
import { fuse } from "@/lib/retrieval/fusion";

describe("reciprocal rank fusion", () => {
  it("scores a chunk found by both arms above one found by one", () => {
    const shared = { id: 1, /* ...candidate fields */ };
    const vectorOnly = { id: 2, /* ... */ };
    const fused = fuse([
      { results: [vectorOnly, shared], weight: 1 },
      { results: [shared], weight: 1 },
    ]);
    expect(fused[0]?.id).toBe(1);
  });
});
```

Nothing to mock. Most of `packages/domain`, `packages/learning` and `packages/prompts` tests look like this.

### 2.2 A module with a fake gateway

The whole chat turn runs with no database and no network because every node takes its dependencies as arguments. `apps/learner/tests/unit/graph/fixtures.ts` builds them:

```ts
export function fakeGraph(overrides = {}) {
  const recordedErrors = [];
  const recordedTurns = [];
  const deps: GraphDeps = {
    learners: { getProfile: async () => ok(PROFILE), getState: async () => ok(STATE), ... },
    conversations: { getThread: async () => ok(THREAD) },
    errors: { listUnresolved: async () => ok([]), record: async (e) => { recordedErrors.push(e); return ok(null); } },
    retriever: { retrieve: async () => gatewayOk({ chunks: [CHUNK], considered: 1, costEur: 0, ranked: [] }) },
    evaluator: { evaluate: async () => gatewayOk(EVALUATION) },
    gateway: { stream: async () => gatewayOk(streamOf("Guten Tag! Wohin fährst du?")), complete: ... },
    ...overrides,
  };
  return { deps, recordedErrors, recordedTurns };
}
```

Then `turn.test.ts` asserts behaviour, not implementation:

```ts
it("runs every node in the order the build spec lays out", async () => {
  const { deps } = fakeGraph();
  const outcome = await runTurn(INPUT, deps);
  if (!outcome.ok) return;
  for await (const _chunk of outcome.turn.chunks) void _chunk;   // drain the stream
  const state = await outcome.turn.completed;                    // wait for the after-stream nodes
  expect(state.notes.map((n) => n.node)).toEqual([
    "load_state", "load_thread", "place", "advance", "retrieve",
    "generate", "evaluate", "persist_evaluation", "record_vocabulary", "record_performance",
  ]);
});

it("keeps the reply in turn state and writes it nowhere", async () => {
  // The dependency surface has no way to store a message even if a node wanted to.
  expect(deps.conversations).not.toHaveProperty("appendMessage");
});
```

**What to notice:** the test proves a *property* (no node can store a message) by asserting the shape of the dependency object, not by spying on a call. To test "retrieval failed but the reply still streams", pass `overrides: { retriever: { retrieve: async () => gatewayFail("provider_unavailable") } }` and assert the note on the `retrieve` node reads `degraded`.

### 2.3 The gateway with a fake transport and a recording ledger

`packages/gateway/tests/gateway.test.ts` shows how to test the thing that talks to a provider without a provider:

```ts
function recordingLedger() {
  const rows: LedgerRow[] = [];
  const ledger: UsageLedger = { async record(row, batch) { rows.push(row); return { ok: true, id: rows.length }; } };
  return { ledger, rows };
}

function transportReturning(text: string): ModelTransport & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return { requests, async complete(request) { requests.push(request); return { text, usage: usage(), firstTokenMs: 12 }; }, ... };
}

it("writes exactly one ledger row on success", async () => {
  const { ledger, rows } = recordingLedger();
  const gateway = createModelGateway({ transport: transportReturning("Hallo"), ledger, ... });
  await gateway.complete(callSpecFor("conversation.turn", "A1"), PROMPT, CONTEXT);
  expect(rows).toHaveLength(1);
});
```

The budget gate is tested the same way: `budgetsAt({ "hash-alice": 0.95 })` returns a snapshot at 95% and the test asserts the transport was asked for a lower tier and a halved ceiling; at 1.0 it asserts `transport.requests` is empty and the ledger row has `status: "budget_denied"`.

### 2.4 The version lock on prompts

`packages/prompts/tests/prompt-versioning.test.ts` holds a table of fingerprints:

```ts
const RECORDED = {
  "conversation.turn@5/A1": "7e503226",
  "conversation.turn@5/A2": "61631c4b",
  ...
};
```

Each entry's rendered text is hashed and compared. Edit a word and this test fails with a message spelling out the two legitimate fixes: update the hash for a cosmetic change, or bump the entry's version and add the new hash. The comments above each version are the changelog; keep writing them.

### 2.5 A golden set

`apps/learner/tests/unit/ai/trainer-analysis-golden.test.ts` reads `tests/golden/trainer-answer-analysis.json`: a list of cases with a learner's answer, whether the gate should analyze it, and the expected verdict. It is **deterministic**: no live model is called. What it holds down is everything around the model: the gate's decisions, the schema over realistic verdicts, the pipeline from a raw completion to a typed outcome. The same file is shaped so a live-eval runner could feed a real model and compare. It is the only golden set that exists; every other prompt entry declares one and has none. Writing them is the highest-value open work (document 6).

---

## 3. Writing a component test

Component tests render React in jsdom and interact the way a user would: by role and name, never by CSS class.

`apps/learner/tests/unit/chat/thread-list.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("does not delete on the first click", async () => {
  const action = vi.fn(noop);
  const user = userEvent.setup();
  render(<ThreadList threads={THREADS} action={action} />);
  await user.click(screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }));
  expect(action).not.toHaveBeenCalled();     // it asked first
});

it("names the conversation in its delete control", () => {
  // Two buttons both called "Delete" are two buttons a screen-reader user cannot tell apart.
  expect(screen.getByRole("button", { name: /delete .*Im Café bestellen/i })).toBeInTheDocument();
});
```

**Rules that the shared setup enforces** (`packages/test-support/src/setup-jsdom.ts`, loaded by each app's `tests/setup.ts`):

- **No network.** MSW starts with `onUnhandledRequest: "error"`. A component that fetches something you did not mock fails the test rather than silently reaching the internet. Register handlers per suite with `server.use(http.post("/api/chat", () => HttpResponse.text("Hallo")))`.
- **Clean slate.** `cleanup()` unmounts after each test and `localStorage.clear()` runs, because storage outlives a render and one test's theme choice would become the next test's starting state.
- **Generous waits.** `asyncUtilTimeout` is 5 seconds because a full-workspace run competes for cores.
- **`server-only` is inert.** The presets alias it to an empty module so a server module can be imported in a test without the tripwire firing.

Prefer `getByRole` over `getByText`. Asserting on roles is what keeps the accessibility of the product honest, and it is why the ops nav has a single `aria-current` and the delete buttons carry the thread's name.

---

## 4. Writing a database test on PGlite

This is the most important test pattern in the repository. It proves that the **database**, not the application, refuses cross-learner access.

### 4.1 How the harness works

`packages/db/src/testing/harness.ts`:

1. Boots a fresh PGlite engine (real Postgres, in-process, about a second).
2. Runs `SUPABASE_SHIM`: creates the `auth` schema, an `auth.users` table, the `anon`, `authenticated` and `service_role` roles, and an `auth.uid()` function that reads the same request setting PostgREST populates:
   ```sql
   select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
   ```
3. Applies **every migration in order**, after stripping the two things PGlite lacks: `create extension vector` (the column becomes `text`), the HNSW index, `create extension pg_cron`, and the `do $cron$ … $cron$` schedule block. A static test (section 6) asserts those really are declared, so the strip cannot hide their absence.
4. Returns helpers:

```ts
asLearner(learnerId, fn)   // begin; set_config('request.jwt.claim.sub', id); set local role authenticated; fn(); rollback
asAnon(fn)                 // same with role anon and no id
seedLearner(id)            // inserts auth.users, profiles, learner_states with RLS bypassed
seedReferenceData()        // a knowledge document and chunk
```

Everything inside `asLearner` runs in a transaction that is **rolled back**, so tests do not leak rows into each other. `ALICE` and `BOB` are two fixed UUIDs exported for the purpose.

### 4.2 The cross-learner pattern

`packages/db/tests/db/rls.test.ts`, applied to every learner-owned table with `describe.each(OWNED_TABLES)`:

```ts
it("cannot be read by passing another learner's id", async () => {
  const rows = await database.asLearner(ALICE, async () =>
    (await database.db.query(`select learner_id from public.${table} where learner_id = $1`, [BOB])).rows,
  );
  expect(rows).toEqual([]);                          // not an error: RLS filters silently
});

it("refuses an insert attributed to another learner", async () => {
  await expect(
    database.asLearner(ALICE, () => database.db.query(MINIMAL_INSERT[table], [BOB])),
  ).rejects.toThrow(/row-level security/i);          // WITH CHECK fired
});

it("returns nothing at all to an unauthenticated visitor", async () => {
  await expect(database.asAnon(() => database.db.query(`select * from public.${table}`))).rejects.toThrow();
});

it("refuses to let a learner claim another learner's profile row", async () => {
  await expect(
    database.asLearner(ALICE, () => database.db.query(`update public.profiles set learning_goal = 'hijacked' where id = $1`, [BOB])),
  ).resolves.toMatchObject({ affectedRows: 0 });     // USING hid the row; nothing to update
});
```

**Why `MINIMAL_INSERT` is a complete, valid row:** so the rejection can only come from the RLS policy and not from a `NOT NULL` or `CHECK` constraint firing first. A test that fails for the wrong reason is a test that passes when the right reason is broken.

### 4.3 Introspecting what Postgres actually stored

`packages/db/tests/db/policies.test.ts` does not read the migration text. It queries `pg_policies` and asserts on what the engine holds:

```ts
policies = (await db.query(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public'`)).rows;

it("names an explicit role on every policy, never PUBLIC", () => {
  expect(policies.filter((p) => p.roles.includes("public"))).toEqual([]);
});
```

Other tests in the same style assert every `UPDATE` policy has a non-null `with_check`, every operator table has RLS enabled and zero policies, and every function is `SECURITY INVOKER` (by reading `pg_proc.prosecdef`).

### 4.4 When you add a table

Add it to `OWNED_TABLES` (with a `MINIMAL_INSERT` entry) or `OPERATOR_TABLES` in **both** `rls.test.ts` and `policies.test.ts`. The `describe.each` will then run the whole battery against it. If you forget, the static test in section 6 still catches a table with no RLS, but it cannot catch a policy with the wrong predicate. Only the PGlite test can.

### 4.5 What PGlite cannot test

Real vector behaviour (the embedding column is `text` in the harness) and pg_cron firing. `apps/learner/tests/db/retrieval.test.ts` runs the lexical arm for real and the vector arm's SQL shape only. If a change touches the HNSW index or the cosine operator, verify it against `supabase start` by hand and say so in the PR.

---

## 5. The fakes in `packages/test-support`

| Fake | File | What it is for |
| --- | --- | --- |
| `createFakeSupabase(resultsByTable)` | `fake-supabase.ts` | A stand-in for the supabase-js query builder. Records every chained method (`from("profiles").select().eq("id", x).single()`) and resolves to the result you configured per table. `chainFor(table)` and `methodArgs(table, "eq")` let a repository test assert *which filters were applied* without a database. `setRpcResult` scripts the next `rpc()` call. |
| `FakeToolCallingModel(script)` | `fake-tool-calling-model.ts` | A LangChain chat model whose replies are a list of prepared `AIMessage`s, some carrying `tool_calls`. The agent loop executes the tool and comes back for the next message. `seen[]` records what the model was shown on each invocation. **An empty script loops forever** by design, which is how the recursion-limit tests provoke a runaway. |
| `UnavailableModel`, `TimeoutModel` | same file | A model that throws a 404 the way OpenRouter refuses a model the account's data policy excludes, and one that times out. The Trainer's and agents' fallback ladders are tested against these. |
| `server` | `msw.ts` | The shared MSW server with **no global handlers**, so any unmocked request is an error. |
| `setup-jsdom.ts` | | The component-test setup described in section 3. |
| `installWebStorage()` | `web-storage.ts` | Replaces the inert `localStorage` Node 25 ships with a working one so preference tests actually persist. |

**Testing a repository with the fake Supabase:**

```ts
const fake = createFakeSupabase({ profiles: { data: PROFILE_ROW } });
const repo = createLearnerRepository(fake.client);
const result = await repo.getProfile(ALICE);
expect(result.ok).toBe(true);
expect(fake.methodArgs("profiles", "eq")).toEqual([["id", ALICE]]);   // it filtered by id
```

**Testing an agent with the scripted model:**

```ts
const model = new FakeToolCallingModel([
  new AIMessage({ content: "", tool_calls: [{ name: "get_review_session", args: {}, id: "1", type: "tool_call" }] }),
  new AIMessage({ content: "Wie heißt 'the train' auf Deutsch?" }),
]);
const outcome = await runTrainerTurn({ models: [{ model, cacheMarks: false }], tools }, turn);
expect(model.invocations).toBe(2);
expect(outcome.ok && outcome.data.steps.map((s) => s.tool)).toEqual(["get_review_session"]);
```

---

## 6. The security-tests package: the CI gates, file by file

`packages/security-tests` scans the source tree as text. It never runs the code. It runs unfiltered on every CI run, whatever changed.

### 6.1 `src/roots.ts`: the one file that knows the layout

Every test states its rule against a *role* (`ROOTS.gateway`, `ROOTS.prompts`, `ROOTS.repositories`), and `roots.ts` maps roles to paths. When a directory moves, this is the only edit. Key entries:

| Key | Meaning | Edit it when |
| --- | --- | --- |
| `source` | Every directory scanned. Includes every `packages/<name>/src` automatically. | Adding a new top-level source root in an app. |
| `transports` | The **exact** files inside the gateway that may call `fetch` or name a provider URL. | Adding a provider surface. Deliberately. |
| `registry` | The one file that may name a model. | Never, in practice. |
| `repositories` | The only files that may touch the database. | Adding a repository outside `packages/db/src`. |
| `processEnvReaders` | The only files that may read `process.env`. | Adding a deployable. |
| `serverOnlyModules` | Import specifiers a Client Component may never use. | Adding a server-only module a client might be tempted by. |
| `envExamples` | The three committed templates. | Adding a deployable. |

### 6.2 `tests/ai-boundaries.test.ts`

| Test | Asserts |
| --- | --- |
| keeps the OpenAI / Vercel AI / Anthropic / LangChain-model SDKs out of every module outside the gateway | No `from "openai"`, `from "@ai-sdk/..."`, `from "@anthropic-ai/..."`, `from "@langchain/(openai\|anthropic\|google)"` outside `packages/gateway/src`. |
| lets nothing outside the gateway call a provider endpoint | No `https://openrouter.ai`, `api.openai.com`, `api.anthropic.com` literal elsewhere. |
| keeps the transport contract | Nothing outside the gateway imports `gateway/transport` or `gateway/openrouter`. A caller holding a transport could dispatch without a spec, a budget check or a ledger row. |
| hardcodes no model id outside the registry | No `"vendor/model"` string (`openai/`, `anthropic/`, `google/`, ...) outside the gateway; inside it, only in `registry.ts`. |
| names no per-token price constant; hardcodes no price or rate literal | No identifier like `pricePer`, `costPer`, `_PER_MILLION`; no `price = 0.0015` or `rate: 0.92` anywhere. |
| opens a connection from exactly the named transport files | Inside the AI roots, `fetch(` or `https://` appears only in `ROOTS.transports`. |
| prompt text lives in the catalogue | No prompt-shaped string literal outside `packages/prompts/src`. |

### 6.3 `tests/deployables.test.ts`

Reads the three `.env.example` files and the three `package.json` files:

- Ops declares no `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `MCP_SERVER_API_KEY`; is the only app declaring `OPERATOR_USER_IDS`; does not depend on `@dp/gateway`, `@dp/prompts` or any LangChain package; names the model key nowhere in its source except the boot guard that refuses it.
- Learner declares no `GITHUB_TOKEN` or `OPERATOR_USER_IDS`; has no operator surface left; does not depend on `@dp/product-ops`.
- Worker declares `GITHUB_TOKEN` and `REPO_CHECKOUT_PATH`; declares no publishable key.
- All three declare `LOG_PSEUDONYM_SALT`.
- `@langchain/openai` is a dependency of `packages/gateway` and nothing else.

### 6.4 `tests/migration-policy.test.ts`

Static checks on the concatenated migration SQL, with line comments stripped first so documentation cannot trip a gate:

- Filenames match `^\d{14}_[a-z0-9_]+\.sql$` with unique timestamps.
- Every `create table public.X` has a matching `alter table public.X enable row level security` somewhere.
- pgvector: extension created, `embedding vector(N)` column, `using hnsw (embedding vector_cosine_ops)` index.
- pg_cron: extension created, all six named schedules present, the reconcile schedule is `*/5 * * * *`, and every `cron.schedule(` sits inside the one `do $cron$ … $cron$;` block the harness strips.
- No `security definer`. No quoted mixed-case identifier. No naive `timestamp` (only `timestamptz`). No `grant ... to anon` on a table.

### 6.5 `tests/secret-exposure.test.ts`

- No Client Component (`"use client"`) contains the *name* of a server secret (`SUPABASE_SECRET_KEY`, `OPENROUTER_API_KEY`, `LANGSMITH_API_KEY`, `GITHUB_TOKEN`, `OTEL_EXPORTER_OTLP_HEADERS`) or imports a server-only module.
- Nothing prefixes a server secret with `NEXT_PUBLIC_`.
- `process.env` appears only in the six allowlisted env modules.
- Domain purity: `packages/domain` imports no React, Next, Supabase, LangChain or env module.
- Repository purity: repositories import no React or Next.
- Each Next app has `proxy.ts` and no `middleware.ts`.

### 6.6 How to extend a gate

1. State the rule against a role, not a path.
2. If it needs a new location, add it to `roots.ts`.
3. Write the test as a filter over `sourceFiles()` producing an `offenders` array and assert `toEqual([])`, so a failure prints the offending paths.
4. Add a `finds source files to scan` guard if you introduce a new root, so an empty scan cannot pass vacuously.

---

## 7. Defence in depth: one request, every layer, and the test that proves each

Take `POST /api/chat` with a body naming somebody else's thread id.

| Layer | The check | Where | The test that proves it |
| --- | --- | --- | --- |
| Browser | Nothing. The browser is not a security boundary. | | |
| Proxy | Session refreshed; unauthenticated path redirected. A convenience, not a boundary. | `apps/learner/proxy.ts`, `packages/auth/src/session.ts` | `tests/unit/auth/session.test.ts`, `routes.test.ts` |
| Route handler: authenticate | Learner id read from the verified token, never the body. | `app/api/chat/route.ts` | `tests/unit/auth/current-user.test.ts` |
| Pseudonymise | HMAC of the id; refuses with no salt. | `lib/api/pseudonym.ts`, `@dp/observability/pseudonym` | `pseudonym-fallback.test.ts`, `observability/tests/pseudonym.test.ts` |
| Rate limit | One atomic upsert in Postgres; shared across instances; a store that cannot count **denies**. | `lib/api/rate-limit.ts`, `consume_rate_limit` | `db/tests/db/rate-limit.test.ts`, `rate-limit-memory.test.ts` |
| Validate | Strict Zod: unknown fields rejected, history capped, only `user`/`assistant` roles. | `lib/api/chat.ts` → `chatRequestSchema` | `tests/unit/api/chat.test.ts` |
| Authorize | The thread is read **as the learner**; RLS returns nothing for another learner's id; the turn ends with `thread_unavailable` and the model is never called. | `lib/graph/nodes.ts` → `loadThread`, request-scoped client | `graph/turn.test.ts` (thread failure ends the turn), `db/tests/db/rls.test.ts` (the database refuses) |
| Prompt | Untrusted content fenced; brackets escaped; shedding order fixed; over-budget refused. | `packages/prompts/src/delimiters.ts`, `builder.ts` | `prompt-builder.test.ts`, `prompt-contract.test.ts` |
| Gateway | Task must be in the table; ceilings sent; stream guarded; budgets fail closed; one ledger row. | `packages/gateway/src/gateway.ts` | `gateway.test.ts`, `budget-gate.test.ts`, `stream-guard.test.ts`, `call-spec.test.ts`, `db/usage-accounting.test.ts` |
| Model output | Evaluation validated by Zod; one repair; then the safe path. | `lib/ai/evaluation/` | `evaluate.test.ts`, `recovery.test.ts`, `triage.test.ts` |
| Database write | `record_learner_error`, `record_level_turn` are `SECURITY INVOKER` functions with no learner-id argument; the owner is `auth.uid()`. | migrations | `db/tests/db/policies.test.ts`, `level-performance.test.ts` |
| Response | A closed set of safe messages; never a stack trace or provider text. | `lib/api/chat.ts` → `RESPONSES` | `chat.test.ts` |
| Logs | Redacted by key; event names and identifiers only. | `@dp/observability/logger` | `observability/tests/logger.test.ts` |
| CI | The four architecture rules, deployable boundaries, migration hygiene, secret exposure. | `packages/security-tests` | itself |

The same table applies to an operator action, with `requireOperator` (session, allowlist, aal2, pseudonym, audit line) in the authorize row and `ops_*` functions revoked from `authenticated` in the database row.

---

## 8. Observability as a harness

### 8.1 The logger

`packages/observability/src/logger.ts` emits **one JSON object per line** with an **event name**, never a sentence:

```json
{"level":"info","event":"turn.completed","requestId":"…","userIdHash":"…","intent":"grammar","retrieved":5,"truncated":false,"costEur":0.0064,"nodes":"load_state:ok,load_thread:ok,…"}
```

Redaction runs **on the way out, by key name**, so a field added later cannot quietly leak:

- Keys matching `api_key|secret|token|password|authorization|cookie|credential|session` → `[redacted]`.
- Keys matching `content|message|utterance|transcript|prompt|completion|reply|answer|question|email|text|body` (segment-wise, so `userMessage` is caught) → `[redacted]`.
- Identifiers that read like content but are wanted (`messageId`, `promptName`, `promptVersion`, `promptFingerprint`) pass through.
- Any string over 300 characters is truncated.

`withFields(logger, { jobId, kind })` stamps fields on every subsequent line; the worker uses it per job. `nullLogger` is for code paths that take a logger but are not being observed. A logger that throws is worse than one that drops a line, so `emit` swallows its own errors.

**Testing a log line:** pass a `sink` that collects strings, then parse and assert. `observability/tests/logger.test.ts` asserts that `{ userMessage: "…" }` arrives as `[redacted]`.

### 8.2 Audit events

A line with `audit: true` is a security audit event (guardrails §24). The ones that exist:

| Event | Emitted when |
| --- | --- |
| `ops.access` | An operator is admitted to a surface (each page view, action, route). Carries `userIdHash`, `route`, `aal`. |
| `ops.access_denied`, `ops.login_denied` | A refusal, with `reason`. |
| `productops.enqueued`, `productops.run_started`, `productops.advance_requested`, `productops.run_removed` | Operator activity on the board. |
| `worker.job_invalid` | A job row the worker could not parse (dead-lettered at once). |
| `worker.job_dead_lettered` | A job that spent its attempts. |
| `budget.denied` (repeated for one hash) | Treated as financial denial of service. |
| Budget edits and learner corrections in the ops app | With before and after values, under the operator's pseudonym. |

These live only in the logs today; there is no `ops_audit_log` table (document 6 lists that as debt).

### 8.3 OpenTelemetry (the worker)

`packages/observability/src/telemetry.ts` assembles a tracer, a meter and a log emitter over OTLP **by hand**, without `sdk-node`, because there is no auto-instrumentation: every span and metric is deliberate and carries error *codes*, never messages. With no `OTEL_EXPORTER_OTLP_ENDPOINT` it returns no-op twins and the worker runs identically.

Spans: `job.process` (attributes `job.kind`, `job.queue`, `job.id`, `job.attempt`, `job.outcome`, `job.error_code`) with a child `job.handle`.

Metrics (`apps/worker/src/instruments.ts`), every attribute from a closed set:

| Metric | Meaning |
| --- | --- |
| `worker.jobs.processed` | Finished jobs by kind, queue, outcome |
| `worker.jobs.duration` | Seconds from claim to finish |
| `worker.jobs.retried`, `worker.jobs.dead_lettered` | By kind and error code |
| `worker.jobs.inflight` | Running right now |
| `worker.poll.errors` | Claims or requeue sweeps that failed |
| `worker.queue.depth` | `ops_jobs` rows by queue and status. `status=failed` is the dead-letter count to alert on. |

The logger's `emit` hook bridges already-redacted fields to OTel logs, so telemetry cannot see what the log sink would not.

### 8.4 LangSmith

`LANGSMITH_TRACING=true` plus a key sends every LangChain model and tool call (the Trainer, the product-ops agents) to LangSmith with tokens and latency. `resolveTracingConfig` withholds the key unless tracing is enabled, so a key left in an untraced deployment is never handed to a client. Tracing is observability, never a call path. Review the privacy settings before tracing production learner conversations.

### 8.5 When something breaks: grep for this

| Symptom | Event to look for | Meaning |
| --- | --- | --- |
| Learner sees "your tutor is unavailable" | `chat.turn_refused` | Which node failed and why, with the request id. No content. |
| Replies short and generic | `turn.completed` with `retrieve:degraded`; `retrieval.arm_failed` | One search arm went quiet. |
| Scenario search unavailable | `scenario_search.disabled` (no key) or `scenario_search.embedding_failed` | Provider or budget refusal. |
| Spend climbing / calls refused | `budget.warning`, `budget.degraded`, `budget.denied`, `ceiling.denied` | Which scope, which hash. Denials are audit events. |
| Euro figures zero | `fx.lookup_failed`, `fx.source_unavailable` | No rate snapshotted. Run `pnpm fx:refresh --force`. |
| A tier living on its fallback | `provider.attempt_failed`; ledger `model_id` ≠ `model_id_resolved` | Account data policy or outage. |
| Ledger rows missing | `ledger.write_failed`, `ledger.row_invalid` | The accountant could not persist. |
| A run sits at "queued" | worker `/readyz`; `worker.claim_failed`; `select status, count(*) from ops_jobs group by 1` | Nothing is claiming, or the database is unreachable. |
| A job keeps failing | `worker.job_retry` → `worker.job_dead_lettered`; `last_error` code on the row | Five attempts with backoff 15s, 30s, 60s, 120s, 240s. |
| Trainer turn dies midway | `trainer.budget_pressure`, `trainer.budget_denied` | The €0.05 request ceiling; check the tier's cost per call. |
| Operator cannot get in | `ops.access_denied` with `reason` | `not_operator`, `step_up`, or `no_pseudonym` (salt unset). |

---

## 9. Mutation testing, by hand

There is no mutation-testing framework in the manifests. The gate is a discipline, described in `docs/architecture.md`: roughly 360 mutations run so far, and the ones that survived pointed at real bugs.

Procedure for one mutation:

1. Pick a line that encodes a decision: a comparison, a boundary, a branch, a constant.
2. Break it deliberately. Flip `<=` to `<`. Change `RRF_K = 60` to `0`. Remove a `WITH CHECK`. Swap the shedding order. Delete a `revoke`.
3. Run the narrowest suite that should notice: `pnpm turbo run test --filter=@dp/<pkg>`, or `pnpm test:db` for a migration.
4. **If it still passes, the test was decoration.** Write the test that fails, confirm it fails, then revert the mutation and confirm it passes.
5. Revert. Never commit a mutation.

Three that survived in this codebase and what they taught: the machine-register identity block had a cap smaller than the block and shipped truncated for three phases (the lock hashed the intended text, the builder shipped the rendered one; they are now one function); the retrieval scorer's above-level penalty was untested because the test varied the band, not the direction; the document hash's separator was untested because the example happened to differ either way.

Do at least one mutation against any test you write for a security property. A security test that cannot fail is a hole with a green tick on it.

---

## 10. Running e2e

`pnpm test:e2e` builds the learner app for production and starts it on port **3100**, never reusing a `next dev` server, because reusing one silently tests a different build. `tests/e2e/smoke.spec.ts` asserts the shell boots and the companion's states; `auth.spec.ts` and `fixture-login.spec.ts` sign in with the `DEV_SEED_*` account; `learner-journey.spec.ts` walks onboarding to a first chat page. CI runs Chromium only, retries twice, and uploads the Playwright report on failure.

Write e2e tests only for journeys that cannot be proven lower down: a real browser's cookie handling, a redirect chain, a production-only rendering difference. Everything else belongs in a faster layer.
