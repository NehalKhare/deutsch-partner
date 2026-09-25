# 2. Vocabulary and Tech Stack

A glossary and a dependency map. Read it once end to end, then come back to it whenever a word in the code or the other documents is unfamiliar. Every term is defined the first time it is used, and every choice is explained with what else could have been chosen.

---

## 1. Foundational stack

### 1.1 The big picture

```
Browser (React 19, streamed HTML and text)
   │  HTTPS
   ▼
Next.js 16 apps (learner on :3000, ops on :3001)   ──► OpenRouter (AI models)   [learner only]
   │  Supabase client over HTTPS
   ▼
Supabase: Postgres 17 + Auth + pgvector + pg_cron
   ▲
   │  Supabase client (secret key)
Node worker (drains the ops_jobs queue)              ──► OpenRouter, GitHub
```

### 1.2 Frontend

| Term | Definition | Why here |
| --- | --- | --- |
| **React 19** | A library for building user interfaces out of components: small functions that return what should be on screen for a given input. | The standard. Nearly every hire knows it. |
| **React Compiler** | A build step that automatically memoises components so they do not re-render when nothing they use has changed. Turned on in both apps via `babel-plugin-react-compiler`. | Removes a whole class of hand-written `useMemo`/`useCallback` boilerplate and the bugs that come with forgetting it. |
| **Next.js 16 (App Router)** | A framework on top of React that adds a file-based router (a folder is a URL), server-side rendering, route handlers (API endpoints) and Server Actions, all in one project. | One project holds both the pages and the server code that talks to the AI, and replies can stream word by word. **Alternatives rejected:** Remix (smaller ecosystem in 2026), a separate Express API plus a Vite React app (two deployables, two build systems, and no shared types without extra tooling). |
| **Server Component** | A React component that runs only on the server. It can read the database directly and ships no JavaScript to the browser. The default in the App Router. | Most pages here are Server Components: `dashboard/page.tsx` queries Postgres and renders HTML. |
| **Client Component** | A component marked `"use client"` that runs in the browser. Needed for anything interactive: a text box, a button that opens a menu. | The chat composer, the theme toggle, the live run feed. A CI test forbids a Client Component from importing server-only modules. |
| **Server Action** | A function marked `"use server"` that the browser can call like a form submit. Next.js handles the network call. | Every `actions.ts` file. Sign-in, settings, "approve proposal". Each one re-checks authorization because it is its own HTTP entry point. |
| **Route handler** | A file called `route.ts` exporting `GET`/`POST`. A plain HTTP endpoint. | Used where a Server Action cannot: streaming a reply, returning audio, an SSE feed. |
| **Tailwind v4** | A CSS framework where you style by composing small utility classes (`flex`, `gap-2`, `bg-panel`). Version 4 is "CSS-first": the theme is an `@theme` block in a CSS file, not a JavaScript config. | Fast to write, hard to make inconsistent. The house style is composing the class strings exported from `@dp/ui/styles` rather than writing new ones. |
| **Design tokens** | Named values (`--color-ground`, `--color-brand`) that every class refers to instead of a hex code. | Named for the **role** they play, not the colour they are. `bg-ground` is the page background in both dark and light themes and in both products. The ops app swaps the values, never the names. |
| **Streaming** | Sending the response body in pieces as it becomes available, instead of waiting for all of it. | The tutor's reply appears word by word. |

### 1.3 Backend

| Term | Definition | Why here |
| --- | --- | --- |
| **Node.js 22** | The JavaScript runtime outside the browser. `.nvmrc` pins version 22. | Same language front and back. One team, one type system. |
| **TypeScript (strict)** | JavaScript with types checked before the code runs. `strict` mode turns on every check. | Catches whole categories of bugs at compile time. Shared types across the monorepo mean the database row shape, the API body shape and the prompt input shape are one definition. |
| **Zod v4** | A library for describing the shape of data and validating unknown values against it at runtime, producing a typed value. | TypeScript types vanish at runtime; a request body from the network is `unknown`. Zod is how `unknown` becomes a trusted type. Used for external input, model output, database rows, environment variables and job payloads. |
| **Composition root** | The one file per app that wires concrete dependencies together (which database client, which logger, which model gateway). `lib/api/composition.ts` in each app. | Everything else takes its dependencies as arguments, which is what makes it testable with fakes. |
| **Repository** (pattern) | A module that is the only code allowed to talk to a table. Takes a database client, returns domain types, never lets a raw database error escape. | `packages/db/src/*-repository.ts`. A CI test names exactly which files may touch the database. |
| **Idempotent** | An operation that has the same effect whether you run it once or ten times. | Every worker job and every product-ops stage. A retry after a crash must not create `feature-123-2`. |
| **Compare-and-set (CAS)** | An update that says "change stage from A to B **only if it is still A**". If someone else changed it first, yours is rejected. | How two workers racing on one run are made safe. `advance_product_ops_run` in the database. |
| **At-least-once delivery** | A queue guarantee: a job will run at least once, possibly more, never zero times. The consumer must be idempotent. | The `ops_jobs` queue. A dead worker's lock expires and the job comes back. |
| **Dead letter** | A job that has failed its maximum attempts (5 here) and is parked as `failed` for a human to look at. | `select * from ops_jobs where status = 'failed'`. |
| **Heartbeat** | A periodic signal that says "I am still working on this". | The worker extends its job lock every ~30 seconds so a slow build is not handed to a second worker. |
| **Correlation id** | One id stamped on every log line, queue row and event that belongs to the same piece of work, across processes. | A run's request id. You can read an operator's click, the job and every worker event as one story. |
| **Pseudonym** | A stable identifier derived from a real one by a keyed hash, so "the same learner" is recognisable but "which learner" is not recoverable. | `LOG_PSEUDONYM_SALT` + HMAC-SHA256. Used in logs, the ledger, the rate limiter and the audit trail. |
| **OpenTelemetry (OTel)** | A vendor-neutral standard for emitting traces (a request's journey across spans), metrics (numbers over time) and logs. | The worker exports over OTLP to Grafana Cloud when configured; runs identically with it off. |
| **LangSmith** | A tracing service for LLM applications: every prompt, every model call, every tool call, with tokens and latency. | Observability only, never a call path. |

### 1.4 Database

| Term | Definition | Why here |
| --- | --- | --- |
| **PostgreSQL 17** | A relational database: tables with typed columns, foreign keys, constraints, transactions. | See 1.5. |
| **Supabase** | Hosted Postgres plus an Auth service, an auto-generated REST API (PostgREST), a CLI for migrations, and a local development stack. | One vendor gives us the database, sign-in, TOTP second factor and row-level security. **Alternatives:** Firebase (document store; no RLS in the SQL sense, no pgvector), Neon plus Clerk (two vendors to wire together), self-hosted Postgres (operational burden with no one to carry it). |
| **Migration** | A SQL file that changes the schema, applied in order, never edited after it ships. 52 of them in `packages/db/supabase/migrations`. | The schema's git history. Forward-only: a change is a new file. |
| **Row Level Security (RLS)** | A Postgres policy on a table that filters every row by a predicate the caller cannot bypass. | A learner can only read rows where `learner_id = auth.uid()`. Enforced by the database even if the application has a bug. |
| **`SECURITY INVOKER` vs `SECURITY DEFINER`** | A database function runs with the *caller's* permissions (invoker) or its *author's* (definer). | Every function here is INVOKER. A DEFINER function is a way to accidentally hand a learner the author's privileges. A test forbids them. |
| **PostgREST / `rpc`** | Supabase exposes every table and function as HTTP. `client.rpc("claim_job", {...})` calls a Postgres function. | How the apps call database functions without a direct connection string. |
| **pgvector** | A Postgres extension adding a `vector(1536)` column type, a cosine distance operator (`<=>`) and an **HNSW** index (a graph structure for fast approximate nearest-neighbour search). | Vector search in the same query as the level filter. |
| **`tsvector` / GIN index** | Postgres full-text search: a column of stemmed words and an inverted index over it. | The lexical arm of retrieval, with the German dictionary. |
| **pg_cron** | A Postgres extension that runs SQL on a cron schedule inside the database. | Enqueues the six recurring jobs. No worker owns a clock. |
| **`FOR UPDATE SKIP LOCKED`** | A SQL clause: lock the rows I select, and skip any row someone else already holds. | The whole job queue in one clause. |
| **Generated column** | A column whose value Postgres computes from other columns and stores. | `level_performances.score` and `knowledge_chunks.content_tsv`. Cannot drift from their inputs. |
| **PGlite** | Postgres compiled to WebAssembly, runnable inside a Node test with no server. | The database tests apply every migration to a real engine in about a second. |

### 1.5 Postgres vs MongoDB, candidly

**MongoDB** is a document database: you store JSON-like documents with no fixed schema, grouped in collections. It is excellent when each record is self-contained and the shape varies.

**Why Postgres won here:**

1. **Invariants belong in the database.** A vocabulary row must satisfy `correct_count + incorrect_count <= exposure_count` and a `mastered` status must have `mastery_score >= 0.6`. Postgres `CHECK` constraints enforce these on every write from any code path. In Mongo the application must remember to check, and the second code path that forgets creates a row the first one cannot explain.
2. **Row Level Security.** There is no equivalent in Mongo of "the database itself refuses to show you rows that are not yours". We would be relying on every query remembering a `WHERE learner_id = ?`.
3. **One database, many jobs.** Vector search, full-text search, a job queue, rate limiting, a scheduler and the relational data all live in one Postgres. With Mongo we would still need a vector store, a queue and a scheduler as separate services.
4. **Transactions across tables.** Writing a ledger row and incrementing its four budget counters must be atomic. `record_model_invocation` does that in one function.

**Where Mongo would have won:** if learner records were large, irregular documents that were always read whole and never joined. They are not. Every screen is a join.

---

## 2. Authentication glossary, via the security badge

Imagine an office building with a reception desk.

| Term | Definition | The badge analogy |
| --- | --- | --- |
| **Credentials** | What you present to prove who you are: email and password. | Your ID and the PIN only you know. |
| **Hash** | A one-way function: input goes in, a fixed-length scramble comes out, and there is no way back. The same input always gives the same output. | Reception does not keep a photocopy of your ID. They keep a fingerprint of it that cannot be turned back into the ID. |
| **Salt** | Random data mixed into the input before hashing, stored alongside the hash, so two people with the same password get different hashes and a precomputed lookup table is useless. | Each fingerprint is taken with a different ink. Two identical IDs leave different prints. |
| **Keyed hash (HMAC)** | A hash where a *secret* key is mixed in. Without the key you cannot even compute the hash, let alone reverse it. | The pseudonym in our logs. Reception's ink is a secret recipe, so an outsider cannot make matching prints even from a list of IDs. |
| **Session** | The server's memory that you have already proved who you are, so you do not repeat it on every request. | The visitor badge you are given after reception checks your ID. |
| **JWT (JSON Web Token)** | A compact, signed statement ("this is user X, valid until T") that a server can verify without asking anyone. Supabase issues one as the **access token**. | A badge printed with your name and expiry, sealed with a hologram only the building can produce. Any door can check the hologram without phoning reception. |
| **Refresh token** | A longer-lived secret used to get a new access token when the old one expires. | A voucher you hand to reception for a fresh badge when yours runs out. |
| **HTTP-only cookie** | A cookie the browser sends with every request but that JavaScript on the page cannot read. | The badge is clipped to you by reception. A script running in a compromised page cannot pocket it. |
| **Session refresh** (`proxy.ts`) | Renewing the access token shortly before it expires, on every request. | Reception re-stamps your badge as you pass, so it never runs out mid-visit. |
| **Two-factor / MFA / TOTP** | Proving identity with two independent things: something you know (password) and something you have (a phone generating a six-digit code every 30 seconds). | The server room needs your badge **and** a code from the token on your keyring. Stealing the badge is not enough. |
| **Assurance level (aal1 / aal2)** | Supabase's name for "one factor presented" vs "two factors presented". | Blue badge (lobby only) vs red badge (server room). |
| **Allowlist** | An explicit list of who is permitted. Absent from the list means denied. | The server-room door has a printed list. Not on it, not in. Empty list, nobody in. |
| **Enumeration** | An attack that learns which accounts exist by noticing different responses. | If reception said "we have no visitor by that name" vs "wrong PIN", a stranger could learn who works here. So reception says the same thing both times. Our sign-up and 404-not-403 both follow this. |
| **Fail closed** | When the system cannot decide, deny. | If the badge reader loses power, the door stays locked, not open. |

---

## 3. State and communication

### 3.1 Client state vs server state

| Term | Definition | Here |
| --- | --- | --- |
| **Client state** | Data that lives in the browser and is gone when the tab closes, unless persisted. | The **whole chat transcript**. Also: which tab is open, a collapsed panel. |
| **Server state** | Data held by the backend and returned on request. | Learner profile, per-level tallies, the proposal board. |
| **Persistent client state** | Client state saved in the browser's own storage (`localStorage`). | The theme choice, the read-aloud preference, "hide the mastery strip". Per device, never seen by the server. |
| **Optimistic UI** | Showing the result of an action before the server confirms it. | Not used here on purpose: a tutor's reply is not something you can guess. |
| **Server-rendered** | HTML produced on the server with the data already in it. | Every dashboard page. No loading spinner; the page arrives full. |

**Why the transcript is client state:** the product promises that what you say is never stored. The only way to keep that promise is to have no table it could be written to. The migration `20260822110000_ephemeral_conversations.sql` drops the messages table outright, because a table that exists is a table something can quietly start writing to again.

### 3.2 Communication protocols

| Protocol | What it is | Analogy | Used here for |
| --- | --- | --- | --- |
| **REST over HTTP** | Request, response, done. Stateless. Each URL is a resource; verbs (`GET`, `POST`) say what to do with it. | Sending a letter and getting a reply. | Every page, every action, `/api/health`, `/api/scenarios/search`. |
| **HTTP streaming** | One request, one response, but the body arrives in chunks over time. | Reading a fax as it prints. | `/api/chat` and `/api/trainer` reply text. |
| **Server-Sent Events (SSE)** | A long-lived HTTP response where the server sends named events (`event: timeline`, `data: {...}`) as they happen. One direction: server to browser. The browser's `EventSource` reconnects automatically and sends `Last-Event-ID`. | A radio station. You tune in; it keeps broadcasting; if you lose signal you retune and it tells you what you missed. | `/api/runs/[runId]/events`, the live product-ops feed. |
| **WebSockets** | A persistent two-way connection where either side can send at any time. | A phone call. | **Not used.** The right tool when the *browser* must also push many small messages, such as collaborative editing or a multiplayer roleplay. Adds connection-state management and does not pass through every proxy as easily as SSE. When you need it, Supabase Realtime provides it over Postgres changes. |
| **gRPC** | A binary, strictly typed remote-procedure-call protocol with generated client code, used between services. | An internal pneumatic tube system between departments. | **Not used.** Valuable with many services and a strict contract. We have three processes and one database; the database *is* the contract. |
| **Polling** | The browser asking "anything new?" on a timer. | Checking the letterbox every few minutes. | The runs page, bounded: it stops asking once a run has been quiet longer than the slowest stage. |
| **Queue** | A table of "please do X" rows, drained by a separate process. | The order rail in a kitchen. | `ops_jobs`. |

**When to pick which, in one line each:** REST for anything under a second. Streaming when the answer is long and can be shown as it arrives. SSE when the server has a series of events and the browser only listens. WebSockets when both sides talk constantly. A queue when the work outlives the request.

---

## 4. Key dependencies, in plain English

### 4.1 Root `package.json`

| Package | What it does | Why |
| --- | --- | --- |
| `turbo` | Runs tasks across the workspace, in dependency order, with caching. | The assembly-line manager. |
| `@opentelemetry/api` | The telemetry API surface. | Listed at root so every package resolves the same instance; OTel breaks if two copies exist. |

The root scripts are the everyday commands: `pnpm dev`, `pnpm verify`, `pnpm db:push`, `pnpm ingest`. Document 6 lists them.

### 4.2 Shared through the pnpm catalog

| Package | What it does | Why one pinned version |
| --- | --- | --- |
| `next`, `react`, `react-dom` | The framework and the UI library. | Two React versions in one page break hooks. |
| `zod` | Runtime validation. | One schema library, one error shape everywhere. |
| `typescript`, `eslint`, `eslint-config-next` | Types and linting. | Consistent rules in every package. |
| `vitest`, `@vitejs/plugin-react`, `jsdom` | The test runner, its React plugin, a simulated browser DOM. | `globals` is off: import `describe`/`it`/`expect` from `vitest`. |
| `@testing-library/*` | Query rendered components the way a user would ("the button named Send"). | Tests that survive refactors. |
| `msw` | Mock Service Worker: intercepts `fetch` in tests. | Component tests exercise real request code against a fake server. |
| `@supabase/supabase-js`, `@supabase/ssr` | The Supabase client, and the helper that stores its session in cookies for server rendering. | Sign-in, database access via PostgREST, RLS-aware queries. |
| `@langchain/core`, `langchain`, `@langchain/openai`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint`, `@langchain/mcp-adapters`, `langsmith` | The LangChain family. See document 3. | `@langchain/core` must be a single instance or messages from one copy are not recognised by another. `@langchain/openai` is allowed **only** in `packages/gateway`; a test asserts it. |
| `@electric-sql/pglite` | Postgres in WebAssembly for tests. | Real database tests without Docker. |
| `clsx`, `tailwind-merge` | Join class names conditionally; resolve conflicting Tailwind classes. | The `cn()` helper in `@dp/ui/utils`. |
| `server-only` | A package that throws if imported into a Client Component. | A tripwire: `import "server-only"` at the top of a file guarantees it never reaches the browser bundle. |
| `tsx` | Runs TypeScript directly in Node without a build step. | The worker and every CLI script. |
| `@next/env` | Loads `.env.local` the same way Next does, for scripts outside Next. | `pnpm dummy:user` and friends. |

### 4.3 `apps/learner`

Beyond the shared set:

| Package | What it does |
| --- | --- |
| `@dp/*` (nine workspace packages) | Auth, db, domain, env, gateway, learning, observability, prompts, ui. |
| `framer-motion` | Animation library. The companion character and the trainer invite. |
| `lucide-react` | Icon set. |
| `react-aria-components` | Accessible UI primitives (menus, dialogs) with keyboard and screen-reader behaviour built in. |
| `class-variance-authority`, `shadcn`, `tw-animate-css` | Utilities from the shadcn component ecosystem for variant-driven class strings and animations. |
| `@playwright/test` | End-to-end browser tests against a production build. |
| `babel-plugin-react-compiler` | Enables the React Compiler. |
| `@tailwindcss/postcss`, `tailwindcss` | Tailwind v4 via PostCSS. |

Python (`scripts/scenarios/`, run through `uv`): the offline scenario parser and ingestion, with `pytest` tests and a `ragas` evaluation. Deliberately outside the TypeScript gateway and therefore **not ledgered**; document 6 lists this as known debt.

### 4.4 `apps/ops`

The same shape as the learner minus everything AI: **no** `@dp/gateway`, **no** `@dp/prompts`, **no** LangChain. Adds `@dp/product-ops` for the board's read models and the SSE stream. A CI test asserts these absences.

### 4.5 `apps/worker`

No Next.js, no React. `@dp/corpus` (the knowledge documents it ingests), `@dp/gateway`, `@dp/product-ops`, `@dp/learning`, and the OpenTelemetry SDK packages for exporting traces and metrics. Runs from TypeScript source via `tsx`.

### 4.6 The packages

| Package | Notable dependencies | Role |
| --- | --- | --- |
| `@dp/domain` | `zod` only | Schemas and pure rules. Imports nothing from above. |
| `@dp/db` | `@dp/domain`, `supabase` CLI (dev), `@electric-sql/pglite` (dev) | Migrations, repositories, the PGlite harness. |
| `@dp/gateway` | `@langchain/core`, `@langchain/openai`, `@dp/db`, `@dp/prompts`, `@dp/observability` | The one door to any model. |
| `@dp/prompts` | `@dp/domain` | The versioned prompt catalogue. Calls no model. |
| `@dp/product-ops` | `@langchain/langgraph`, `langchain`, `@dp/gateway` | The operator workflow graph and agents. |
| `@dp/learning` | `@dp/db`, `@dp/domain` | Curriculum data and the engines (mastery, progression, spaced repetition). |
| `@dp/auth` | `@supabase/ssr`, `@supabase/supabase-js` | Session refresh, credentials, the allowlist parser. |
| `@dp/env` | `zod` | Environment validation. |
| `@dp/observability` | `@opentelemetry/*` | Logger with redaction, pseudonyms, telemetry setup, LangSmith config. |
| `@dp/ui` | `react`, `clsx`, `tailwind-merge` | Themes, class strings, a few shared components. |
| `@dp/corpus` | none | Markdown knowledge documents and the scenario dataset. Data only. |
| `@dp/security-tests` | none | The CI gates. |
| `@dp/test-support` | `msw`, `@testing-library/*`, `@langchain/core` | Fake Supabase, fake tool-calling model, MSW setup. |
| `@dp/config` | `eslint`, `typescript`, `vitest` presets | Shared configuration. |
