# 4. Folder and Codebase Guide

Where everything lives, what it does, and an everyday analogy for each part. The tree is trimmed to what matters; generated folders (`node_modules`, `.next`, `.turbo`) are omitted.

---

## 1. Directory tree

```
deutsch-partner/
├── AGENTS.md                    Project instructions for humans and AI assistants (CLAUDE.md points here)
├── README.md                    Product overview
├── package.json                 Root scripts: dev, verify, db:*, ingest, docker:*
├── pnpm-workspace.yaml          Workspace members and the dependency version catalog
├── turbo.json                   Task graph and caching rules
├── docker-compose.yml           Runs the three production images locally
├── .nvmrc                       Node 22
├── .dockerignore
│
├── .claude/docs/                THE SPECIFICATIONS (normative)
│   ├── README.md                  Reading order and precedence rule
│   ├── business-objective.md      What we are building and why
│   ├── build-spec.md              TDD phases, definition of done
│   ├── security-observability-guardrails.md   Overrides convenience
│   ├── model-routing-and-cost-control.md      Overrides any model guidance
│   ├── system-prompt-catalogue.md
│   ├── cost-dashboard-spec.md
│   └── product-ops-spec.md
│
├── docs/                        WHAT WAS ACTUALLY BUILT (descriptive)
│   ├── README.md
│   ├── product-flow.md            What a learner does and what happens
│   ├── architecture.md            Boundaries and why; "What is not built"
│   ├── topics.md                  Plain-language RAG, prompting, LangChain, Next.js
│   ├── operations.md              Env vars, commands, cost, troubleshooting
│   ├── deployment.md              Images, Cloud Run, secrets
│   ├── product-ops-agents.md      The graph, gates and agents drawn
│   └── product-ops-multi-agent-proposal.md
│
├── onboarding/                  THIS FOLDER
│
├── docker/
│   ├── next-app.Dockerfile        One Dockerfile for both Next.js apps (APP=learner|ops)
│   ├── worker.Dockerfile
│   ├── worker-entrypoint.sh       Clones the repo at start for the coder queue
│   └── git-askpass.sh             Feeds the GitHub token to git without it touching disk
│
├── deploy/cloudrun/             Knative Service manifests (templates)
│   ├── learner.yaml  ops.yaml  worker.yaml  worker-coder.yaml
│
├── .github/
│   ├── actions/setup/             Node 22 + pnpm + frozen install
│   └── workflows/
│       ├── ci.yml                 Verify, security + db gates, e2e, image builds
│       ├── deploy-db.yml          Migrations first, forward-only
│       └── deploy-apps.yml        Build, push, deploy changed deployables
│
├── apps/
│   ├── learner/                 THE LEARNER PRODUCT  (Next.js, :3000)
│   │   ├── app/
│   │   │   ├── (app)/             Signed-in rooms: chat, curriculum, dashboard, review, scenarios, settings, trainer
│   │   │   ├── api/               Route handlers: chat, trainer, speak, transcribe, scenarios, health
│   │   │   ├── auth/              login, sign-up
│   │   │   ├── onboarding/
│   │   │   ├── layout.tsx  page.tsx  globals.css
│   │   ├── components/            React components by room (chat, trainer, voice, companion, ...)
│   │   ├── lib/
│   │   │   ├── api/               Route logic with the framework left outside; composition root; rate limit
│   │   │   ├── graph/             The chat turn: state, nodes, runner, intent
│   │   │   ├── retrieval/         Hybrid retriever: search, fusion, scoring, filters
│   │   │   ├── trainer/           The agent, its tools, agenda, news, coaching, MCP
│   │   │   ├── ai/evaluation/     The second-model grader and its triage
│   │   │   ├── auth/  supabase/  env/  curriculum/  dashboard/  scenarios/  settings/  onboarding/
│   │   ├── proxy.ts               Session refresh on every request (Next 16 name for middleware)
│   │   ├── scripts/
│   │   │   ├── create-dummy-user.ts
│   │   │   └── scenarios/         Python (uv): scenario parser, ingestion, ragas eval
│   │   ├── tests/                 unit/ db/ e2e/ golden/
│   │   ├── .env.example
│   │   └── playwright.config.ts  vitest.config.mts  next.config.ts
│   │
│   ├── ops/                     THE OPERATOR PRODUCT  (Next.js, :3001)
│   │   ├── app/
│   │   │   ├── (ops)/             costs/ (overview, invocations, budgets, pricing), learners/, feedback/, product/ (board, runs)
│   │   │   ├── api/               health, runs/[runId]/events (SSE)
│   │   │   ├── login/  login/mfa/  mfa/enrol/
│   │   ├── components/            costs/, learners/, operations/, login and enrol forms
│   │   ├── lib/
│   │   │   ├── auth/              require-operator.ts (the gate), mfa.ts, operator.ts
│   │   │   ├── api/               composition root, rate limit
│   │   │   ├── costs.ts  budgets.ts  pricing.ts  ledger-query.ts  learner-*.ts  spend-*.ts
│   │   ├── proxy.ts
│   │   ├── tests/unit/
│   │   └── .env.example
│   │
│   └── worker/                  THE BACKGROUND WORKER  (Node, no web framework, :8080 health)
│       ├── src/
│       │   ├── main.ts            Boot: env, wiring, health server, loop
│       │   ├── loop.ts            Claim, heartbeat, run, report; two concurrency budgets
│       │   ├── handlers/          One file per job kind: drive, implement, ingest, fx-refresh, pricing-snapshot, cost-rollup, prune, purge, reconcile
│       │   ├── ingestion/         Chunking, cleaning, embedding pipeline, sources
│       │   ├── fx/                Euro rate source and refresh
│       │   ├── cli/               Run one job in-process: ingest, fx-refresh, cost-rollup, product-implement
│       │   ├── composition.ts  env.ts  health.ts  instruments.ts  corpus.ts
│       ├── tests/
│       └── .env.example
│
└── packages/
    ├── domain/                  Zod schemas and pure rules. Imports nothing above it. tasks.ts is the routing table.
    ├── db/                      Migrations (supabase/migrations/*.sql), repositories, PGlite harness
    ├── gateway/                 THE ONLY CODE THAT MAY CALL A MODEL. registry.ts, gateway.ts, budget-gate.ts, ledger.ts, stream-guard.ts, langchain-model.ts, voice/
    ├── prompts/                 THE ONLY PLACE PROMPT TEXT MAY LIVE. catalogue.ts, builder.ts, blocks.ts, delimiters.ts, behavior-policy.ts, trainer.ts, product-ops-agents.ts
    ├── product-ops/             The operator workflow: graph/, agents/, workflow.ts, repository.ts, apply.ts, stream.ts, view.ts
    ├── learning/                Curriculum data (mini-levels, vocabulary, grammar, culture) and the engines: mastery, progression, review, error-engine
    ├── auth/                    Session refresher, credentials, claims, cookies, operator allowlist parser
    ├── env/                     schema.ts: environment validation
    ├── observability/           logger.ts (redacting), pseudonym.ts, telemetry.ts, langsmith.ts
    ├── ui/                      theme.css, theme-ops.css, styles.ts, theme toggle/script, a few shared components
    ├── corpus/                  content/ (Markdown knowledge docs) and dataset/ (scenarios). Data only.
    ├── security-tests/          The CI gates: ai-boundaries, deployables, migration-policy, secret-exposure. roots.ts knows the layout.
    ├── test-support/            Fake Supabase, fake tool-calling model, MSW setup, jsdom setup
    └── config/                  Shared tsconfig, eslint, vitest presets
```

---

## 2. Directory breakdown

For each major folder: what is in it, what it is for, and an analogy.

### 2.1 Root files

**Contents:** `package.json` (root scripts only, no application code), `pnpm-workspace.yaml`, `turbo.json`, `docker-compose.yml`, `AGENTS.md` (which `CLAUDE.md` includes), `README.md`, `.nvmrc`.

**Purpose:** declare the workspace, its dependency versions, its task graph, and the everyday commands. Nothing here runs in production.

**Analogy:** the front office of the building. It holds the directory of tenants, the building rules, and the master key list, but no one works there.

### 2.2 `.claude/docs/` — the specifications

**Contents:** seven long documents plus a `README.md` stating the reading order and the precedence rule: guardrails > model-routing > (prompt-catalogue = cost-dashboard = product-ops) > build-spec > business-objective.

**Purpose:** the source of the rules. When a question about "should this be a model call?" or "which tier?" or "may this app hold this key?" comes up, the answer is in here and disagreements are resolved by editing the document, not at the keyboard.

**Analogy:** the building code and the planning permission. You do not argue with the inspector; you change the drawings.

### 2.3 `docs/` — what was actually built

**Contents:** the four read-in-order documents (product flow, architecture, topics, operations), plus deployment and two product-ops documents.

**Purpose:** describe the system as it is, including a deliberately honest "What is not built" section in `architecture.md`. When these disagree with the specs, the specs win and the docs are wrong.

**Analogy:** the as-built drawings that the contractor hands over. They show where the pipes actually went, including the ones that are still capped off.

### 2.4 `apps/learner/` — the learner product

**Contents:** a Next.js 16 app. `app/` is the router: a folder is a URL, `page.tsx` is what it renders, `route.ts` is an API endpoint, `actions.ts` holds Server Actions, `layout.tsx` wraps its children. The `(app)` folder is a **route group**: parentheses mean it does not appear in the URL; it exists so every signed-in room shares one layout. `components/` holds React components grouped by room. `lib/` holds all the logic with the framework left outside, so it can be tested without a server.

**Purpose:** everything a learner touches: onboarding, chat, curriculum, review, scenarios, the Trainer, settings, voice. It holds a model key and calls the gateway for chat, trainer and embeddings.

**Analogy:** the classroom building. Students walk in through reception (`auth/`), go to a room (`(app)/chat`, `(app)/trainer`), and every room's furniture is in `components/`. The teachers' preparation room, where the actual thinking happens, is `lib/`.

Inside `lib/`, the four folders you will spend the most time in:

| Folder | Contents | Analogy |
| --- | --- | --- |
| `lib/api/` | `chat.ts` (the turn handler), `trainer.ts`, `voice.ts`, `scenarios.ts`, `composition.ts` (the wiring root), `rate-limit.ts`, `pseudonym.ts` | The reception desk's procedures manual: check ID, check the visitor count, then hand the visitor to the right department. |
| `lib/graph/` | `state.ts`, `nodes.ts`, `turn.ts`, `intent.ts` | The lesson plan for one turn: load the student's file, check the room booking, look up material, teach, then mark the work after the student has left. |
| `lib/retrieval/` | `retriever.ts`, `search.ts`, `fusion.ts`, `scoring.ts`, `filters.ts`, `repository.ts` | The librarian: two catalogue searches at once, merge the results, pull the five most useful pages at the student's reading level. |
| `lib/trainer/` | `agent.ts`, `tools.ts`, `agenda.ts`, `news.ts`, `coaching.ts`, `analysis.ts`, `miner.ts`, `mcp.ts` | The personal coach: builds today's workout list, runs the drills one at a time, writes the result in the student's record. |

`proxy.ts` at the app root refreshes the Supabase session on every request. It is the Next 16 name for `middleware.ts`, and a CI test asserts the old name is absent.

`scripts/scenarios/` is Python, run through `uv`. It parses the scenario dataset and embeds it directly (outside the gateway, so not ledgered). It has its own tests via `pnpm scenarios:test`.

### 2.5 `apps/ops/` — the operator product

**Contents:** a second Next.js app on its own origin. `app/(ops)/costs/` is the spend dashboard with sub-tabs for the ledger, budgets and pricing. `app/(ops)/learners/` is the learner directory and one learner's page with support actions and a JSON export. `app/(ops)/feedback/` aggregates trainer votes. `app/(ops)/product/` is the proposal board and `product/runs/` the scan form and live run cards. `app/login/`, `app/login/mfa/`, `app/mfa/enrol/` are the two-factor sign-in. `app/api/runs/[runId]/events/route.ts` is the SSE feed. `lib/auth/require-operator.ts` is the gate every page and action calls.

**Purpose:** watch money, look after learners, and run the AI product-ops pipeline. It **holds no model key and no repository token**; it records jobs and reads results. `theme-ops.css` swaps the palette to Atlassian blue so nobody confuses it with the learner app.

**Analogy:** the school office. Behind a locked door with a keypad (password + authenticator code). The staff can see attendance, the budget and the maintenance requests, and they can *file* a request for the caretaker, but they cannot pick up the tools themselves.

### 2.6 `apps/worker/` — the background worker

**Contents:** `main.ts` boots and wires; `loop.ts` polls the queue, claims a job with a lock, heartbeats it, runs the handler and reports the outcome; `handlers/` has one file per job kind; `ingestion/` is the corpus pipeline (clean, chunk, embed, store); `fx/` fetches the euro rate; `cli/` lets you run one job in-process from a terminal; `health.ts` answers `/healthz` and `/readyz`.

**Purpose:** do the slow and scheduled work so no web page waits for it. One image serves two roles: with `WORKER_QUEUES=jobs` it does everything but the coding stage; with `WORKER_QUEUES=coder`, a git checkout and a GitHub token, it runs `productops.implement`. Only that instance holds the token.

**Analogy:** the caretaker. Checks the request board every couple of seconds, takes the oldest ticket, does the job, ticks it off. If they collapse mid-job, the ticket's "in progress" stamp expires and a colleague picks it up. They keep two hands free for quick jobs even while a long one is under way.

### 2.7 `packages/domain/` — the foundation

**Contents:** Zod schemas for every domain object (`learner.ts`, `conversation.ts`, `vocabulary.ts`, `mini-level.ts`, `cefr.ts`, `product-ops.ts`, `jobs.ts`, ...) and pure functions with no input/output. `tasks.ts` is the **task routing table**: every AI task, its tier and its two token ceilings. `tutor.ts` declares who Jonas is, once.

**Purpose:** one definition of every shape. Imports nothing from any other package.

**Analogy:** the dictionary and the rulebook. Every other department quotes it; it quotes no one.

### 2.8 `packages/db/` — the database layer

**Contents:** `supabase/migrations/` holds 52 forward-only SQL files (tables, RLS policies, functions, the queue, pg_cron schedules, seeds). `supabase/config.toml` configures the Supabase CLI. `src/*-repository.ts` are the only code allowed to touch each table; they validate every row against a domain schema on the way out and map database errors to a closed set. `src/testing/harness.ts` boots PGlite, strips the two extensions it lacks, applies every migration and shims `auth.uid()`.

**Purpose:** the schema's history and the typed doors into it.

**Analogy:** the archive and its archivists. The migrations are the binding record of every change to the filing system. The repositories are the archivists: you ask them for a record and they hand you a checked copy; you never go into the stacks yourself.

### 2.9 `packages/gateway/` — the one door to any model

**Contents:** `registry.ts` (the only file that may name a model), `gateway.ts` (the four enforcement layers and the ledger write), `call-spec.ts`, `router.ts`, `budgeter.ts` (pre-flight token shedding), `budget-gate.ts` (euro scopes), `stream-guard.ts`, `ledger.ts`, `accounting.ts`, `pricing.ts`, `fx.ts`, `openrouter.ts` and `openrouter-embeddings.ts` (the transports), `langchain-model.ts` (the LangChain face for agents), `voice/`, `repositories/` (ledger and embedding cache).

**Purpose:** be the only path to a provider, so that ceilings, budgets, accounting and redaction are unconditional. A CI test lists exactly which files inside it may open a connection.

**Analogy:** the cashier's window at a bank. Every transaction goes through it, gets counted, gets a receipt, and is refused if the account is empty. There is no side door to the vault.

### 2.10 `packages/prompts/` — the prompt catalogue

**Contents:** `catalogue.ts` (every prompt as a named, versioned entry), `builder.ts` (assembles blocks in order, caps each, sheds in the fixed order), `blocks.ts`, `sections.ts`, `delimiters.ts` (fencing and bracket escaping), `behavior-policy.ts` (one row per level), `contract.ts` (output shape generated from the Zod schema), `fingerprint.ts` (the version lock), `repair.ts`, `trainer.ts`, `product-ops-agents.ts`, `voice.ts`, `tokens.ts`.

**Purpose:** the only place prompt text may live. It calls no model.

**Analogy:** the scriptwriters' room. Every line an actor speaks is written here, numbered and dated. Actors do not improvise, and if a line changes the script number changes.

### 2.11 `packages/product-ops/` — the operator workflow engine

**Contents:** `graph/` (the LangGraph `StateGraph`, its state, the Postgres checkpoint saver), `agents/` (runtime, middleware, tools), `workflow.ts` (`advanceRun`: one stage, idempotently, with compare-and-set), `research.ts`, `cpo.ts`, `prd.ts`, `planner.ts`, `coder.ts` (the specialists), `apply.ts` (the trusted validation layer for file edits: allowlist, deny-list), `workspace.ts` (worktrees), `commands.ts` (the command allowlist), `github.ts`, `repository.ts`, `view.ts` (board read models), `stream.ts` (the SSE generator), `review.ts`, `feedback.ts`.

**Purpose:** research the market, propose a feature, ask a person, write a PRD, plan the code, ask a person again. The board in the ops app reads from it; the worker runs it.

**Analogy:** a product committee with a strict procedure. Analysts gather evidence, a chief product officer drafts a proposal, a manager signs it, a writer produces the spec, an engineer plans the work, the manager signs again. Nobody skips a step and every step is minuted.

### 2.12 `packages/learning/` — the curriculum and its engines

**Contents:** data (`mini-levels.ts`, `vocabulary-catalogue.ts`, `grammar-catalogue.ts`, `culture-catalogue.ts`) and their SQL seed generators; engines (`mastery.ts`, `progression.ts`, `review.ts` for spaced repetition, `vocabulary-engine.ts`, `error-engine.ts`, `recommendation-ranking.ts`).

**Purpose:** the seventy mini-levels, 420 words and 86 patterns as data, and the pure arithmetic that moves a learner through them. **No model calls here, by rule.**

**Analogy:** the syllabus and the mark scheme. What is taught is written down in advance; whether a student has passed a unit is a calculation over their marks, not a teacher's mood.

### 2.13 `packages/auth/`

**Contents:** `session.ts` (the session refresher used by both `proxy.ts` files), `credentials.ts`, `claims.ts` (reads the token and assurance level), `cookies.ts`, `operator.ts` (parses the allowlist; malformed means empty), `service.ts` (sign-up/in/out with enumeration resistance).

**Analogy:** the security desk's procedures, shared by both buildings.

### 2.14 `packages/env/`

**Contents:** `schema.ts`. Validates every environment variable at boot: key prefixes, model id format, "this key requires that key". Production refuses to start without required secrets; development boots without them. Error messages never echo the offending value.

**Analogy:** the pre-flight checklist. A missing item grounds the plane before it leaves the gate, not over the ocean.

### 2.15 `packages/observability/`

**Contents:** `logger.ts` (one JSON line per event; redacts by key name so a field named like a credential or like something a learner said never reaches a log), `pseudonym.ts` (HMAC of the user id), `telemetry.ts` (OpenTelemetry setup, off when unconfigured), `langsmith.ts`.

**Analogy:** the flight recorder, with a censor built in.

### 2.16 `packages/ui/`

**Contents:** `theme.css` (the learner's warm palette in dark and light, as role-named tokens), `theme-ops.css` (the operator's blue values under the same names), `styles.ts` (the class strings every page composes), `theme-toggle.tsx`, `theme-script.tsx` (restores the theme before first paint), `rich-text.tsx` and `markdown/parse.ts` (a small safe Markdown subset rendered to React, never to HTML strings), `pending-button.tsx`, `wordmark.tsx`.

**Purpose:** one visual language, two palettes. No component knows which product it is in. Tests hold the two palettes level and the ops override complete.

**Analogy:** the paint chart and the furniture catalogue both buildings order from. Same chairs, different upholstery.

### 2.17 `packages/corpus/`

**Contents:** `content/<type>/*.md` (hand-authored knowledge documents by content type) and `dataset/*.md` (the two scenario source documents). No code.

**Analogy:** the library's actual books.

### 2.18 `packages/security-tests/`

**Contents:** `src/roots.ts` (the one file that knows where each layer lives) and four test files: `ai-boundaries` (the four architecture rules), `deployables` (who may hold which secret and dependency), `migration-policy` (RLS on every user table, no `SECURITY DEFINER`, pgvector and pg_cron declared), `secret-exposure` (no server-only import in a client component, no `process.env` outside the named readers).

**Analogy:** the building inspector who walks every floor before each opening and shuts the building if a fire door is propped open.

### 2.19 `packages/test-support/`, `packages/config/`

Fakes and presets. A fake Supabase client, a fake tool-calling model that scripts tool calls, MSW handlers, jsdom setup; and the shared `tsconfig`, ESLint and Vitest project builders every package extends.

**Analogy:** the props department and the style guide.

### 2.20 `docker/`, `deploy/`, `.github/`

Covered in document 5. Briefly: two Dockerfiles (one shared by both Next apps), two shell scripts for the coding worker's git checkout, four Cloud Run manifests as `envsubst` templates, and three workflows.

---

## 3. Naming conventions you will see

| Pattern | Meaning |
| --- | --- |
| `@dp/<name>` | A workspace package. `dp` is Deutsch Partner. |
| `@/lib/...` | An app-internal alias to that app's `lib/`. Never crosses app boundaries. |
| `*-repository.ts` | The only code that touches a table. |
| `actions.ts` | Server Actions for the route folder they sit in. |
| `route.ts` | An HTTP route handler. |
| `(group)/` | A Next.js route group: shared layout, not in the URL. |
| `[param]/` | A dynamic URL segment. |
| `loading.tsx` | The skeleton shown while a dynamic route loads. |
| `tests/unit`, `tests/db`, `tests/e2e` | Vitest on node/jsdom, Vitest on PGlite, Playwright. |
| `YYYYMMDDHHMMSS_name.sql` | A migration. Timestamp order is apply order. |
| `snake_case` in SQL, `camelCase` in TypeScript | `rows.ts` and each repository translate at the boundary. |
| `ops_*` database functions | Operator-only, revoked from `authenticated`, filtered on a learner id. |
| `event.name` in logs (`worker.job_done`, `ops.access_denied`) | An event name, never a sentence. `audit: true` marks a security audit event. |
