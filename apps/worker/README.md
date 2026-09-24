# @dp/worker

The long-running Node process that drains the `ops_jobs` queue. No Next.js and
no browser: it claims jobs, runs them, reports how they ended, and answers
health checks. The operator app and the database enqueue; this process only
drains.

## What it is built with, and why

It is a plain Node.js program written in TypeScript, with no web framework,
because it serves no pages. It picks up slow or scheduled work and does it in
the background, so no one waits on a web page for it to finish. The job list
is a table in the same Supabase Postgres database the apps use, and Postgres's
built-in scheduler, pg_cron, adds the recurring jobs. That avoids running a
separate queue service, and many copies of the worker can share the table
without doing the same job twice. AI calls go through OpenRouter via the shared
gateway, so every call is priced and capped the same way as in the learner app.
OpenTelemetry sends timings and errors to a monitoring service when one is
configured. Zod checks every job before it runs, so a malformed job is refused
instead of half done.

## What it runs

| Job kind | What it does |
| --- | --- |
| `productops.drive` | Advances a Product Ops run through its stages |
| `productops.implement` | The coding stage: plans and builds in a worktree, opens a PR. `coder` queue only |
| `productops.reconcile` | Finds runs that have gone quiet for three minutes and enqueues them to be driven again |
| `fx.refresh` | Fetches the euro rate the ledger prices in |
| `pricing.snapshot` | Snapshots model prices, stamped with when they were fetched |
| `cost.rollup` | Rebuilds the spend rollup the dashboard reads |
| `ingest.knowledge` | Embeds the knowledge corpus |
| `checkpoints.prune`, `ratelimit.purge` | Housekeeping |

The recurring jobs are scheduled by `pg_cron` in the database, not by this
process, so any number of replicas can run without scheduling anything twice.

## How it runs

`src/main.ts` validates the environment, wires the dependencies
(`src/composition.ts`), starts the health server and hands over to the poll
loop in `src/loop.ts`.

- **At least once.** A job holds a lock that a heartbeat keeps alive. If the
  worker dies, the lock expires and the job comes back, so every handler is
  written to be safe to run twice.
- **Two concurrency budgets.** `WORKER_CONCURRENCY` bounds everything;
  `WORKER_SLOW_CONCURRENCY` bounds the slow kinds (driving a run, building in a
  worktree, ingesting). When the slow slots are full, fast jobs keep flowing
  past them.
- **Graceful stop.** On `SIGTERM` or `SIGINT` it stops claiming, lets the jobs
  in flight finish, then exits.
- **Health on `PORT`.** `/healthz` is 200 while the loop has polled in the last
  minute. `/readyz` also needs the last poll to have succeeded, so a database
  blip makes it unready without getting it restarted.

One image serves two roles. With `WORKER_QUEUES=jobs` it runs everything but
the coding stage. With `WORKER_QUEUES=coder`, a checkout and a GitHub token, it
runs `productops.implement`. Only that instance holds the token.

## Running it

```bash
cp .env.example .env.local        # from this directory, then fill it in
pnpm dev                          # from the root: all three deployables
pnpm dev:worker                   # from the root: this process alone, restarting on change
```

The command-line jobs below run one job in this process, with the same handler
and wiring the queue uses, and exit non-zero on anything but `done`.

## Environment

| Variable | Why |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | The same project as the apps. No publishable key: it serves no browser |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_*`, `EMBEDDING_MODEL` | The Product Ops agents and the embeddings, through `packages/gateway` |
| `LOG_PSEUDONYM_SALT` | Must match the other two deployables |
| `FX_EUR_PER_USD_BOOTSTRAP` | Optional. Prices calls made before the first `fx:refresh` lands a rate |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | OpenTelemetry. Off when the endpoint is unset |
| `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `REPO_CHECKOUT_PATH` | The `coder` instance only |
| `WORKER_QUEUES` | `jobs`, `coder`, or both |
| `WORKER_CONCURRENCY`, `WORKER_SLOW_CONCURRENCY`, `WORKER_POLL_MS`, `WORKER_LOCK_SECONDS`, `PORT` | Loop tuning and the health port |

Every value is read once at boot and validated (`src/env.ts`); production
refuses to start without the required ones.

## Commands

Run from this directory, or from the root with `pnpm --filter @dp/worker <script>`.
`ingest`, `fx:refresh` and `product:implement` also have root shortcuts.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the worker and restarts it on change |
| `pnpm start` | Runs the worker |
| `pnpm ingest [--dry-run] [--only=files\|derived] [--force]` | Embeds the knowledge corpus. Idempotent; `--dry-run` needs no key and writes nothing |
| `pnpm fx:refresh [--force]` | Fetches the euro rate now. Until it has run once, spend is recorded unpriced |
| `pnpm cost:rollup [--since <days>]` | Rebuilds the spend rollup, or backfills it from the whole ledger if it is empty |
| `pnpm product:implement <proposal-id>` | Runs the coding job here. Needs a checkout and a token |
| `pnpm test` | Unit tests, then the `worker:db` project on PGlite |
| `pnpm test:db` | The PGlite tests alone |

## Further reading

- [Deployment](../../docs/deployment.md) — the image, the `coder` checkout, and the runbooks
- [Product ops agents](../../docs/product-ops-agents.md) — what `productops.drive` actually drives
- [Operations](../../docs/operations.md#when-something-breaks) — what to check when a job fails
