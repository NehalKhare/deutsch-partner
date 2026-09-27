# @dp/learner

The learner product: a Next.js 16 app where a learner talks to the German tutor,
works through the curriculum, drills with the Trainer and reviews what is due.
It is one of three deployables; the operator app and the worker live beside it
in `apps/ops` and `apps/worker`, and it imports neither.

This app holds a model key. Every model call still goes through the gateway in
`packages/gateway` — nothing here opens its own connection to a provider.

It is also the one deployable that takes payments. Plans, prices and orders
follow `.claude/docs/billing-and-plans-spec.md`; everything that talks to
Stripe lives in `packages/billing`, and nothing here imports the Stripe SDK.

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
| `app/(app)/` | The signed-in pages: `chat`, `curriculum`, `trainer`, `scenarios`, `review`, `dashboard`, `settings`, and `billing` — Plan & billing, the order page (`billing/checkout`), the trial (`billing/trial`) and the return from Stripe (`billing/success`) |
| `app/pricing/`, `app/legal/terms/` | The public pricing page, and the terms an order is placed under — a stub until the consumer-law pages are written (spec S11) |
| `app/auth/`, `app/onboarding/` | Sign-in, sign-up, and the onboarding form. A `next` destination — the plan picked on the pricing page — is carried through both, and only ever as a same-site path |
| `app/api/` | Route handlers: `chat`, `trainer` (and its `feedback`), `scenarios`, `transcribe`, `speak`, `billing/webhook` (Stripe's events; no session, the signature is its authentication), `health` |
| `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`, `app/llms.txt/`, `app/opengraph-image.tsx`, `app/icon.tsx` | What a crawler, a phone or a chat preview asks for. The policy behind them is in `lib/seo/`; see [search and answer engines](../../docs/seo-and-geo.md) |
| `lib/` | Server logic by feature — `trainer`, `retrieval`, `scenarios`, `curriculum`, `dashboard`, `settings`, `billing` (the plan per request, offers, orders, refusals) and the rest — plus `env` and `supabase`. `lib/api/quota.ts` holds the plans' daily quotas. `lib/seo/` is the site identity, the crawl policy, the head metadata, the structured data and `llms.txt`; `lib/landing/` the landing page's rooms, questions and timeline, which the SEO layer reads |
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
| `SEO_INDEXING` | `true` only on production. Anything else serves a robots.txt that disallows everything and marks every page noindex |
| `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | Optional search-console ownership tokens, printed into the page head |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional; server only. Payments: `sk_`/`rk_` and `whsec_`, each requiring the other. Unset, payments are off: the order and trial pages say so and offer no button, and the webhook answers 503 so Stripe keeps its events. Never the ops app's, never the worker's |
| `STRIPE_AUTOMATIC_TAX` | `true` once Stripe Tax is registered. Not a secret |
| `DEV_SEED_EMAIL`, `DEV_SEED_PASSWORD` | Read only by `dummy:user` and the fixture sign-in E2E spec |

This app never holds the operator allowlist or a repository token; a CI test
checks that `.env.example` declares only what this deployable may hold. There
is no publishable Stripe key: hosted Checkout needs none. Setting up a
test-mode Stripe account — the catalogue, the price mirror, the webhook
endpoint, `stripe listen` — is in
[operations](../../docs/operations.md#payments-with-stripe).

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
