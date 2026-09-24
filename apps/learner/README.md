# @dp/learner

The learner product: a Next.js 16 app where a learner talks to the German tutor,
works through the curriculum, drills with the Trainer and reviews what is due.
It is one of three deployables; the operator app and the worker live beside it
in `apps/ops` and `apps/worker`, and it imports neither.

This app holds a model key. Every model call still goes through the gateway in
`packages/gateway` — nothing here opens its own connection to a provider.

## What it is built with, and why

It is a website built with Next.js, a React framework. We chose it because one
project can hold both the pages and the server code that talks to the AI, and
the tutor's replies can stream in word by word. It is written in TypeScript,
which catches mistakes before the code runs, and styled with Tailwind, a quick
way to keep the look consistent. Accounts and learning progress live in
Supabase, a hosted Postgres database with sign-in built in. Its row-level rules
mean a learner can only ever read their own data, even if the app has a bug.
The AI models are reached through OpenRouter, a single service that offers many
models. That lets us use a cheap model for small jobs and a stronger one for
conversation, and switch between them without changing code. LangChain runs
the Trainer's step-by-step tool use. Zod checks everything that comes in from
outside, including what the AI sends back, so bad data is caught at the door.

## Running it

```bash
cp .env.example .env.local        # from this directory, then fill it in
pnpm dev                          # from the root: all three deployables
pnpm dev:learner                  # from the root: this app alone, on :3000
```

You need a linked Supabase project with the migrations and seeds applied
(`pnpm db:push`, `pnpm db:seed` from the root). `pnpm dummy:user` creates a
confirmed fixture learner and prints its credentials. See
[operations](../../docs/operations.md#getting-a-project-running) for the full
first run.

## What is where

| Path | What it holds |
| --- | --- |
| `app/(app)/` | The signed-in pages: `chat`, `curriculum`, `trainer`, `scenarios`, `review`, `dashboard`, `settings` |
| `app/auth/`, `app/onboarding/` | Sign-in, sign-up, and the onboarding form |
| `app/api/` | Route handlers: `chat`, `trainer` (and its `feedback`), `scenarios`, `transcribe`, `speak`, `health` |
| `lib/` | Server logic by feature — `trainer`, `retrieval`, `scenarios`, `curriculum`, `dashboard`, `settings` and the rest — plus `env` and `supabase` |
| `components/` | The app's React components, composed from the class strings in `@dp/ui/styles` |
| `proxy.ts` | Refreshes the Supabase session and redirects signed-out visitors. A convenience, not a security boundary: RLS decides what a learner can read |
| `scripts/` | `create-dummy-user.ts`, and the Python scenario pipeline in `scripts/scenarios` (see its own README) |

## Environment

`.env.example` lists every variable with a comment on each. The ones that
matter first:

| Variable | Why |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Inlined into the browser bundle. The key starts `sb_publishable_`; legacy `eyJ…` keys are rejected |
| `SUPABASE_SECRET_KEY` | Server only. Starts `sb_secret_` |
| `OPENROUTER_API_KEY` | Server only. Chat, completion and embeddings |
| `OPENROUTER_MODEL_*`, `EMBEDDING_MODEL` | Optional per-tier overrides. Empty means the registry defaults |
| `LOG_PSEUDONYM_SALT` | Must match the other two deployables, or ledger rows stop joining |
| `MCP_SERVER_URL` | Optional. A remote MCP server the Trainer may use; empty means local tools only |
| `DEV_SEED_EMAIL`, `DEV_SEED_PASSWORD` | Read only by `dummy:user` and the fixture sign-in E2E spec |

This app never holds the operator allowlist or a repository token; a CI test
checks that `.env.example` declares only what this deployable may hold.

## Commands

Run from this directory, or from the root with `pnpm --filter @dp/learner <script>`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | `next dev` on :3000 |
| `pnpm verify` | Typecheck, lint, test and build this app |
| `pnpm test:unit` | Component and unit tests (jsdom) |
| `pnpm test:db` | Tests against real Postgres via PGlite |
| `pnpm test:e2e` | Playwright against a production build on :3100, never the dev server |
| `pnpm dummy:user` | Creates a fixture learner on the project `.env.local` points at |
| `pnpm scenarios:ingest` | Embeds the scenario corpus (Python, via uv). `--dry-run` needs no key |
| `pnpm scenarios:eval` | Scenario retrieval evaluation: hit@5, then ragas metrics |
| `pnpm scenarios:test` | The Python parser and ingestion-plan tests |

## Further reading

- [Product flow](../../docs/product-flow.md) — what a learner does, and what happens when they do it
- [Architecture](../../docs/architecture.md) — the gateway, data access, and the rules CI enforces
- [Operations](../../docs/operations.md) — cost, the Trainer's request duration, and what to check when something breaks
