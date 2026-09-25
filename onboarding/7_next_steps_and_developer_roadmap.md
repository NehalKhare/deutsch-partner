# 6. Next Steps and Developer Roadmap

Your first day, your first tasks, the rules you must not break, and where the architecture is heading. Everything here was verified against the repository's own scripts and documents; where a command has a prerequisite, it is stated.

---

## 1. Day 1: first-run protocol

### 1.1 Prerequisites

| Tool | Version | How to check |
| --- | --- | --- |
| Node.js | 22 (pinned in `.nvmrc`) | `node -v` → `v22.x`. Use `nvm use` in the repo root. |
| pnpm | 10.31 or newer (pinned in `package.json` → `packageManager`) | `pnpm -v`. Install with `corepack enable` or `npm i -g pnpm@10`. |
| Docker Desktop | Any current | Needed by the Supabase CLI's local stack. |
| Supabase CLI | 2.115 or newer | `supabase --version`. Installed as a dev dependency of `@dp/db`, so `pnpm --filter @dp/db exec supabase` also works. |
| uv (Python) | Any current | Only for `pnpm scenarios:*`. Optional on day 1. |
| An OpenRouter account and key | | Optional on day 1. Without it, chat and the Trainer say the tutor is unavailable, but every page renders and the whole test suite runs. |

### 1.2 Steps

```bash
# 1. Clone and install
git clone <repository-url> deutsch-partner
cd deutsch-partner
nvm use                        # picks Node 22 from .nvmrc
pnpm install --frozen-lockfile # installs every workspace package; ~1-2 minutes

# 2. Prove the toolchain before touching a database. No secrets needed.
pnpm verify                    # typecheck, lint, every test, every build, through turbo
                               # Expect several minutes on first run; turbo caches afterwards.

# 3. Choose a database. Pick ONE of the two options below.
```

**Option A: fully local Supabase (recommended for day 1).**

```bash
pnpm db:start                  # supabase start: Postgres 17 + Auth + PostgREST in Docker, ~1 minute first time
pnpm db:reset                  # applies all 52 migrations (the curriculum seeds are migrations too) to the local stack
cd packages/db && supabase status -o env && cd ../..
                               # prints the local URL (http://127.0.0.1:54321) and keys. Copy them for step 4.
```

**Option B: a hosted Supabase project (what the team's staging uses).**

```bash
supabase login                 # once per machine
cd packages/db && supabase link --project-ref <ref> && cd ../..   # once per checkout; prompts for the DB password
pnpm db:push                   # applies pending migrations
pnpm db:seed                   # curriculum, vocabulary, grammar seeds (idempotent)
```

The project ref is the subdomain of the project URL; `supabase projects list` prints it.

```bash
# 4. Environment files: one per deployable. Never commit the copies.
cp apps/learner/.env.example apps/learner/.env.local
cp apps/ops/.env.example     apps/ops/.env.local
cp apps/worker/.env.example  apps/worker/.env.local
```

Fill in each `.env.local`. The minimum for a local run:

| Variable | learner | ops | worker | Value |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | yes | yes | yes | `development` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes | yes | From step 3 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | yes | no | Starts `sb_publishable_` |
| `SUPABASE_SECRET_KEY` | yes | yes | yes | Starts `sb_secret_`. **Never in a `NEXT_PUBLIC_` variable.** |
| `LOG_PSEUDONYM_SALT` | yes | yes | yes | Any 10+ character string, **the same in all three files** |
| `OPENROUTER_API_KEY` | optional | **never** | optional | Your key, when you have one |
| `OPERATOR_USER_IDS` | **never** | later | no | Your account id, once you have signed up (step 6) |
| `DEV_SEED_EMAIL` | yes | | | e.g. `learner@example.com` (must be a reserved domain) |

Blank lines like `MCP_SERVER_API_KEY=` are treated as unset. Legacy JWT-format keys (starting `eyJ`) are rejected at boot; use the current key format.

```bash
# 5. A fixture learner, so you can sign in without email confirmation
pnpm dummy:user                # creates a confirmed account from DEV_SEED_EMAIL; prints the password

# 6. Optional, costs about $0.001 each with a model key:
pnpm fx:refresh                # the euro rate; until it runs, spend is recorded unpriced
pnpm ingest --dry-run          # no key needed: reports 234 documents, 599 chunks
pnpm ingest                    # embeds the corpus through the gateway
pnpm scenarios:ingest          # the 50-scenario corpus (Python via uv)

# 7. Run everything
pnpm dev                       # learner on :3000, ops on :3001, worker polling on :8080
# or one at a time:
pnpm dev:learner
pnpm dev:ops
pnpm dev:worker
```

Open http://localhost:3000, sign in with the fixture account, complete onboarding, open `/chat`. Without a model key you will see "Your tutor is unavailable right now", which is the correct fail-closed behaviour. With one, Jonas replies.

### 1.3 Becoming an operator (day 2)

1. Sign in on the learner app once so your account exists. Find its id in Supabase Studio (Authentication → Users) or by `select id, email from auth.users`.
2. Put the id in `apps/ops/.env.local` as `OPERATOR_USER_IDS=<uuid>`. Restart the ops app.
3. Open http://localhost:3001, sign in, and you will be sent to `/mfa/enrol`. Scan the QR code with an authenticator app. From then on, sign-in asks for the six-digit code.

### 1.4 Production images locally (optional)

```bash
echo "127.0.0.1 host.docker.internal" | sudo tee -a /etc/hosts
cp apps/learner/.env.local apps/learner/.env.docker   # and ops, worker; edit the Supabase URL to http://host.docker.internal:54321
export SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
pnpm docker:build && pnpm docker:up
```

Document 5 explains what this does and why the file looks the way it does.

---

## 2. First good starter tasks

Each task names the files to read first and the tests that already exist as a model.

### 2.1 Add a shared UI class string or component

**Where:** `packages/ui/src/styles.ts` for a class string; a new `packages/ui/src/<name>.tsx` for a component, plus an entry in `packages/ui/package.json` → `exports`.

**Rules:** use only role-named tokens (`bg-ground`, `text-copy`, `bg-brand`, `border-edge`). Never a raw colour. A test in `packages/ui/tests/theme-palette.test.ts` holds the two palettes level; if you add a token, add it to both `theme.css` palettes and to `theme-ops.css`, or the build fails.

**Model to copy:** `pending-button.tsx` and its test `theme-toggle.test.tsx` for the jsdom pattern.

### 2.2 Add a learner-facing API route

**Where:** `apps/learner/app/api/<name>/route.ts` (thin: authenticate, rate limit, parse, delegate) and `apps/learner/lib/api/<name>.ts` (the logic, pure, tested without a server).

**Follow the order every endpoint follows:** authenticate from the session; pseudonymise; rate limit through `limiterFor(...)` (add a scope in `lib/api/rate-limit.ts`); parse the body with a strict Zod schema; do the work through dependencies from `lib/api/composition.ts`; return a closed set of safe error messages.

**Model to copy:** `app/api/scenarios/search/route.ts` and `lib/api/scenarios.ts`, with `tests/unit/api/scenarios.test.ts`.

### 2.3 Add a Server Action to the ops app

**Where:** the `actions.ts` beside the page. First line of every action: `const operator = await operatorForAction("/route/name"); if (!operator) return;`. Then rate limit, then a strict Zod parse of the `FormData`, then the work, then an audit log line with `audit: true` and the operator's `hash`, never their id.

**Model to copy:** `apps/ops/app/(ops)/costs/budgets/actions.ts` and `tests/unit/costs/cost-admin-actions.test.ts`.

### 2.4 Modify an AI prompt

**Where:** `packages/prompts/src/catalogue.ts` (entries) and `sections.ts` (block renderers). The Trainer's prompt is `trainer.ts`; the product-ops agents' are `product-ops-agents.ts`.

**What will happen:** `tests/prompt-versioning.test.ts` fails with a message telling you the fingerprint changed. If the change is cosmetic, update the hash. If it changes behaviour, bump the entry's version. Then check the block still fits its cap (`blocks.ts`) and the task's input ceiling; the builder's tests assert budgets against a dry run.

**Never** write prompt text anywhere else. The security test `ai-boundaries.test.ts` scans for prompt-shaped strings outside this package.

### 2.5 Add a new AI task

1. Add the task id to `TASK_IDS` and a route (tier, both ceilings) to `ROUTES` in `packages/domain/src/tasks.ts`. A task not in the table cannot call a model.
2. Add a catalogue entry in `packages/prompts` with an output schema.
3. Call it through the gateway: `callSpecFor(task, ...)` then `gateway.complete(...)` or `.stream(...)`. Never import a transport.
4. Confirm a ledger row is written (the gateway does this; your test should assert the fake ledger saw one row).

### 2.6 Add a background job

1. Add the kind to `JOB_KINDS`, its payload to `jobPayloadSchema`, its dedupe key and queue in `packages/domain/src/jobs.ts`.
2. Add the kind to the `CHECK` constraint on `ops_jobs.kind` in a **new** migration.
3. Write `apps/worker/src/handlers/<kind>.ts` returning a `HandlerOutcome`; make it idempotent (check for your own output first). Add the case to `handlers/index.ts`; the switch is exhaustive so TypeScript will insist.
4. If it recurs, add a `cron.schedule` line to a new migration calling `enqueue_scheduled_job('<kind>')`. Never a `setInterval` in the worker.

**Model to copy:** `handlers/cost-rollup.ts` and `tests/unit/handlers/cost-rollup.test.ts`.

### 2.7 Add a database table or column

1. Load the `supabase-postgres-best-practices` skill if you are using an AI assistant; otherwise read `packages/db/supabase/migrations/20260821120700_rls_policies.sql` first.
2. New file `packages/db/supabase/migrations/<timestamp>_<name>.sql`. Forward-only. Never edit a shipped migration.
3. If learner-owned: enable RLS, four policies with `TO authenticated`, `UPDATE` with both `USING` and `WITH CHECK`, `auth.uid()` wrapped in `(select ...)`. If operator-scope: enable RLS, **no policy**, `revoke all from anon, authenticated`.
4. Functions: `security invoker`, `set search_path = ''`, revoked from `public, anon, authenticated` unless learners need them. Never `security definer`.
5. Use `extensions.vector(1536)` and `operator(extensions.<=>)` for vector columns; local and hosted schemas differ and this spelling works on both.
6. Add a repository method with a Zod row schema. Add a test in `tests/db/` that applies the migration on PGlite and tries to read another learner's row.

### 2.8 Add a learner setting

Follow the chain: `packages/domain/src/learner.ts` (schema) → a migration adding the column → `packages/db/src/learner-repository.ts` → `apps/learner/app/(app)/settings/actions.ts` → `components/settings/settings-form.tsx`. `tests/unit/settings/settings-action.test.ts` shows the shape.

---

## 3. Core engineering rules and the "do not break" checklist

Document 7 is the hands-on companion to this section: how each gate is built and how to write the test that proves your change.

### 3.1 The four CI-enforced architecture rules

1. **Only `packages/gateway/src` may reach a model.** No `openai`, `@ai-sdk/*`, `@anthropic-ai/*`, `@langchain/openai` import elsewhere. No `fetch` to a provider URL elsewhere.
2. **No model id outside `packages/gateway/src/registry.ts`.** Name a tier.
3. **No hardcoded price literal anywhere.** No constant named `pricePer*`, no `rate = 0.92`.
4. **No prompt text outside `packages/prompts/src`.**

### 3.2 Boundaries that are tested

- Apps never import each other. `apps/ops` never depends on `@dp/gateway`, `@dp/prompts` or LangChain. `apps/learner` never depends on `@dp/product-ops`.
- Only the files named in `packages/security-tests/src/roots.ts` → `repositories` may touch the database.
- Only the files named under `processEnvReaders` may read `process.env`. Everywhere else, import from the app's `lib/env/server.ts` or `client.ts`.
- A Client Component (`"use client"`) never imports `@/lib/env/server`, `@/lib/supabase/server-client`, `server-only` or `next/headers`.
- Each app has `proxy.ts` and no `middleware.ts`.
- Each `.env.example` declares only what that deployable may hold. Ops never a model key or GitHub token; learner never the allowlist or GitHub token; worker never the publishable key.
- Every user-owned table has RLS. No function is `SECURITY DEFINER`. Migrations declare pgvector and pg_cron.

### 3.3 Monorepo hygiene

- **Import shared code by package name:** `import { x } from "@dp/domain/tasks"`, never a relative path across packages (`../../packages/domain/...`).
- **Add dependencies to the package that uses them**, with `catalog:` for anything in the catalog. New shared dependency? Add it to the catalog in `pnpm-workspace.yaml` first.
- **Run typecheck across the workspace**, not one package: `pnpm typecheck` at the root. A type change in `domain` breaks call sites in three apps.
- **`pnpm verify` before every commit.** It is the definition of done. Use `pnpm turbo run test --filter=@dp/<pkg>` while iterating, but verify the whole tree before you push.
- **Import test globals from `vitest`.** `globals` is off.
- **Use the shared vitest presets** (`nodeProject`, `jsdomProject`, `dbProject` from `@dp/config/vitest/base`).
- **Never commit `.env.local`, `.env.docker` or `.tsbuildinfo`.** The `.gitignore` covers them; check `git status` anyway.
- **Do not hand-edit the `AGENTS.md` block that `next dev` regenerates** in the two apps; commit it as generated.

### 3.4 Security habits

- Derive identity from the session. Never trust a user id, learner level or thread id from the body.
- Every Server Action re-checks authorization itself. It inherits nothing from the page.
- Return a closed set of safe error messages. Never a stack trace, never a provider message.
- Log event names and identifiers (`requestId`, `userIdHash`, `threadId`). Never a learner's words, never a secret. The logger redacts by key name, but do not rely on it.
- 404, not 403, for operator surfaces.
- Validate model output with Zod. Retry once with a repair. Never execute it.
- Fail closed: no session → deny; no pseudonym salt → deny; budget exhausted → no call.

### 3.5 Pull request guidelines

- Branch from `main`. One concern per PR.
- Follow the build spec's response format in the description: the goal, the tests added (RED), the implementation (GREEN), what was refactored, and the security assumptions.
- Every new model call declares a task, a tier and both ceilings, and writes a ledger row. Say so in the PR.
- If you added a migration, say whether it is compatible with the currently running app version (it must be: migrations deploy first).
- CI must be green: verify, the security and database gates, e2e, and all three image builds.
- Prompt edits: name the version bumped or state that the change was cosmetic.

### 3.6 Reading order for the specs when a task touches them

| If your task touches... | Read first |
| --- | --- |
| Anything that calls a model | `.claude/docs/model-routing-and-cost-control.md` §4, §6, §9 |
| A prompt | `.claude/docs/system-prompt-catalogue.md` |
| Auth, RLS, logging, an API route | `.claude/docs/security-observability-guardrails.md` §2–§7, §17–§19, §25–§26 |
| The cost dashboard | `.claude/docs/cost-dashboard-spec.md` |
| Product ops | `.claude/docs/product-ops-spec.md` |
| The curriculum or learner state | `.claude/docs/business-objective.md` §3–§9, §24 |

Precedence when they disagree: guardrails > model-routing > (prompt-catalogue = cost-dashboard = product-ops) > build-spec > business-objective.

---

## 4. Architecture roadmap and known trade-offs

Everything below comes from `docs/architecture.md` → "What is not built" and the "Deliberately not built" notes in the code. It is honest on purpose: a document that describes an intention as an achievement is worse than no document.

### 4.1 What is deliberately unfinished, and why

| Gap | Why it exists | What closing it looks like |
| --- | --- | --- |
| **Product ops ends at the plan.** Implementation, verification and pull-request stages exist and are tested, but no review leads into them. | A 2026-09-10 decision: the plan is the deliverable. Autonomous repository modification is the dangerous part and the team chose to stop before it until the guardrails were proven in production. | Reopen with the guardrails document in hand. The graph's `plan_review` gate node is where the transition would be re-enabled. |
| **No chat model has been called in tests.** | Every test drives a fake transport; a real call costs money and is non-deterministic. | The golden eval sets below. |
| **No golden eval sets.** Every prompt entry declares one; none is written. Tier assignments are the routing document's judgement, unmeasured. | Build order: the gateway and ceilings came first so accounting could never be retrofitted. Evaluation was next and has not landed. | A fixture set per task, a rubric, recorded cost and latency per tier. Then promote tasks to cheaper tiers with evidence. This is the highest-value piece of work available. |
| **Voice is not budgeted or ledgered.** | Billed per minute and per character; the token-shaped rate table cannot express it. Rate limits (10 transcriptions, 20 readings a minute) and audio bounds are the only ceiling. | A per-unit pricing shape in `pricing.ts` and a ledger row per voice call. |
| **Offline scenario ingestion bypasses the gateway.** Python, direct to the provider, not ledgered. | The parser and ragas evaluation were faster to write in Python. | Port ingestion to the worker as an `ingest.scenarios` job, or accept the gap and document it (as is done). |
| **Learners cannot export or delete their own data.** Both exist only as operator actions. | Guardrails §16 asks for both; the operator page shipped first. | Two Server Actions on `/settings` calling the same `ops_*`-style functions filtered on `auth.uid()`. |
| **Operator changes are audited in logs, not a table.** | Log retention is the only thing keeping them. | An `ops_audit_log` table, append-only by trigger, written by the same code paths. |
| **Finding a learner is a scan.** Pseudonyms cannot be reversed, so lookup hashes profile ids until one matches, stopping at 50,000. | Privacy by design: the ledger must never have held an id. | A stored lookup index (pseudonym → id) in an operator-scope table, written when a profile is created. |
| **The runs page polls; nothing is pushed.** | Few operators; polling stops on its own when a run stalls. A deliberate trade at this size. | Supabase Realtime or `LISTEN/NOTIFY` on `ai_run_events`. Wrong to do before it is needed. |
| **The CPO's `search_internal_docs` answers "unavailable".** | The retriever wants a learner-shaped context the CPO does not have. | Adapt the retriever to an operator context. The obvious next product-ops task. |
| **A plan is approved whole or rejected whole.** | The gate does not let an operator drop files before approving. | Apply the edit in the graph's gate node. |
| **A feature needing a migration stops at the PRD.** | The deny-list refuses `supabase/migrations/**` whatever the plan says. | Per-run operator opt-in is the extension point. |
| **`extraction.errors` and `evaluation.learner_message` overlap.** | Both return errors against the same taxonomy. | Measure whether the separate pass earns its call. Needs the eval sets. |
| **Pricing snapshot has never run against the provider.** `model_pricing_snapshots` is empty until it does, so the budget gate's estimator has nothing to read. | Tested against a fake fetch only. | Run it. Watch the row shape. |
| **The two-factor flow has run only against a fake auth client.** | Nobody has enrolled a real authenticator against the linked project. | Enrol one. |
| **Rows written before the first FX rate keep `cost_eur = 0` forever.** | The ledger is append-only by trigger. The dashboard converts them at the newest rate for display and says so. | Nothing. This is correct behaviour; it is listed so nobody "fixes" it. |

### 4.2 How scale changes the architecture

| At this scale | What changes |
| --- | --- |
| **Hundreds of learners** | Nothing structural. Enable Supabase's connection pooler. Watch `model_invocations` p95 latency and the tier fallback rate on the cost dashboard. |
| **Thousands** | The rate-limit table's single-row upserts become the hottest writes. Add a Redis-backed implementation of the `RateLimiter` interface in `packages/db/src/rate-limit-repository.ts`, beside `createPostgresRateLimiter` and the in-memory `createMemoryRateLimiter` that shows the shape. Raise `WORKER_CONCURRENCY`. Partition `model_invocations` by month. |
| **Tens of thousands** | The strong-tier provider's rate limits are the wall. Widen the registry's fallback ladders and measure with the eval sets so a cheaper tier can take the conversation turn where quality allows. A read replica for the ops dashboards. Push, not poll, for run timelines. Consider a dedicated vector store only if the corpus grows by orders of magnitude, and only if you can keep filter-before-rank. |
| **Many operators** | SSE via Supabase Realtime. An `ops_audit_log` table. Real RBAC beyond the allowlist, but never as a column a learner's row could carry. |
| **A second product or team** | Kubernetes proper for sidecars and persistent worker disks; the images and health endpoints already fit. Split the worker image if the coder's 8 GiB starts dictating the queue worker's cost. |

### 4.3 Principles that should survive every change

1. **A tutor that costs more per learner than it earns is not a product.** Route by task, cap before sending, ledger every call.
2. **The model is not the curriculum.** Progression, mastery and scheduling stay pure functions.
3. **Model output is never trusted.** Validate, repair once, fall back.
4. **The LLM, the browser and the prompt are not security boundaries.** Authorization lives in application and database code.
5. **Postgres is the only durable state.** A second store needs a reason written into `docs/architecture.md`.
6. **Say what is not built.** Keep the "What is not built" section honest; that is what makes the rest of the documentation trustworthy.
