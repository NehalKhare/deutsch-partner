# Operations

## Environment

Three deployables, three environment files: `apps/learner/.env.example`,
`apps/ops/.env.example`, `apps/worker/.env.example`. Copy each to `.env.local`
beside it. Nothing in an example file is a real value, and none should ever be.

| Variable | learner | ops | worker | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes | yes | The project URL. Inlined into the two browser bundles |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | yes | — | Starts `sb_publishable_`. RLS applies |
| `SUPABASE_SECRET_KEY` | yes | yes | yes | Starts `sb_secret_`. Bypasses RLS. Never in the browser |
| `LOG_PSEUDONYM_SALT` | yes | yes | yes | **The same value everywhere.** Keys the pseudonymous id in the ledger and the audit trail |
| `OPENROUTER_API_KEY` | yes | **never** | yes | Every model call: chat, embeddings, speech, the product-ops agents. The ops app refuses to boot with one |
| `OPERATOR_USER_IDS` | **never** | yes | — | Comma-separated account ids. Unset means nobody. The learner app refuses to boot with one |
| `GITHUB_TOKEN`, `GITHUB_REPOSITORY` | **never** | **never** | coder only | Fine-grained, one repository, contents and pull-request write |
| `REPO_CHECKOUT_PATH` | — | — | coder | Where the entrypoint clones the repository |
| `WORKER_QUEUES`, `WORKER_CONCURRENCY`, `WORKER_SLOW_CONCURRENCY`, `WORKER_POLL_MS`, `WORKER_LOCK_SECONDS` | — | — | yes | `jobs`, `coder`, or both; how many jobs at once; how many of those may be slow kinds. Recurring jobs are pg_cron's, not the worker's |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | — | — | optional | Traces, metrics and logs over OTLP (Grafana Cloud). Unset means telemetry is off; the headers are a secret |
| `MCP_SERVER_URL`, `MCP_SERVER_API_KEY` | optional | — | — | The Trainer's remote tools |
| `FX_EUR_PER_USD_BOOTSTRAP` | optional | — | optional | Prices calls made before the first FX snapshot |
| `OPENROUTER_MODEL_*` | optional | — | optional | Per-tier model overrides. Empty uses the registry |
| `OPS_COOKIE_NAME` | — | optional | — | The operator session cookie's name, distinct from the learner's |
| `SEO_INDEXING` | yes, production only | — | — | `true` lets search and answer engines index the public pages. Unset or `false` — every other environment — serves a robots.txt that disallows everything. The ops app is never indexable and has no switch |
| `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | optional | — | — | Search-console ownership tokens, printed into the page head. Not secrets |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional | **never** | **never** | Payments. `sk_`/`rk_` (test or live) and `whsec_`; each requires the other. Unset is payments off. The ops app refuses to boot with either; the worker is not given them |
| `STRIPE_AUTOMATIC_TAX` | optional | — | — | `true` once Stripe Tax is registered: Checkout computes VAT. Not a secret |

The legacy Supabase JWT `anon` and `service_role` keys are **rejected at boot**.
They are retired at the end of 2026, and validating the prefix turns two
expensive mistakes — a secret key in a browser variable, a new project on a
dying key format — into a boot failure.

Production requires the Supabase values, the salt and (for the learner and the
worker) the model key. Development and test boot without them, so a contributor
can run the apps and the suite without provisioning anything.

Payments are not required anywhere: with no Stripe keys the learner app runs
with payments switched off. There is no publishable Stripe key — hosted
Checkout needs none.

## Getting a project running

```bash
pnpm install
supabase login                                  # once per machine
supabase link --project-ref <your-project-ref>  # once per checkout
pnpm db:push          # every migration: tables, RLS, functions, the job queue
pnpm db:seed          # curriculum, vocabulary and grammar seeds
pnpm dummy:user       # a confirmed fixture learner, credentials printed
pnpm fx:refresh       # the euro rate — until this runs, spend is recorded unpriced
pnpm ingest           # embeds the corpus — this one costs money (~$0.001)
pnpm scenarios:ingest # embeds the 50-scenario corpus — also costs money (~$0.001)
pnpm dev              # learner on :3000, ops on :3001, the worker polling
```

To switch payments on in a test-mode Stripe account, see
[payments with Stripe](#payments-with-stripe) below.

`supabase link` runs from `packages/db`, where `supabase/config.toml` lives;
the root `db:*` scripts change into it. See [deployment](deployment.md) for the
containers.

`pnpm scenarios:ingest` is Python (run through [uv](https://docs.astral.sh/uv/),
which provisions its own interpreter) and needs `OPENROUTER_API_KEY`. Like
`pnpm ingest` it is idempotent — unchanged items are skipped before any
provider call — and `--dry-run` reports the parse (15 dialogues, 35
comprehensions) with no key and no database. See `apps/learner/scripts/scenarios/README.md`.

`pnpm ingest --dry-run` reports what would be written — 234 documents, 599
chunks — without contacting a provider or needing a key. Useful for checking
chunking and metadata on a laptop with nothing configured.

`supabase link` is what `db:push`, `db:diff` and `db:seed` mean by "the linked
project". It writes `packages/db/supabase/.temp/project-ref`, which is gitignored, so it is
a per-checkout step rather than something a clone inherits — a fresh clone that
skips it gets `Cannot find project ref` from the first command that needs a
database. The project ref is the subdomain of `NEXT_PUBLIC_SUPABASE_URL`, and
`supabase projects list` prints it for every project the logged-in account can
see. Linking prompts once for the database password and stores it, which is why
the later commands do not ask again.

`db:seed` exists because a migration runs once. The seeds are declarative and
idempotent, so a fresh database gets them from `db:push` while one that already
applied an earlier version gets the update from `db:seed`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm verify` | Typecheck, lint, every test and every build, for every workspace, through Turborepo |
| `pnpm dev:learner`, `pnpm --filter @dp/ops dev`, `pnpm --filter @dp/worker dev` | One deployable at a time |
| `pnpm test:unit` | Unit and component tests |
| `pnpm test:db` | Migrations, constraints and RLS against real Postgres via PGlite |
| `pnpm test:e2e` | Playwright against a production build on port 3100 |
| `pnpm db:advisors` | Supabase's security and performance linters |
| `pnpm ingest` | The corpus pipeline. Safe to re-run; does nothing if nothing changed |
| `pnpm scenarios:ingest` | The scenario corpus pipeline (Python). Same idempotence contract |
| `pnpm scenarios:eval` | Retrieval evaluation: hit@5 plus ragas metrics. `--retrieval-only` skips the judge model |
| `pnpm scenarios:test` | The Python parser and plan tests |
| `pnpm curriculum:generate` | Rewrites the three generated seed migrations |
| `pnpm fx:refresh` | Runs the FX job in this process. The worker runs it hourly; `--force` asks the source anyway |
| `pnpm product:implement <proposal-id>` | Runs the coding job in this process, for a machine with a checkout and a token. The `coder` worker does the same in production |
| `pnpm docker:build`, `pnpm docker:up` | The three production images against a local Supabase |

## Cost

A typical learner turn triggers five model calls:

| Call | Tier | EUR |
| --- | --- | --- |
| `conversation.turn` (A1) | strong | 0.00454 |
| `evaluation.learner_message` | mid | 0.00085 |
| `extraction.errors` | cheap | 0.00055 |
| `classification.intent` | nano | 0.00004 |
| `retrieval.embedding` | embedding | negligible, and cached |
| **total** | | **≈ 0.0064** |

About **€0.64 per learner per 100 turns**. The conversation turn is 71% of it.

Two independent controls bound it. **Rate limiting** bounds how often — 20
messages a minute. **Euro budgets** bound how much, at four scopes, failing
closed at 100%. Both are required: one request with a large context can cost
more than a thousand small ones.

Evaluation is skipped entirely for trivial messages. *Danke*, *Ja*, an emoji —
none carries a level or grammar signal, and scoring them costs money and adds
noise to a learner's estimated level.

## When something breaks

**A learner gets "your tutor is unavailable".** The turn was refused before
generation. Look for `chat.turn_refused` in the logs — it carries the request
id and which node failed, and no content.

**Replies are short and generic.** Retrieval is probably degraded. `retrieve`
will be marked `degraded` in the `turn.completed` log line, and
`retrieval.arm_failed` will say which arm went quiet. A single failed arm halves
the quality rather than removing the answer, which is why this can go unnoticed.

**Scenario search says it is unavailable.** The search endpoint embeds the
query, and without an embedding key (`OPENROUTER_API_KEY`) it degrades rather
than failing the page — browsing and comprehension quizzes still work. Look for
`scenario_search.disabled` (no key) or `scenario_search.embedding_failed`
(provider or budget refusal) in the logs. An empty grid with search working
means the corpus was never ingested: run `pnpm scenarios:ingest`.

**Spend is climbing.** The cost dashboard breaks it down by task and by the
model actually routed to — which is not always the one asked for, since
OpenRouter may substitute. Alerts fire at 70%, 90% and 100% of the daily budget.
`budget_denied` rows are a security audit event as well as a cost one: a learner
who can trigger unbounded spend has found a financial denial of service.

**Something needed a person and nobody saw.** The bell in the operator app's
header is one inbox for every operator: a market scan parked on a decision, a
run that failed, a job that gave up (`worker.job_dead_lettered` in the logs),
a Stripe event that keeps failing, a cancellation or withdrawal notice, the
daily budget at 70, 90 or 100 percent. Reading one reads it for everyone and
records who, by pseudonym. It is `/notifications` in the ops app, polled
once a minute while a tab is open, and the rows are `ops_notifications`;
nothing is emailed or paged. Read rows are purged after ninety days and
unread ones after a year by the `dp_notifications_purge` schedule. The
learner's bell is the same component over `learner_notifications`, written
only through the secret key.

**Euro figures are zero.** The rate table is empty and nothing can be
converted. The worker snapshots the rate hourly — asking the source at most
once a day, guarded on when it was last *read* rather than which date it
answered with, because the reference rate for a day is published in the
afternoon. **Refresh rate** in the dashboard header enqueues a forced refresh;
`pnpm fx:refresh --force` runs one from a terminal. If the figure stays zero,
check that the worker is running (`/healthz`) before checking the source. If euro figures are
still zero after that, the source is unreachable: check for `fx.source_unavailable`
in the logs.

Two euro figures are on that page and they are not the same claim. Rows written
while a rate existed were converted at write time and their stored `cost_eur` is
final — never restated, whatever the rate does afterwards. Rows written before
any rate existed carry none, and the ledger is append-only, so they keep their
stored zero for good; the dashboard converts *those* rows at the newest rate for
display and states how much of the total that is. Nothing is written back.

The dashboard distinguishes two states that both set `fx_stale` on the ledger.
`fx_unpriced` fires only when rows carry no rate *and* none has been snapshotted
to convert them at — once there is a rate the caveat moves to the line under the
title, where a note about a figure belongs. `fx_pipeline` means the newest
snapshot is more than four days old: the source publishes on business days, so a
long weekend is fine and a week is a job that has stopped. Rows priced at a
carried-forward rate are counted, not alerted on — they are priced correctly, at
the last rate the source published.

**A run sits at "queued".** Nothing is claiming jobs. Check the worker's
`/readyz`, then `select status, count(*) from ops_jobs group by 1`; the dead
letters are `status = 'failed'` with a code in `last_error`. The nudge button
re-enqueues (deduplicated per run), and the reconciler re-enqueues any
server-owned run quiet for three minutes on its own.

**An operator cannot get past the second factor.** Remove their TOTP factor in
the Supabase dashboard (Authentication → Users) after confirming who is asking
out of band; the next sign-in enrols a new one.

**A learner cannot get past the second factor.** The same account record, the
same fix: confirm who is asking out of band, remove the factor named "Deutsch
Partner" under their user in the Supabase dashboard, and their next sign-in
enrols a new authenticator. There are no recovery codes yet, so this is the
only way back in, and it is an operator action — log it like any other
support action on a learner.

**A migration will not apply.** pgvector lives in the `extensions` schema on a
real Supabase project but is created in `public` locally, so new migrations must
write `extensions.vector(1536)` and `operator(extensions.<=>)`. This only
surfaces on push, because the migration role's search path is not the API
role's.

**The database tests pass and production does not.** PGlite has no pgvector, so
the harness substitutes the embedding column and drops the HNSW index. Anything
that depends on real vector behaviour is not covered there — a static test
asserts the migrations declare it, and that is all.

## Payments with Stripe

The contract is `.claude/docs/billing-and-plans-spec.md`; this is the runbook.
Everything below is test mode. Live mode has preconditions of its own, at the
end, and none of them is met yet.

### Keys

Only the learner app holds them (`apps/learner/.env.local` locally, Secret
Manager in a deployment — `deploy/cloudrun/README.md`). The ops app refuses to
boot with either, and the worker is not given them.

- `STRIPE_SECRET_KEY` — a test key, `sk_test_…`, or a restricted `rk_test_…`.
  The app creates customers, Checkout and Customer Portal sessions; reads
  subscriptions, Checkout Sessions, charges and prices; and updates a
  subscription in one way only, setting the trial to cancel at its end. A
  restricted key needs exactly those permissions. `stripe:bootstrap` also
  creates Products and Prices, so run it with a full `sk_test_` key.
- `STRIPE_WEBHOOK_SECRET` — `whsec_…`, the signing secret of the endpoint
  below (or of `stripe listen`, locally). Each key requires the other.
- `STRIPE_AUTOMATIC_TAX` — leave unset until Stripe Tax is registered.

### The catalogue and the price mirror

```bash
pnpm --filter @dp/billing stripe:bootstrap  # Products "Deutsch Partner Plus"/"Premium" and six Prices from catalogue.json; refuses a live key
pnpm --filter @dp/billing prices:sync       # mirrors Stripe's active Prices into billing_prices
```

Both read `apps/learner/.env.local`. `stripe:bootstrap` is idempotent: it finds
each Price by lookup key (`dp_plus_month`, `dp_plus_year`, `dp_premium_month`,
`dp_premium_year`, `dp_pass_plus`, `dp_pass_premium`), creates what is missing
with `plan_code` (and, for a pass, `pass_days`) metadata, VAT inclusive, and
never changes a Price that exists. The pricing page shows only what
`billing_prices` holds, so run `prices:sync` after the bootstrap and after
every price change; until it has run, every pricing card says prices are
being set up.

A price change is a new Price in the Dashboard that takes over the lookup key
("transfer lookup key"), then `prices:sync`. Existing subscribers stay on the
old Price, which Stripe now reports with no lookup key; the webhook still
places them through the mirror, which keeps the old Price as an inactive row.
Never delete `billing_prices` rows by hand for that reason.

### The webhook endpoint

Dashboard → Developers → Webhooks → add an endpoint at
`<APP_URL>/api/billing/webhook` (the learner app's own origin), with these
events and no others:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
invoice.paid
invoice.payment_failed
charge.refunded
```

Anything else that arrives is recorded and acknowledged. Copy the endpoint's
signing secret into `STRIPE_WEBHOOK_SECRET`. The route answers 503 while
payments are off, so Stripe keeps events until the keys are configured.

### Payment methods

Dashboard → Settings → Payments → Payment methods. The code passes no
`payment_method_types`: whatever is switched on here is what Checkout offers,
filtered by Stripe to each learner's country, currency and mode. Switch on
cards (Apple Pay and Google Pay ride on cards; hosted Checkout needs no domain
verification for them), Klarna, SEPA Direct Debit, PayPal and Link. Klarna
appears for passes wherever it operates and for subscriptions only where
Stripe supports it for recurring payments. SEPA Direct Debit is a delayed
method: a pass bought with it is granted on `async_payment_succeeded`, days
after checkout.

### The Customer Portal

Dashboard → Settings → Billing → Customer portal. The app passes no portal
configuration, so this page is the configuration. Switch on: invoice history;
updating the payment method; cancelling, at the end of the billing period;
switching plans between the four subscription Prices, prorated. Leave pausing
off (a paused subscription grants nothing, and the app has nowhere to say
so). The app does not offer the portal to a learner whose only subscription
is the trial; the webhook sets every trial to cancel at its end, so a card
added anywhere cannot turn it into a charge. Stripe's own trial reminder
emails can stay off: the trial ends by itself and the app says so.

Set no trial anywhere else — not on a Price, not on a promotion code. The
Premium trial is the only one (spec S6), and the webhook treats every
subscription it finds `trialing` as that trial: it sets it to cancel at its
period end, which on a paid order's subscription would end it.

### Local testing

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook   # prints a whsec_ for STRIPE_WEBHOOK_SECRET
pnpm dev:learner
```

Then order through the app — `/pricing`, a plan, the order page — and pay with
Stripe's test card `4242 4242 4242 4242` (any future date, any CVC), or a test
SEPA IBAN to see a delayed payment. `stripe trigger` sends fixture objects for
customers this app never created; the webhook acknowledges them as
`unknown_customer` and grants nothing, which is correct and not a useful test.
`stripe events resend <evt_…>` redelivers one event.

### When a payment does not arrive

Every event is a row in `billing_events`: `select event_type, status,
error_code, attempts from billing_events order by received_at desc limit 20`.

- `failed` / `unknown_offer` — our customer, a Price the webhook cannot place:
  no known lookup key, not in the mirror, no `plan_code` metadata. Fix the
  Price (or run `prices:sync`) and let Stripe retry, or resend the event.
- `failed` / `invalid_pass_days` — a pass Price without a whole-number
  `pass_days` between 1 and 730 in its metadata.
- `failed` / `stripe_*` — Stripe was unreachable, rate limited, or refused the
  key. In live mode Stripe retries an event for up to three days (in test mode,
  a few times over some hours); after that it is not applied, because there is
  no reconcile job yet — resend it.
- `ignored` / `unknown_customer` — a customer this application did not create.
- A learner who paid and still sees Free: find their pseudonym's audit lines —
  `billing.subscription_changed`, `billing.pass_granted` — and the event rows
  around the time they paid.

A learner told "Your trial is already waiting on Stripe's page" opened a trial
checkout in the last 40 minutes and did not finish it: the trial's Checkout
Session lives 35 minutes and the order record holds a second one back while
the first could still complete.

### Before a live key

Spec S11, none of it optional, and none of it built: the "Cancel contracts
here" button in every footer with its form (§312k BGB), the "Withdraw from
contract" button (§356a BGB), text-form confirmation of both (which needs an
email sender this product does not have), the post-first-year terms of the
annual plan (§309 Nr. 9), the Impressum, terms, privacy policy and withdrawal
instructions with the model form — `/legal/terms` is a stub — and the EU AI
Act disclosures. Kleinunternehmer status, OSS registration and Stripe Tax
versus a merchant of record are a Steuerberater's questions. Account deletion
must cancel an active subscription first, and does not yet.

### Comps

A comp gives a plan without a sale (billing-and-plans-spec.md S5, source 3):
a row in `plan_comps`, written through the secret-key client — the SQL editor
or a service-role script, never a learner's session, which can only read it.
The operator app has no page for this yet. To grant Premium indefinitely:

```sql
insert into public.plan_comps (learner_id, plan_code, reason)
values ('<learner uuid>', 'premium', 'operator');
```

`ends_at` bounds it, `reason` is a short code (`^[a-z0-9_]{1,60}$` — never a
name or an email), and revoking is `update public.plan_comps set revoked_at =
now() where id = '<id>'`; nothing deletes, the row is the record. The
operator's own learner account (`69dc…f363e`) is seeded a Premium comp by
migration `20260928100000_plan_comps.sql`, guarded on the profile existing —
an account created after that migration ran gets its comp with the insert
above.

- Row Level Security on every table a learner owns, with `USING` **and**
  `WITH CHECK` on every update policy
- Accounting tables have RLS enabled and **no policy at all** — only the secret
  key reaches them
- No `SECURITY DEFINER` function anywhere; a migration test fails the build if
  one appears
- The usage ledger is append-only, enforced by a trigger, and holds a
  pseudonymous hash rather than a user id
- Learner errors are returned to the browser as a small closed set of kinds with
  safe messages; the original is attached non-enumerably so it cannot be
  serialised into a response by accident
- Secret values are never logged. Presence, length and prefix only

One advisor finding is open: `auth_leaked_password_protection` is disabled on
the project. Enabling it is a dashboard toggle.

## The Trainer's request duration

One `/api/trainer` request is a whole agent loop — up to seven model calls
plus tool fetches — and can legitimately run 30–90 seconds. The route declares
`maxDuration = 120`, which the containers honour (the Cloud Run manifests set
a 900 s request timeout); a serverless host with a lower function ceiling would
cut the loop short at its own limit. The step cap and the per-request euro
ceiling bound the worst case either way.

## OpenRouter's account data policy can hide models

OpenRouter serves a model only through endpoints the account's privacy
settings allow (https://openrouter.ai/settings/privacy). A restrictive policy
can leave a registry default with **no endpoint at all** — the API answers
`404 No endpoints available matching your guardrail restrictions and data
policy` — and which models are affected depends on the account, not the code.
Both model paths ride this out the same way: the chat transport and the
Trainer's model ladder try the tier's same-tier fallbacks in order, and the
ledger shows what actually happened (an error row for the refused model, then
rows for the one that answered). If the ledger shows a tier permanently
running on its fallback, either loosen the account's data policy or point the
tier at an allowed model with its `OPENROUTER_MODEL_*` override — the
fallback works, but it hides that the chosen primary is never used.

A related note on `.env` hygiene: a blank line such as `MCP_SERVER_API_KEY=`
reaches the process as an empty string, and `parseEnv` treats blank as unset
rather than failing validation — so a placeholder line is harmless.
