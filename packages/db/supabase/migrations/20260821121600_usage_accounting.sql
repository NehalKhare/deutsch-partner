-- The usage ledger's write path.
--
-- Three things have to be true at once, and none of them survives being done
-- in separate round trips from application code:
--
--   1. Every model call leaves exactly one row, on success and on failure.
--   2. The budget counters the gate reads are incremented in the same
--      transaction as the row that justified the increment. A counter that can
--      drift from the ledger is a budget that can be walked past.
--   3. A written row is never restated. Historical spend was converted at a
--      rate that was current then; recomputing it later would rewrite the past.

-- ---------------------------------------------------------------------------
-- Fields the routing document requires that the original table did not carry.
-- ---------------------------------------------------------------------------

alter table public.model_invocations
  add column prompt_fingerprint text,
  -- Which budget scope forced a degrade or a denial. Null when none did.
  add column budget_scope_hit   text check (budget_scope_hit in (
                                  'per_request','per_user_daily',
                                  'per_user_monthly','global_daily')),
  -- The call ran on a cheaper tier or a shortened ceiling than its task asks
  -- for. Recorded because a quality regression has to be explainable later.
  add column degraded           boolean not null default false;

-- An unpriced call is possible: the FX snapshot may not have run yet, and the
-- routing document forbids blocking a call on an FX lookup. When that happens
-- the row still records the exact USD the provider charged; it simply cannot
-- state a euro figure, and says so rather than inventing one.
alter table public.model_invocations
  alter column fx_rate_eur_per_usd drop not null;

alter table public.model_invocations
  drop constraint model_invocations_fx_rate_eur_per_usd_check;

alter table public.model_invocations
  add constraint model_invocations_priced_or_declared_unpriced check (
    (fx_rate_eur_per_usd is not null and fx_rate_eur_per_usd > 0)
    or (fx_rate_eur_per_usd is null and cost_eur = 0 and fx_stale)
  );

create index model_invocations_unpriced_idx
  on public.model_invocations (created_at desc)
  where fx_rate_eur_per_usd is null;

-- ---------------------------------------------------------------------------
-- Append-only, enforced by the database rather than by convention.
-- ---------------------------------------------------------------------------

create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'public.model_invocations is append-only; retries and corrections are new rows'
    using errcode = '42501';
end;
$$;

create trigger model_invocations_append_only
  before update or delete on public.model_invocations
  for each row execute function public.reject_ledger_mutation();

-- A row trigger, so TRUNCATE goes around it. That is deliberate: truncating
-- requires ownership of the table, which anon and authenticated do not have
-- and the gateway's own role never needs. The guard is aimed at a well-meaning
-- correction to a single row, which is the mistake that actually happens.

-- ---------------------------------------------------------------------------
-- Counter uniqueness has to treat a null scope key as one key, not as many.
-- ---------------------------------------------------------------------------
--
-- global_daily has no scope key. Under the default NULLS DISTINCT rule every
-- insert for it looks unique, so ON CONFLICT never fires and the counter forks
-- into a new row per call — a global budget that silently never fills.

alter table public.budget_counters
  drop constraint budget_counters_one_per_period;

alter table public.budget_counters
  add constraint budget_counters_one_per_period
  unique nulls not distinct (scope, scope_key, period_start);

alter table public.budget_limits
  drop constraint budget_limits_one_per_scope;

alter table public.budget_limits
  add constraint budget_limits_one_per_scope
  unique nulls not distinct (scope, scope_key);

-- ---------------------------------------------------------------------------
-- The single write path.
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, so the caller's own privileges decide. The accounting
-- tables have RLS enabled with no policy, which denies anon and authenticated
-- outright: only the service role, which the gateway runs under, gets through.
-- A SECURITY DEFINER here would turn the ledger into a public write endpoint.

create or replace function public.record_model_invocation(
  p_invocation        jsonb,
  p_budget_increments jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.model_invocations%rowtype;
  v_id  bigint;
  v_inc jsonb;
begin
  -- Unknown keys are dropped rather than stored. The ledger's shape is this
  -- table's, not whatever a caller happened to serialise.
  v_row := jsonb_populate_record(null::public.model_invocations, p_invocation);

  insert into public.model_invocations (
    request_id, trace_id, span_id, user_id_hash, thread_id, message_id,
    task, tier, prompt_name, prompt_version, prompt_fingerprint,
    provider, model_id, model_id_resolved,
    input_tokens, output_tokens, reasoning_tokens, cached_input_tokens,
    max_output_tokens, truncated, escalated, degraded, budget_scope_hit,
    attempt_number, latency_ms, first_token_ms, status, error_code,
    cost_usd, fx_rate_eur_per_usd, fx_stale, cost_eur
  ) values (
    v_row.request_id, v_row.trace_id, v_row.span_id, v_row.user_id_hash,
    v_row.thread_id, v_row.message_id,
    v_row.task, v_row.tier, v_row.prompt_name, v_row.prompt_version,
    v_row.prompt_fingerprint,
    v_row.provider, v_row.model_id, v_row.model_id_resolved,
    coalesce(v_row.input_tokens, 0), coalesce(v_row.output_tokens, 0),
    v_row.reasoning_tokens, v_row.cached_input_tokens,
    v_row.max_output_tokens,
    coalesce(v_row.truncated, false), coalesce(v_row.escalated, false),
    coalesce(v_row.degraded, false), v_row.budget_scope_hit,
    coalesce(v_row.attempt_number, 1), v_row.latency_ms, v_row.first_token_ms,
    v_row.status, v_row.error_code,
    coalesce(v_row.cost_usd, 0), v_row.fx_rate_eur_per_usd,
    coalesce(v_row.fx_stale, false), coalesce(v_row.cost_eur, 0)
  )
  returning id into v_id;

  -- Same transaction as the row above. If the insert fails, no counter moves;
  -- if a counter fails, the row does not land. The gate reads these counters
  -- and never scans the ledger.
  for v_inc in
    select value from jsonb_array_elements(coalesce(p_budget_increments, '[]'::jsonb))
  loop
    insert into public.budget_counters
      (scope, scope_key, period_start, period_end, spent_eur)
    values (
      v_inc->>'scope',
      v_inc->>'scope_key',
      (v_inc->>'period_start')::timestamptz,
      (v_inc->>'period_end')::timestamptz,
      coalesce((v_inc->>'amount_eur')::numeric, 0)
    )
    on conflict on constraint budget_counters_one_per_period do update
      set spent_eur  = public.budget_counters.spent_eur + excluded.spent_eur,
          updated_at = now();
  end loop;

  return v_id;
end;
$$;

-- Not a learner-facing function. Nothing but the service role should be able
-- to name it, let alone call it.
revoke all on function public.record_model_invocation(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.reject_ledger_mutation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the gate reads before every dispatch.
-- ---------------------------------------------------------------------------
--
-- One round trip. Pairing each active limit with its current counter in SQL
-- keeps the period arithmetic and the null-key matching in the one place that
-- handles both naturally, and keeps the gate off the request-path critical
-- section it would otherwise spend on three separate queries.
--
-- A learner-specific limit row wins over the default for its scope, which is
-- how a free-tier or an abusive account gets a smaller budget than everyone
-- else without a second mechanism.

create or replace function public.budget_snapshot(
  p_user_id_hash text default null,
  p_now          timestamptz default now()
)
returns table (
  scope       text,
  scope_key   text,
  limit_eur   numeric,
  spent_eur   numeric,
  warn_pct    numeric,
  degrade_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with applicable as (
    select distinct on (l.scope)
      l.scope,
      l.scope_key,
      l.limit_eur,
      l.warn_pct,
      l.degrade_pct
    from public.budget_limits l
    where l.active
      -- per_request is an accumulator on the request context, never a row.
      and l.scope <> 'per_request'
      and (l.scope_key is null or l.scope_key = p_user_id_hash)
    -- A key that matches this learner beats the scope's default.
    order by l.scope, (l.scope_key is not null) desc
  )
  select
    a.scope,
    case when a.scope like 'per\_user%' then p_user_id_hash else a.scope_key end,
    a.limit_eur,
    coalesce(c.spent_eur, 0),
    a.warn_pct,
    a.degrade_pct
  from applicable a
  left join public.budget_counters c
    on c.scope = a.scope
   and c.scope_key is not distinct from
       (case when a.scope like 'per\_user%' then p_user_id_hash else a.scope_key end)
   and c.period_start = (
         case when a.scope = 'per_user_monthly'
              then date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'
              else date_trunc('day',   p_now at time zone 'UTC') at time zone 'UTC'
         end);
$$;

revoke all on function public.budget_snapshot(text, timestamptz)
  from public, anon, authenticated;
