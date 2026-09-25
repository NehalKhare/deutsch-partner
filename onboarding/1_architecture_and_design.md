# 1. Architecture and Design

This document explains how Deutsch Partner is put together and, more importantly, *why*. It is written for someone who has never worked with this stack. Every technical term is defined the first time it appears. Every design choice comes with the alternatives that were considered and rejected.

Read this first. The other six documents assume you have.

---

## 0. What the product is, in one paragraph

Deutsch Partner is an AI German tutor for English speakers. A learner types (or speaks) German into a chat, and a tutor called Jonas replies at their level, corrects them the way their level can use, and quietly records what they got wrong and which words they used. A second, separate product lets the operators (the people running the business) watch AI spend in euro, look after learners, and run an AI-assisted product-research pipeline. A third process does the slow background work so nobody waits on a web page for it.

Three ideas shape almost every decision in the codebase:

1. **A tutor that costs more per learner than it earns is not a product.** Every AI call is routed to the cheapest model that can do the job, capped in tokens before it is sent, and written to a ledger in euro. A typical learner turn costs about €0.0064.
2. **The model is not the curriculum.** Seventy mini-levels, 420 words and 86 grammar patterns are hand-written data. What a learner is taught next is arithmetic over their own record, never a model's opinion.
3. **Model output is never trusted.** Every structured reply is validated against a schema. When it cannot be validated, the safe answer is to write nothing.

---

## 1. Monorepo architecture (Turborepo + pnpm)

### 1.1 What a monorepo is

A **monorepo** is one git repository that holds several related programs and the libraries they share, instead of one repository per program.

**Analogy:** Think of a restaurant group that owns three restaurants. A *polyrepo* is three separate buildings, each with its own kitchen, its own suppliers, its own recipe book. When the group changes its signature sauce, someone has to update three recipe books and hope they stay in sync. A *monorepo* is one building with three dining rooms and one shared kitchen. Change the sauce once, and every dining room gets the new version at the same moment.

In this project the "three dining rooms" are the three deployable programs under `apps/`, and the "shared kitchen" is the fourteen libraries under `packages/`.

### 1.2 What pnpm does

**pnpm** is the package manager: the tool that downloads third-party code (React, Zod, LangChain) and wires it together. It is chosen over `npm` and `yarn` for two concrete reasons:

- **Workspaces.** The file `pnpm-workspace.yaml` declares that everything under `apps/*` and `packages/*` is part of one workspace. A package can depend on another with `"@dp/domain": "workspace:*"`, which means "use the copy in this repository, not one from the internet".
- **The catalog.** Also in `pnpm-workspace.yaml`, a `catalog:` block pins one version of every shared dependency. Every `package.json` says `"react": "catalog:"` instead of a version number. This matters a great deal for React and for `@langchain/core`: if two copies of React with different versions ended up in one bundle, components would silently break. The catalog makes that impossible.

**Why not a single big `package.json`?** Because the three apps must hold *different secrets* and *different dependencies*. The operator app is not allowed to have the OpenRouter model key or the LangChain packages at all, and a CI test checks its `package.json` to prove it. One shared manifest could not express that.

### 1.3 What Turborepo does

**Turborepo** (often just "turbo") is a task runner for monorepos. When you type `pnpm verify` at the root, turbo is what decides which package's typecheck, lint, test and build to run, in what order, and which ones it can skip.

**Analogy: the automated assembly-line manager.** Imagine a factory floor with fourteen workstations. Some stations cannot start until another finishes (you cannot test the learner app until the `domain` package's types compile). Some stations can run in parallel. And crucially, the manager remembers what each station produced last time: if the inputs to a station have not changed, it hands over yesterday's output instead of doing the work again. That memory is **build caching**.

The rules live in `turbo.json`. The important lines:

```json
"typecheck": { "dependsOn": ["^typecheck"] },
"build":     { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] }
```

The caret `^` means "first run this task in every package I depend on". So building `apps/learner` first builds `@dp/domain`, `@dp/db`, `@dp/gateway`, and so on. The `outputs` line tells turbo what to save in the cache.

Two more things turbo gives us that matter in production:

- **Affected-only CI.** The CI workflow runs `turbo run ... --filter=...[origin/main]`, which means "only the packages whose files changed, plus everything that depends on them". A change to the worker never re-tests the learner app's React components.
- **`turbo prune`.** Used inside the Docker build. It cuts the workspace down to exactly the packages one app needs. The learner image does not contain the product-ops code because the learner app does not depend on it. This is explained in full in document 5.

### 1.4 Shared packages and shared types

The `packages/` directory holds code that more than one app needs. The rule is simple and enforced by CI: **apps import packages; apps never import each other; dependencies point downward.**

```
apps/learner   apps/ops   apps/worker        <- deployables
      \           |          /
       v          v         v
   packages/gateway  packages/product-ops  packages/learning  ...
              \        |        /
               v       v       v
          packages/db   packages/prompts   packages/auth
                    \      |      /
                     v     v     v
                  packages/domain            <- Zod schemas, pure rules. Imports nothing above it.
```

`packages/domain` is the foundation. It contains **Zod schemas** (Zod is a library for describing the exact shape of data and checking values against it at runtime) and pure functions with no input/output. Because every other package imports its types from `domain`, a learner's profile has exactly one definition in the whole repository. The database repository validates rows against it on the way out; the API validates request bodies against it on the way in; the prompt builder renders it into text. If you change the shape, TypeScript tells you every place that has to change.

**Why shared types matter for a junior developer:** without them, the frontend and backend each keep their own idea of what a "learner" looks like, and the two drift apart until a field is `miniLevel` in one place and `mini_level` in another. Here, `packages/db/src/rows.ts` is the one place that knows the database uses snake_case, and it translates to the camelCase domain type on every read.

### 1.5 Shared configuration

`packages/config` holds the base `tsconfig`, the ESLint rules and the Vitest project presets. Each package's own config is two lines that extend the shared one. This is why `turbo.json` lists `packages/config/**` under `globalDependencies`: a change there invalidates every cache entry, because it could change how every package compiles.

---

## 2. System design and paradigm

### 2.1 The three deployables

A **deployable** is a program that is built into its own container image and started as its own process. This project has three:

| Deployable | What it is | Talks to |
| --- | --- | --- |
| `apps/learner` | The learner-facing website. Next.js. Serves pages, streams chat replies, calls the AI gateway. | Browser, Postgres, OpenRouter |
| `apps/ops` | The operator website on its own domain, behind password + authenticator code. Shows spend, learners, product-ops board. **Holds no AI key.** | Browser, Postgres |
| `apps/worker` | A plain Node process with no web framework. Drains a job queue: product-ops stages, currency snapshots, corpus ingestion, housekeeping. | Postgres, OpenRouter, GitHub (one instance only) |

All three share **one Postgres database** hosted on Supabase.

### 2.2 The paradigm: a modular monolith plus a queue-draining worker

There are three common ways to structure a backend like this. Understanding why we picked one requires understanding all three.

#### Option A: Microservices

**What it is:** every capability (auth, chat, retrieval, cost accounting, product-ops) is its own service with its own database, its own deployment, and its own API. Services call each other over the network.

**Analogy:** a food court where every stall is a separate business with its own till, its own supplier and its own rota. Very flexible, but ordering a meal that needs three stalls means three queues, three receipts and three ways for something to go wrong.

**Why rejected here:** the team is small, the product is one product, and the hardest invariants in this system (every AI call writes exactly one ledger row; euro budgets fail closed; a learner can only read their own rows) are far easier to guarantee inside one process and one database than across a network. Microservices would have added service discovery, distributed tracing across boundaries, and the classic problem of keeping data consistent between services, all before a single learner existed. The guardrails document is explicit: security beats convenience, and a distributed system has more places for security to leak.

#### Option B: Serverless monolith (one Next.js app on Vercel-style functions)

**What it is:** one web app where every API route becomes a short-lived cloud function. No long-running process. The platform starts a function when a request arrives and kills it afterwards.

**Analogy:** a pop-up kitchen that assembles itself when a customer walks in and vanishes when they leave. Zero cost while idle. But a dish that takes ninety seconds to cook is a problem, because the kitchen has a timer.

**Why rejected here:** two features cannot live inside a request timeout. The Trainer is a tool-using agent loop that legitimately runs 30 to 90 seconds. The product-ops pipeline runs for minutes, calls a reasoning-tier model that thinks for most of a minute before its first byte, and, in its coding stage, checks out a git repository, builds it and runs the test suite. Serverless functions also make "do this after the response is sent" unreliable, and the chat turn relies on exactly that: the evaluation on a second model runs *after* the reply has streamed, which is what makes evaluating every message affordable.

#### Option C (chosen): modular monolith + queue drainage

**What it is:** two web apps that stay thin (authenticate, validate, hand the work to a library, return), plus a long-running worker that pulls jobs off a queue in Postgres and does the slow work. Everything shares one database.

**Queue drainage** means: some process writes a row saying "please do X" into a table, and a separate long-running process repeatedly asks the table "is there anything to do?", claims a row, does it, and marks it done. The process that asked for the work never waits for it.

**Analogy:** a restaurant kitchen with an order rail. Waiters (the web apps) take orders and clip them to the rail. Cooks (the worker) take the next ticket, cook it, and put it on the pass. If a cook faints mid-order, the ticket is still on the rail and another cook picks it up. Nobody's order is lost, and the waiter never stands in the kitchen waiting.

**Why this fits:**

- **The dangerous secrets stay in one place.** Only the worker holds the GitHub token, and only one *instance* of the worker (the `coder` queue) holds it. The operator app can start a product-ops run without being able to touch a model or a repository, which shrinks what a break-in on that public-facing app could do.
- **Long work is not a web request.** A product-ops run is many model calls over minutes. The operator's browser gets a reply in milliseconds ("job recorded") and then watches the run's timeline update live.
- **Postgres is already the only durable state.** Adding Redis or RabbitMQ as a queue would mean a second system to run, monitor, back up and keep consistent with the database. Postgres has row locking (`FOR UPDATE SKIP LOCKED`), which is exactly what a queue needs, and it already holds the run the job points at. One transaction can claim the job and read the run.
- **Recurring jobs are scheduled by the database, not the worker.** The extension `pg_cron` fires on a schedule and inserts a job row. However many worker replicas run, none of them owns a clock, so nothing runs twice.

### 2.3 When you would use each communication style

You will add features to this system. Here is how to decide the shape of each one.

| You need to... | Use | Where it already exists | Why |
| --- | --- | --- | --- |
| Return a page or JSON in under a second | **REST route handler** or a **Server Action** | `apps/learner/app/api/*/route.ts`, every `actions.ts` | Simple, cacheable, stateless. The default. |
| Send a long AI reply word by word | **HTTP streaming** (a `ReadableStream` response) | `/api/chat`, `/api/trainer` | One request, one response, but the body arrives in pieces. No extra infrastructure. |
| Push server events to a browser, one direction | **Server-Sent Events (SSE)** | `/api/runs/[runId]/events` | Browser reconnects on its own and resends the last id it saw. Works through every proxy. Perfect for a live log. |
| Two-way real-time chat between browsers | **WebSockets** | Not used | You only need this when the *browser* also pushes many small messages back. Nothing in this product does that yet. A multiplayer roleplay would. |
| Do work that takes more than a few seconds | **Queue + worker** | `ops_jobs` table, `apps/worker` | The web request returns immediately; the worker does the work; the browser polls or subscribes for the result. |
| Do work on a schedule | **pg_cron → queue** | `20260924120000_pg_cron_schedules.sql` | The database enqueues; workers drain. No replica owns a clock. |
| Call an AI model | **The gateway**, never directly | `packages/gateway` | See section 3. A CI test fails the build otherwise. |
| Service-to-service typed calls at scale | **gRPC** | Not used | Only worth it with many services and a strict contract. We have one database and three processes. |

### 2.4 Which database for which job

This project uses one Postgres database for everything, deliberately. Here is the reasoning, and when that would change.

| Need | What we use | What else exists | Why ours |
| --- | --- | --- | --- |
| Relational data (learners, threads, tallies) | **Postgres** | MongoDB (document store) | Learner state has strict invariants: a mastered status must be backed by a score of at least 0.6; a B1 learner cannot be "B1+". Postgres `CHECK` constraints enforce these in the database itself. A document store would rely on the application remembering to check. |
| Vector search (finding similar text) | **pgvector** extension inside Postgres | Pinecone, Weaviate, Chroma, Qdrant | Retrieval must **filter by learner level before ranking by similarity**, in the same query. A separate vector database would return the top 24 similar chunks and then we would filter, which means a B1 explanation reaches an A1 learner because it was the most similar thing in the corpus. In Postgres the filter is in the `WHERE` clause and the vector index (HNSW) is on the same row. See document 3. |
| Full-text search | **Postgres `tsvector`** with the German dictionary | Elasticsearch, Algolia | The corpus is 599 chunks. Postgres stems German (*Wohnungen* → *wohnung*) and drops German stop words natively. Elasticsearch is a second cluster to run for a problem this small. |
| Job queue | **Postgres table + `FOR UPDATE SKIP LOCKED`** | Redis (BullMQ), RabbitMQ, SQS | Explained above. The job and the run it points at are in one database, so one transaction sees both. |
| Rate limiting | **Postgres table**, one atomic upsert per check | Redis `INCR` | An in-memory counter was tried first. With N instances it allowed N times the quota, and a restart forgave everybody. Postgres makes every instance share one count. |
| Caching embeddings | **Postgres table** keyed by content hash | Redis | An embedding is expensive to compute and cheap to store. Keying by hash means unchanged text is never re-embedded. |
| Session storage | **Supabase Auth** (cookies carrying a signed token) | A sessions table, Redis | Supabase issues and refreshes the token. We store nothing. |

**When this would change:** at very high write volume the rate-limit table becomes a hot spot and Redis would win. If the corpus grew to millions of chunks, a dedicated vector store's sharding would matter. If tens of operators watched runs at once, the SSE polling tick should become a Postgres `LISTEN/NOTIFY` or Supabase Realtime subscription. None of those is true today, and the architecture document in `docs/architecture.md` says so under "What is not built".

---

## 3. End-to-end data flow: one chat turn

This is the single most important sequence in the product. Follow it once slowly.

**Scenario:** an A1 learner, standing at mini-level 4, types *"Ich habe gegangen nach Hause"* (a common past-tense mistake) and presses send.

### Step 1: Browser

The React component `components/chat/conversation.tsx` does not save the message anywhere. The whole transcript lives in the browser's memory and dies with the tab, by design (see "Conversation privacy" in section 5). It sends one `POST /api/chat` with:

```json
{ "threadId": "<uuid>", "message": "Ich habe gegangen nach Hause", "history": [ ...last few turns... ] }
```

### Step 2: The proxy (session refresh)

Before any route runs, `apps/learner/proxy.ts` runs. (In Next.js 16 this file replaced `middleware.ts`; a CI test asserts the old name is absent.) It hands the request's cookies to Supabase, which refreshes the session token if it is close to expiry, and copies any new cookie onto the response. If the path needs a session and there is none, it redirects to login. **This redirect is a convenience, not security.** Every handler checks again.

### Step 3: The route handler

`apps/learner/app/api/chat/route.ts` is deliberately about fifty lines. It does exactly what the guardrails say every endpoint must do, in order:

1. **Authenticate.** Reads the learner's id from the verified session token. Never from the body.
2. **Pseudonymise.** Hashes the id with a secret salt (HMAC-SHA256). This hash, not the id, is what goes into logs, the rate limiter and the cost ledger.
3. **Rate limit.** Calls the Postgres function `consume_rate_limit` with the pseudonym as the key. Twenty chat messages a minute. Every instance of the app shares the same count.
4. **Parse the body.** Hands the raw body to `handleChatTurn` in `lib/api/chat.ts`, which validates it against a strict Zod schema. Extra fields are rejected. A history longer than the prompt window is rejected, not trimmed. Only `user` and `assistant` roles are allowed, so a body cannot smuggle a system instruction.
5. **Run the turn.** Everything from here is in `lib/graph/`, which has no idea it is inside a web server. That is what makes it testable with no server running.

### Step 4: The turn graph, before the stream

`lib/graph/turn.ts` runs a fixed sequence of small nodes. Each node takes the state and returns the state. None of them throws: a node that cannot do its job writes a note and hands on, because a reply with no retrieval behind it is better than an error page because the vector store was slow.

```
load_state → load_thread → place → honour_advance → retrieve → generate → [stream] → evaluate → persist → record_vocabulary → record_performance
```

- **`load_state`** reads the learner's profile and state (two queries, in parallel) plus their twelve most overdue vocabulary words and five most frequent unresolved errors. It builds a *compact projection*, not raw rows: the prompt gets "level A1, mini-level 4, theme: Im Café, due words: der Kaffee, die Rechnung", never a database row. This is the one node whose failure ends the turn, because without a level there is no policy, no budget and no curriculum.
- **`load_thread`** reads the thread **as the signed-in learner**, using the request-scoped Supabase client. Row Level Security decides whether the row exists for them. Somebody else's thread id reads as "not found", and the turn never reaches a model. This is the authorization step.
- **`place`** and **`honour_advance`** are pure arithmetic. If the learner typed *weiter* or "move me on", a pattern (not a model) decides they asked, and a pure function moves them. The routing spec names level progression as work that must never be a model call.
- **`retrieve`** embeds the message through the gateway (cached by content hash), then runs vector search and German full-text search **in parallel** against Postgres, each filtered to the learner's eligible levels *before* ranking. The two result lists are fused by Reciprocal Rank Fusion, re-ranked for the learner, and the top 5 chunks are each capped at 220 tokens.

### Step 5: Prompt assembly

`packages/prompts/src/builder.ts` assembles the prompt from twelve blocks in a fixed order, each with its own token cap. The three blocks that are identical every turn (identity, safety, behaviour policy) come first so a provider's prompt cache can cover them. Everything that did not come from the system (retrieved chunks, memories, the learner's message) is fenced in tags like `<retrieved_knowledge>…</retrieved_knowledge>`, with every angle bracket inside replaced by a lookalike character so the content cannot close its own fence. If the total is over the A1 input ceiling of 4000 tokens, context is shed in a fixed order (oldest messages, then the weakest retrieved chunk, then the least salient memory). The policy, the learner state and the current message are never shed. If it still does not fit, the call is **refused**, not sent.

### Step 6: The gateway

`packages/gateway/src/gateway.ts` is the only code in the repository allowed to talk to a model. It:

1. Looks up `conversation.turn` in the task table: tier `strong`, ceiling 300 output tokens at A1.
2. Checks four euro budgets (per request, per learner per day, per learner per month, global per day). At 90% it downgrades a tier and halves the ceiling. At 100% it makes **no call** and returns a plain sentence for the learner.
3. Resolves the tier to a model through the registry (`openai/gpt-5.4` today, with a same-tier fallback).
4. Sends the request to OpenRouter with `max_tokens=300`, always.
5. Wraps the stream in a **stream guard** that counts tokens as they arrive and aborts at 300 even if the provider ignores the parameter.
6. Writes **exactly one ledger row** to `model_invocations`: task, tier, model requested, model actually served, tokens, cost in USD, the euro rate applied, cost in EUR, latency, status. On failure too. Never the message content.

### Step 7: Streaming to the browser

`toReadableStream` in `lib/api/chat.ts` turns the chunks into a UTF-8 body. The learner sees *"Ah, du bist nach Hause gegangen! …"* arriving word by word. The companion character on screen animates while text arrives.

### Step 8: After the stream (the second model)

Once the last word has streamed, and **inside the stream's lifetime** so a host cannot kill the process, the after-stream nodes run:

- **`evaluate`** sends the learner's sentence to a `mid`-tier model with a strict schema: which error types, which patterns, level signals. Trivial messages ("Danke!") are skipped deterministically. This is the main cost lever of the product: the expensive model writes the reply, a cheaper one grades the input.
- **`persist`** merges the found error (`perfekt` auxiliary, pattern *habe gegangen*) into `learner_errors` through a database function that increments the count atomically.
- **`record_vocabulary`** updates the spaced-repetition record for each curriculum word the learner used.
- **`record_performance`** adds one line to the per-level tally: evaluated, error-free or not. When seven turns are recorded at an 80% pass rate, the mastery gate opens and the chat announces it. The learner chooses to move on; mastery moves nobody by itself.

### Step 9: The trailer

The tally exists only after step 8, long after the HTTP headers were sent. So it rides at the end of the stream itself: a single NUL byte (the one character German prose cannot contain) followed by a small JSON object. The browser splits at the NUL, shows the reply, and updates the mastery strip.

### What was written to the database, in total

Two rows changed and one row was appended: the aggregated error, the per-level tally, and the append-only ledger row holding a pseudonym and a cost. **Not one word of what the learner said.**

### The same shape, for a background job

When an operator presses "Start scan" in the ops app:

1. The Server Action re-checks the operator allowlist and second factor, rate limits, creates an `ai_runs` row, and calls `enqueue_job`. The row's `dedupe_key` is `productops.drive:<runId>`, so a double-click inserts nothing the second time.
2. The action returns. The page shows the run as "queued".
3. The worker's poll loop calls `claim_job`, which is a single `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`. Two workers polling at once get two different jobs or one gets nothing. Never the same one.
4. The worker runs one stage of the LangGraph state graph, writes progress events to `ai_run_events`, and does a compare-and-set transition on the run's stage. A heartbeat extends its lock every thirty seconds.
5. The operator's browser holds an SSE connection to `/api/runs/<id>/events`. The server reads the timeline forward from Postgres every 1.5 seconds and sends new rows. When the run reaches a human gate, the stream sends `done` and closes.
6. If the worker dies, its lock expires, another worker's sweep puts the job back in the queue, and the stage's idempotency check finds the work already recorded.

---

## 4. Scalability: from 10 to 10,000+ concurrent users

### 4.1 Horizontal scaling

**Horizontal scaling** means running more copies of the same process behind a load balancer, as opposed to **vertical scaling**, which means giving one process a bigger machine.

**Analogy:** a supermarket opens more checkouts (horizontal) rather than training one cashier to scan faster (vertical). You can always open another checkout. There is a ceiling on how fast one person can scan.

Every deployable here is **stateless**, which is the precondition for horizontal scaling. A stateless process holds nothing in memory between requests that another copy would need:

- **The learner app** holds no conversation. The transcript is in the browser; learner progress is in Postgres; the session is a signed cookie. Any instance can serve any request. The Cloud Run manifest allows up to 10 instances at 80 concurrent requests each.
- **The rate limiter and budgets** live in Postgres, not in process memory. Ten instances share one count.
- **The worker** holds no queue. Ten workers poll the same table; `SKIP LOCKED` hands each a different row.
- **The product-ops graph** checkpoints to Postgres after every node. Whichever instance handles the operator's decision resumes the graph.

### 4.2 What scales at each stage

| Concurrent learners | What is true | What you would do |
| --- | --- | --- |
| **10** | One instance of each app. Cloud Run scales to zero when idle. Cost is essentially the AI bill (€0.64 per learner per 100 turns). | Nothing. |
| **100** | Still one or two instances. Postgres connection count starts to matter: Next.js creates a Supabase client per request, but Supabase's connection pooler (PgBouncer) absorbs this. | Turn on the pooler in Supabase. Watch `model_invocations` p95 latency. |
| **1,000** | Several learner instances. The chat hot path is dominated by the strong-tier model's latency (seconds), not by our code. The rate-limit table sees ~20 writes per learner per minute. Ledger writes are one row per model call, five per turn. | Add indexes you find missing from real query plans. Consider raising `WORKER_CONCURRENCY`. The `cost.rollup` job keeps the dashboard reading a summary table rather than the whole ledger. |
| **10,000** | The strong-tier model provider's rate limit is the wall, not Postgres. OpenRouter distributes across providers, and the registry's fallback ladder absorbs a provider refusing. The rate-limit table's single-row upserts become a hot spot; move it to Redis. The SSE polling for operators is fine because there are few operators. | Redis for rate limits. Read replica for the ops dashboards. Partition `model_invocations` by month. Push, not poll, for run timelines. |

### 4.3 Memory limits

Each container has an explicit memory limit (learner and ops 1 GiB, queue worker 1 GiB, coding worker 8 GiB because it runs `next build` inside a git worktree). The worker sets `NODE_OPTIONS=--max-old-space-size=3072` so every child process it spawns inherits a cap. Why this matters: a Node process with no cap grows until the platform kills it, and a kill during a job is exactly the case the at-least-once queue exists to absorb, but it is better not to trigger it.

Prompts are bounded **by construction**, not by hoping. Every block has a cap, every task has an input ceiling, the retriever caps each chunk at 220 tokens and returns at most 12. A learner cannot send a 50,000-token message; the schema rejects it.

### 4.4 Rate limits and financial denial of service

Two independent controls, and the guardrails insist on both:

- **Rate limiting** bounds *how often*: 20 chats a minute, 10 trainer requests, 10 transcriptions, 20 speech readings.
- **Euro budgets** bound *how much*: one request with a huge context and no output ceiling can cost more than a thousand small ones.

A user who can trigger unbounded model spend has found a **financial denial of service**: a way to run up the operator's bill. Repeated budget denials are logged as a security audit event for that reason.

---

## 5. Security and guardrails

This section explains the model. Document 7 shows how each layer is tested and how to extend the CI gates.

The normative document is `.claude/docs/security-observability-guardrails.md`. Its first principle: **defence in depth**. Security exists at the browser, the server, the API boundary, the authorization layer, the database, the AI orchestration, the retrieval system and the logs. The LLM is never a security boundary. The browser is never a security boundary.

### 5.1 Authentication flow (learner)

**Authentication** answers "who are you?". **Authorization** answers "what may you do?".

1. The learner signs up with email and password. Supabase Auth stores the password as a salted hash (see document 2 for what that means) and emails a confirmation link.
2. Sign-in returns a session: a short-lived **access token** (a JWT, a signed statement of who you are) and a **refresh token**. Both live in HTTP-only cookies the browser cannot read from JavaScript.
3. `proxy.ts` refreshes the access token on every request before it expires. Two hard-won rules are written in `packages/auth/src/session.ts`: do nothing between creating the client and reading the claims (a documented cause of random sign-outs), and copy refreshed cookies onto redirects (or you throw away the token you just issued).
4. Every handler derives the learner id from the verified token. Never from the body, the URL, or a cookie the client set.

The sign-up code answers identically whether or not an email is already registered, so nobody can probe which addresses have accounts.

### 5.2 Two-factor authentication (operator)

The operator app requires **TOTP** (Time-based One-Time Password: the six-digit code an authenticator app generates every thirty seconds). Supabase Auth holds the factor. The flow:

1. Password sign-in gives a session at assurance level **aal1**.
2. `requireOperator` in `apps/ops/lib/auth/require-operator.ts` asks three questions, in the order they fail closed: is there a session? Is its account id in the `OPERATOR_USER_IDS` allowlist? Has it presented a second factor (**aal2**)?
3. A password-only session reaches `/login/mfa` and nowhere else. A first sign-in enrols an authenticator at `/mfa/enrol`.
4. A signed-in account that is *not* on the allowlist is signed out of this origin and shown a **404, not a 403**. A distinguishable refusal is a way to enumerate who is an operator.

**Why an allowlist in configuration rather than a role column?** Both a `role` column and a JWT claim put the answer somewhere the subject of the question could influence. An environment variable on the operator's own server cannot be edited by a learner.

### 5.3 RBAC, as this project does it

**RBAC** (Role-Based Access Control) usually means a table of roles and permissions. This project has exactly two roles and expresses them structurally:

| Role | How it is established | What it can reach |
| --- | --- | --- |
| Learner | Signed-in Supabase account | Its own rows, via Row Level Security. The shared corpus, read-only. |
| Operator | Signed-in account **and** on the allowlist **and** aal2 **and** on the ops origin | Operator tables via the secret-key client, through `ops_*` database functions filtered on a learner id, every call audited under the operator's pseudonym. |

Every page, every Server Action and every route handler in the ops app calls the gate itself. **Nothing inherits it.** A Server Action is its own HTTP entry point and can be posted to without ever rendering the page whose check it would have inherited.

### 5.4 Row Level Security

**Row Level Security (RLS)** is a Postgres feature: a policy attached to a table that filters every query by a predicate the caller cannot bypass. Here the predicate is "the row's `learner_id` equals the id in the caller's token".

Two rules that a junior developer must never break, both enforced by database tests on real Postgres:

- Every `UPDATE` policy has both `USING` (which rows you may touch) **and** `WITH CHECK` (what the row may look like afterwards). Without `WITH CHECK` a learner could reassign their row to someone else.
- Operator tables (the ledger, budgets, the queue, product-ops) have RLS **enabled with no policy at all**. That denies everyone except the secret-key client, which bypasses RLS. A learner's browser cannot even learn the table exists.

Two Supabase clients exist and which one a piece of code gets is an explicit argument at the composition root, never a default. The request-scoped client carries the learner's token, so a bug cannot reach another learner's thread. The secret-key client is used for exactly the operator tables and the shared embedding cache.

### 5.5 Schema validation everywhere

Zod validates at every boundary:

- **External input**: every request body, every form, every query parameter. Strict objects reject unknown fields.
- **Model output**: every structured reply. Invalid means retry once with a repair instruction, then fall back. Never execute unvalidated model output.
- **Database rows on the way out**: generated types describe what the schema said at build time; the repository checks what the database actually returned.
- **Environment at boot**: a Supabase secret key pasted into a `NEXT_PUBLIC_` variable is a startup failure, not a breach. The legacy JWT-format keys are rejected because they retire at the end of 2026.
- **Job payloads**: a queue is a boundary. A job row the worker cannot parse is dead-lettered as invalid, never guessed at.

### 5.6 API security checklist (the order every endpoint follows)

1. Authenticate
2. Authorize
3. Validate input
4. Rate limit
5. Do the work
6. Validate outputs
7. Sanitize logging

Errors returned to the browser are a small closed set with safe messages ("Your tutor is unavailable right now"). Never a stack trace, never a provider message, never a reason that reveals whether a thread id exists.

### 5.7 Secrets: who holds what

| Secret | learner | ops | worker |
| --- | --- | --- | --- |
| `SUPABASE_SECRET_KEY` | yes | yes | yes |
| `LOG_PSEUDONYM_SALT` | yes, **same value** | yes, **same value** | yes, **same value** |
| `OPENROUTER_API_KEY` | yes | **never** | yes |
| `OPERATOR_USER_IDS` | **never** | yes | no |
| `GITHUB_TOKEN` | **never** | **never** | coder instance only |

A CI test reads the three `.env.example` files and asserts the absences. A break-in on the operator app cannot run up a model bill because there is no key to steal.

### 5.8 Four architecture rules with CI tests behind them

These are tests in `packages/security-tests/` that scan every source root and fail the build:

1. **Only `packages/gateway/src` may reach a model.** No provider SDK import, no request to a model endpoint anywhere else.
2. **No hardcoded model id outside `packages/gateway/src/registry.ts`.** Application code names a *tier*.
3. **No hardcoded price literal anywhere.** Prices carry a `fetched_at` stamp.
4. **No prompt-shaped string outside `packages/prompts/src`.**

Plus: no `SECURITY DEFINER` function in any migration, every user-owned table has RLS, `proxy.ts` exists and `middleware.ts` does not, and no client component imports a server-only module.

### 5.9 Privacy by design

Conversations are never stored. The transcript lives in the browser. What the database keeps is what the practice *meant*: errors, vocabulary, a per-level tally. The ledger holds a keyed hash of the learner id, not the id, so financial history survives an account deletion without ever having been able to identify anyone. Logs redact by key name on the way out: anything named like a credential or like something a learner said is replaced before the line is written.

---

## 6. Testing strategy

This section is the overview. Document 7 shows how to write each kind of test, how the fakes and the PGlite harness work, and how to run a mutation by hand.

**3,600+ tests across 242 test files**, plus 31 Python tests for the scenario ingestion. Here is how they are layered.

### 6.1 The pyramid

| Layer | Tool | Runs against | Count and speed | What it catches |
| --- | --- | --- | --- | --- |
| **Unit** | Vitest (Node) | Pure functions, schemas, prompt assembly, scoring, the turn graph with fake dependencies | Thousands, seconds | Logic errors. Most of the suite. |
| **Component** | Vitest (jsdom) + React Testing Library + MSW | React components in a simulated browser; MSW fakes the network | Hundreds, seconds | Rendering, accessibility roles, user interactions |
| **Database** | Vitest + PGlite | **Real Postgres** running in-process via WebAssembly. Every migration is applied, then the tests try to read another learner's rows as that learner and require it to fail. | Dozens of files, ~30s | Migrations that do not apply, missing constraints, RLS holes, function behaviour |
| **Security** | Vitest | Static scan of the source tree | ~50 tests, seconds | The four architecture rules, secret exposure, migration hygiene, deployable boundaries |
| **End-to-end** | Playwright | A **production build** of the learner app in a real Chromium | A handful, minutes | The sign-in and learner journey actually working in a browser |

**Why PGlite?** It is Postgres compiled to WebAssembly, so a test file boots a real database in about a second with no Docker and no network. It lacks two extensions (pgvector and pg_cron), so the harness substitutes those columns and a static test asserts the migrations really declare them. That gap is documented rather than hidden.

**Why MSW?** Mock Service Worker intercepts `fetch` at the network layer, so a component test exercises the real request code against a fake server rather than mocking a function that the real code might not call.

### 6.2 Test-driven development and mutation testing

The build spec requires TDD: write the failing test (RED), make it pass (GREEN), refactor. Beyond that, every phase is gated on **mutation testing**: deliberately break a line in the source and require the suite to fail. If it passes, the test was decoration. About 360 mutations have been run. The ones that *survived* found real bugs, including a prompt block that had shipped truncated mid-sentence for three phases because the version-lock hashed the intended text while the builder shipped the rendered one.

### 6.3 CI/CD guardrails

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Verify what changed.** `turbo run typecheck lint test build --filter=...[origin/main]`, affected packages only.
2. **The gates that guard the whole tree.** The security tests and the database tests run every time, unfiltered.
3. **End-to-end.** Playwright against a production build of the learner app.
4. **Images.** All three Docker images are built (not pushed) to prove the Dockerfiles.

`deploy-db.yml` pushes migrations first, forward-only, behind the production environment's approval. `deploy-apps.yml` builds only the deployables whose packages changed, tags images by git SHA, and deploys to Cloud Run. Staging deploys on every push to main; production is the same job behind a manual approval.

### 6.4 The definition of done

From the build spec, a change is complete only when: tests pass, types pass, lint passes, build passes, security assumptions are documented, no secrets are exposed, behaviour is observable, changed code has tests, every new model call declares a task, a tier and both ceilings, every new model call writes a ledger row, and there is no new hardcoded model id, price or direct provider call.

`pnpm verify` at the root is that gate. Run it before every commit.
