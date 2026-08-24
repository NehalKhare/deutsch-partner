You are the product and platform engineer responsible for the Deutsch Partner
AI cost and usage dashboard.

This document specifies an internal, operator-facing dashboard that reports AI
spend in EUR. It depends on the ledger and budget model defined in
model-routing-and-cost-control.md.

==================================================
1. PURPOSE
==================================================

Answer five questions, quickly and truthfully:

  1. What are we spending right now, in EUR, and against what budget?
  2. Where is it going: which task, which tier, which model?
  3. What does one learner cost, and what does one conversation turn cost?
  4. Is anything degraded, denied, truncated, or retrying?
  5. Is a cheaper tier viable for a task, or is it failing and repairing upward?

Non-goals:

  Not a billing system. Not learner-facing. Not a replacement for LangSmith
  traces, which remain the tool for debugging an individual generation.

==================================================
2. ACCESS CONTROL
==================================================

Operator-only. This is not a learner feature.

  - Route lives under an admin segment with a server-side role check on every
    request. Not a client-side conditional render.
  - Role comes from a server-controlled source, never from a client claim.
  - Fail closed: no role determined means no access, per guardrails doc S26.
  - Aggregate views show user_id_hash only, never email or raw user id.
  - No conversation content anywhere on the dashboard. The ledger does not
    contain any, and the dashboard must not join to fetch it.
  - Viewing the dashboard is itself a privileged operation. Audit it
    (guardrails doc S24).

==================================================
3. DATA MODEL
==================================================

New migrations. All amounts stored as integer minor units or numeric with
explicit scale. Never floats for money.

TABLE model_invocations          (append-only ledger; one row per model call)
  id
  created_at
  request_id, trace_id, span_id
  user_id_hash
  thread_id, message_id                      nullable
  task, tier
  provider, model_id, model_id_resolved
  input_tokens, output_tokens
  reasoning_tokens, cached_input_tokens      nullable
  max_output_tokens
  truncated                                  boolean
  escalated                                  boolean
  attempt_number                             retries are separate rows
  latency_ms, first_token_ms                 first_token_ms nullable
  status        ok | error | timeout | budget_denied | ceiling_denied
  error_code                                 nullable
  cost_usd                                   numeric
  fx_rate_eur_per_usd                        numeric
  fx_stale                                   boolean
  cost_eur                                   numeric, computed at write time

  Indexes: (created_at), (user_id_hash, created_at), (task, created_at),
           (model_id_resolved, created_at), (status, created_at)
  Never updated. Never deleted except by retention policy.

TABLE fx_rates
  id, base_currency, quote_currency, rate, rate_date, source, fetched_at
  Unique on (base_currency, quote_currency, rate_date)

TABLE model_pricing_snapshots
  id, provider, model_id, input_price_per_token, output_price_per_token,
  currency, fetched_at
  Populated on a schedule from the provider model list. Used for pre-flight
  estimation only, never to restate actual recorded cost.

TABLE budget_limits
  id, scope        per_request | per_user_daily | per_user_monthly | global_daily
  scope_key        nullable; user_id_hash for per-user scopes
  limit_eur, warn_pct, degrade_pct, active, created_at, updated_at

TABLE budget_counters
  id, scope, scope_key, period_start, period_end, spent_eur, updated_at
  Incremented transactionally on ledger write. The budget gate reads this,
  never a scan of model_invocations.

TABLE cost_rollup_daily      (materialized aggregate; rebuilt on schedule)
  day, task, tier, model_id_resolved, status
  call_count, input_tokens, output_tokens, cost_eur,
  p50_latency_ms, p95_latency_ms, truncated_count

RLS:

  model_invocations, budget_limits, budget_counters, cost_rollup_daily,
  fx_rates, model_pricing_snapshots are operator-scope tables. Deny to
  authenticated learners entirely. They are not user-owned data, so the pattern
  is deny-by-default rather than auth.uid() ownership.

  The ledger references user_id_hash, not a foreign key to the user, so that
  account deletion does not destroy financial history. Confirm this against the
  data-deletion requirements in guardrails doc S16: cost records are
  pseudonymous operational data and should survive account deletion, but the
  hash must not be reversible.

==================================================
4. AGGREGATION
==================================================

Do not aggregate in React. Server-side only, per build-spec.md S23.

  - Live tiles (today, current hour) query budget_counters and a bounded recent
    window of model_invocations.
  - Historical views read cost_rollup_daily. Never scan the raw ledger for a
    30-day chart.
  - Rollups rebuild on a schedule and are idempotent for a given day.
  - Every displayed figure states its currency and the FX rate date used.

==================================================
5. VIEWS
==================================================

VIEW: Overview

  Tiles:
    Spend today (EUR)              with % of global_daily budget
    Spend month to date (EUR)      with projection to month end
    Budget state                   normal | warn | degraded | denied
    Cost per active learner today (EUR)
    Cost per conversation turn (EUR, median and p95)
    Calls today                    with error rate and denial count

  Burn chart: cumulative EUR today against the global daily limit line.

  Alert strip: any active degradation, any denial in the last hour, any
  fx_stale rows, any provider fallback spike.

VIEW: By task

  Table, sorted by cost_eur descending:
    task | tier | calls | input tokens | output tokens | cost EUR
         | EUR per call | p50 / p95 latency | schema failure rate
         | repair rate | truncation rate

  This is the table that drives tier decisions. A cheap task with a high repair
  rate is the signal that it is not actually cheap.

VIEW: By model

  Table: model_id_resolved | provider | calls | tokens | cost EUR | error rate
         | p95 latency | escalation count

  model_id_resolved matters: OpenRouter may route to a different underlying
  provider than requested. Show both requested and resolved.

VIEW: By learner

  Table: user_id_hash | messages | calls | cost EUR today | cost EUR MTD
         | budget state | denials

  Sorted by cost descending. This surfaces both power users and abuse.
  Hash only. No identifying fields.

VIEW: Ceilings and guardrails

    truncated calls (layer 3 fired)      -> ceilings too tight, or a model
                                            ignoring the parameter
    ceiling_denied calls                 -> context assembly exceeding budget
    budget_denied calls                  -> real learners being turned away
    degraded turns                       -> quality regressions with a cost cause
    context shedding events by section   -> what is getting dropped and how often

  Each row links to the LangSmith trace by trace_id.

VIEW: Efficiency

    cache hit rate for embeddings
    cache hit rate for classifications
    provider prompt-cache hit rate and EUR saved
    evaluation skip rate (trivial messages)
    average tokens per turn, trend over time

  This view exists to make the cheap wins in
  model-routing-and-cost-control.md S7 visible enough to defend.

==================================================
6. ALERTS
==================================================

Alert, do not merely display:

  global_daily at 70%              WARN log + dashboard indicator
  global_daily at 90%              degradation active, notify
  global_daily at 100%             page. This is an outage.
  per-user denial spike            possible abuse, security audit event
  cost per turn up >50% day/day    likely a routing or ceiling regression
  fallback rate above threshold    provider degradation
  fx_stale for more than 48h       FX pipeline broken
  ledger write failures            accounting is blind; treat as severity-high

A dashboard nobody looks at is not a control. The budget gate in
model-routing-and-cost-control.md S9 is the control. This dashboard explains it.

==================================================
7. CURRENCY PRESENTATION
==================================================

  - Display EUR everywhere, formatted for de-DE.
  - Show USD as a secondary figure on detail views only.
  - Always show the FX rate and its date. A euro number with an unstated rate
    is not auditable.
  - Never restate historical EUR figures when the rate moves. Stored cost_eur
    is final.
  - Amounts below one cent display with enough precision to be useful
    (four decimal places on per-call figures). Rounding per-call costs to cents
    makes high-volume nano-tier traffic look free.

==================================================
8. TDD REQUIREMENTS
==================================================

Domain and aggregation logic first, UI second.

  - EUR conversion: given cost_usd and a rate, produces the expected cost_eur
  - conversion uses the stored rate, not the current rate, on historical rows
  - missing rate carries forward the last known rate and sets fx_stale
  - rollup for a day is idempotent when run twice
  - rollup totals equal the sum of the underlying ledger rows for that day
  - per-turn cost aggregates all calls sharing a request_id
  - budget counter increments transactionally with the ledger write
  - a failed ledger write does not leave a counter incremented
  - projection to month end is computed from elapsed days, not extrapolated
    from a single day
  - a learner role receives 403 on every dashboard route
  - no dashboard response payload contains message content or an email
  - money is never handled as a float in any tested path

Component tests:
  - tiles render a budget state from server-provided data without recomputing it
  - empty state renders when there is no spend, without dividing by zero
  - degraded state is visually distinct, not a subtle color change

==================================================
9. BUILD ORDER
==================================================

Phase 17.5, after the dashboard in build-spec.md S23 and after ModelGateway.

  1. migrations: model_invocations, fx_rates, budget_limits, budget_counters
  2. ledger write inside ModelGateway, with tests
  3. FX snapshot job with carry-forward
  4. budget counters and the budget gate (this is the control; ship it early)
  5. cost_rollup_daily and the rollup job
  6. Overview view
  7. By task, by model, by learner views
  8. Ceilings and Efficiency views
  9. alerting

Steps 1 through 4 are the parts that actually protect the budget. Ship them
with the first real model call, not after. The visualization can lag; the
ceiling cannot.
