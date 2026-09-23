-- Model usage accounting and EUR budgets.
--
-- Operator-scope tables. They are not user-owned, so the pattern is
-- deny-by-default rather than auth.uid() ownership: RLS is enabled and no
-- policy is created, which denies anon and authenticated entirely. Only the
-- service role, which bypasses RLS, may touch them.
--
-- They reference user_id_hash rather than a user foreign key, so financial
-- history survives account deletion without holding identifying data.

create table public.fx_rates (
  id             bigint generated always as identity primary key,
  base_currency  text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate           numeric(18,8) not null check (rate > 0),
  rate_date      date not null,
  source         text not null,
  fetched_at     timestamptz not null default now(),
  constraint fx_rates_one_per_pair_per_day
    unique (base_currency, quote_currency, rate_date)
);

create table public.model_pricing_snapshots (
  id                      bigint generated always as identity primary key,
  provider                text not null,
  model_id                text not null,
  input_price_per_token   numeric(18,12) not null check (input_price_per_token >= 0),
  output_price_per_token  numeric(18,12) not null check (output_price_per_token >= 0),
  currency                text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  fetched_at              timestamptz not null default now(),
  constraint model_pricing_unique_snapshot
    unique (provider, model_id, fetched_at)
);

-- Append-only ledger: one row per model call, on success and on failure alike.
-- A failed call that produced tokens still cost money. Retries are separate
-- rows; nothing here is ever updated.
create table public.model_invocations (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  request_id          uuid,
  trace_id            text,
  span_id             text,
  user_id_hash        text,
  thread_id           uuid,
  message_id          uuid,
  task                text not null,
  tier                text not null check (tier in (
                        'reasoning','strong','mid','cheap','nano',
                        'embedding','stt','tts')),
  prompt_name         text,
  prompt_version      integer,
  provider            text not null,
  model_id            text not null,
  model_id_resolved   text not null,
  input_tokens        integer not null default 0 check (input_tokens >= 0),
  output_tokens       integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens    integer check (reasoning_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens >= 0),
  max_output_tokens   integer not null check (max_output_tokens > 0),
  truncated           boolean not null default false,
  escalated           boolean not null default false,
  attempt_number      integer not null default 1 check (attempt_number >= 1),
  latency_ms          integer check (latency_ms >= 0),
  first_token_ms      integer check (first_token_ms >= 0),
  status              text not null check (status in (
                        'ok','error','timeout','budget_denied','ceiling_denied')),
  error_code          text,
  cost_usd            numeric(18,8) not null default 0 check (cost_usd >= 0),
  fx_rate_eur_per_usd numeric(18,8) not null check (fx_rate_eur_per_usd > 0),
  fx_stale            boolean not null default false,
  -- Converted at write time and stored. Historical spend is never restated
  -- when the rate moves.
  cost_eur            numeric(18,8) not null default 0 check (cost_eur >= 0)
);

create index model_invocations_created_idx on public.model_invocations (created_at desc);
create index model_invocations_user_idx on public.model_invocations (user_id_hash, created_at desc);
create index model_invocations_task_idx on public.model_invocations (task, created_at desc);
create index model_invocations_model_idx on public.model_invocations (model_id_resolved, created_at desc);
create index model_invocations_request_idx on public.model_invocations (request_id);
-- Denials and truncations are rare, so a partial index keeps the guardrail
-- views cheap without carrying the whole ledger.
create index model_invocations_problems_idx
  on public.model_invocations (status, created_at desc)
  where status <> 'ok';

create table public.budget_limits (
  id         bigint generated always as identity primary key,
  scope      text not null check (scope in (
               'per_request','per_user_daily','per_user_monthly','global_daily')),
  scope_key  text,
  limit_eur  numeric(12,4) not null check (limit_eur >= 0),
  warn_pct   numeric(4,3) not null default 0.7 check (warn_pct between 0 and 1),
  degrade_pct numeric(4,3) not null default 0.9 check (degrade_pct between 0 and 1),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_limits_warn_before_degrade check (warn_pct <= degrade_pct),
  constraint budget_limits_one_per_scope unique (scope, scope_key)
);

-- Incremented transactionally on ledger write. The budget gate reads this,
-- never a scan of model_invocations.
create table public.budget_counters (
  id           bigint generated always as identity primary key,
  scope        text not null check (scope in (
                 'per_request','per_user_daily','per_user_monthly','global_daily')),
  scope_key    text,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  spent_eur    numeric(14,6) not null default 0 check (spent_eur >= 0),
  updated_at   timestamptz not null default now(),
  constraint budget_counters_period_order check (period_end > period_start),
  constraint budget_counters_one_per_period
    unique (scope, scope_key, period_start)
);

create table public.cost_rollup_daily (
  id                bigint generated always as identity primary key,
  day               date not null,
  task              text not null,
  tier              text not null,
  model_id_resolved text not null,
  status            text not null,
  call_count        integer not null default 0 check (call_count >= 0),
  input_tokens      bigint not null default 0 check (input_tokens >= 0),
  output_tokens     bigint not null default 0 check (output_tokens >= 0),
  cost_eur          numeric(14,6) not null default 0 check (cost_eur >= 0),
  p50_latency_ms    integer check (p50_latency_ms >= 0),
  p95_latency_ms    integer check (p95_latency_ms >= 0),
  truncated_count   integer not null default 0 check (truncated_count >= 0),
  rebuilt_at        timestamptz not null default now(),
  -- Rebuilding a day must be idempotent.
  constraint cost_rollup_daily_unique_bucket
    unique (day, task, tier, model_id_resolved, status)
);

create index cost_rollup_daily_day_idx on public.cost_rollup_daily (day desc);

create trigger budget_limits_touch before update on public.budget_limits
  for each row execute function public.touch_updated_at();
