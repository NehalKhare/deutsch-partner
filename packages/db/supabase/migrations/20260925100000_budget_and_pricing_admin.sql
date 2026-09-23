-- The operator's budget and pricing pages.
--
-- Until now budget_limits had a gate reading it and nothing writing it: no
-- seed, no form, no function. An empty table is a deployment with no euro
-- limit at any scope, which the gate allows by design ("no limits configured
-- is a deployment decision"). These functions give that decision a place to
-- be made and seen.
--
-- Operator scope throughout. Every function is revoked from anon and
-- authenticated; only the secret key reaches them, from behind the ops app's
-- allowlist and second factor.

-- ---------------------------------------------------------------------------
-- Writing a limit
-- ---------------------------------------------------------------------------

-- Creates or edits the one row for a scope and key, and returns the row as it
-- was and as it is, so the audit event can say what changed.
--
-- The refusals the form makes are made again here, because a form is one
-- caller and this function is the table's only write path from the ops app:
--   - per_request is not a table-backed scope; budget_snapshot excludes it.
--   - global_daily takes no key; budget_snapshot would never match one.
--   - a scope's default cannot be switched off. No row is no limit, and fail
--     closed means a default can be lowered, even to zero, but not removed.
-- warn <= degrade is the table's own check and is left to it.
create or replace function public.set_budget_limit(
  p_scope       text,
  p_scope_key   text,
  p_limit_eur   numeric,
  p_warn_pct    numeric,
  p_degrade_pct numeric,
  p_active      boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.budget_limits;
  v_after  public.budget_limits;
begin
  if p_scope not in ('global_daily', 'per_user_daily', 'per_user_monthly') then
    raise exception 'budget scope % is not set from the table', p_scope
      using errcode = '22023';
  end if;

  if p_scope = 'global_daily' and p_scope_key is not null then
    raise exception 'the global scope takes no key' using errcode = '22023';
  end if;

  if p_scope_key is null and not coalesce(p_active, false) then
    raise exception 'a scope''s default cannot be switched off' using errcode = '22023';
  end if;

  select * into v_before
    from public.budget_limits l
   where l.scope = p_scope
     and l.scope_key is not distinct from p_scope_key
     for update;

  insert into public.budget_limits
    (scope, scope_key, limit_eur, warn_pct, degrade_pct, active)
  values
    (p_scope, p_scope_key, p_limit_eur, p_warn_pct, p_degrade_pct, p_active)
  on conflict on constraint budget_limits_one_per_scope do update
    set limit_eur   = excluded.limit_eur,
        warn_pct    = excluded.warn_pct,
        degrade_pct = excluded.degrade_pct,
        active      = excluded.active
  returning * into v_after;

  return jsonb_build_object(
    'before', case when v_before.id is null then null else to_jsonb(v_before) end,
    'after',  to_jsonb(v_after)
  );
end;
$$;

revoke all on function public.set_budget_limit(text, text, numeric, numeric, numeric, boolean)
  from public, anon, authenticated;

-- Removes one learner's override, returning the row removed or null. A scope's
-- default is never removed here: the key filter cannot match a null.
create or replace function public.remove_budget_override(
  p_scope     text,
  p_scope_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with removed as (
    delete from public.budget_limits l
     where l.scope = p_scope
       and l.scope_key = p_scope_key
    returning l.*
  )
  select to_jsonb(removed) from removed;
$$;

revoke all on function public.remove_budget_override(text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading the budgets
-- ---------------------------------------------------------------------------

-- Every configured limit, today's global counter, and the learners closest to
-- their caps in the current periods.
--
-- A learner's limit is resolved exactly as budget_snapshot resolves it: an
-- active override for that hash, else the scope's active default, else none.
-- The page and the gate therefore cannot disagree about which figure applies.
-- Periods are the counter periods — a UTC day, a UTC calendar month — not a
-- rolling window, because that is what the counters hold.
create or replace function public.budget_overview(
  p_now timestamptz default now(),
  p_top integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('day',   p_now at time zone 'UTC') at time zone 'UTC' as day_start,
      date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC' as month_start,
      least(greatest(coalesce(p_top, 20), 1), 100)                     as top
  ),
  limits as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',         l.id,
          'scope',      l.scope,
          'scopeKey',   l.scope_key,
          'limitEur',   l.limit_eur,
          'warnPct',    l.warn_pct,
          'degradePct', l.degrade_pct,
          'active',     l.active,
          'updatedAt',  l.updated_at
        )
        order by l.scope, l.scope_key nulls first
      ),
      '[]'::jsonb
    ) as rows
    from public.budget_limits l
  ),
  global_spend as (
    select coalesce(sum(c.spent_eur), 0) as spent
      from public.budget_counters c, bounds b
     where c.scope = 'global_daily'
       and c.scope_key is null
       and c.period_start = b.day_start
  ),
  current_counters as (
    select c.scope, c.scope_key, c.spent_eur
      from public.budget_counters c, bounds b
     where c.scope in ('per_user_daily', 'per_user_monthly')
       and c.scope_key is not null
       and c.period_start = case
                              when c.scope = 'per_user_monthly' then b.month_start
                              else b.day_start
                            end
  ),
  ranked as (
    select
      c.scope,
      c.scope_key,
      c.spent_eur,
      eff.limit_eur,
      eff.warn_pct,
      eff.degrade_pct,
      coalesce(eff.overridden, false) as overridden,
      row_number() over (partition by c.scope order by c.spent_eur desc, c.scope_key) as rank
    from current_counters c
    left join lateral (
      select
        l.limit_eur,
        l.warn_pct,
        l.degrade_pct,
        l.scope_key is not null as overridden
      from public.budget_limits l
      where l.active
        and l.scope = c.scope
        and (l.scope_key is null or l.scope_key = c.scope_key)
      order by (l.scope_key is not null) desc
      limit 1
    ) eff on true
  ),
  learners as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'scope',      r.scope,
          'userIdHash', r.scope_key,
          'spentEur',   r.spent_eur,
          'limitEur',   r.limit_eur,
          'warnPct',    r.warn_pct,
          'degradePct', r.degrade_pct,
          'overridden', r.overridden
        )
        order by r.scope, r.rank
      ),
      '[]'::jsonb
    ) as rows
    from ranked r, bounds b
    where r.rank <= b.top
  ),
  learner_counts as (
    select
      count(*) filter (where scope = 'per_user_daily')   as daily,
      count(*) filter (where scope = 'per_user_monthly') as monthly
    from current_counters
  )
  select jsonb_build_object(
    'generatedAt',    p_now,
    'dayStart',       b.day_start,
    'monthStart',     b.month_start,
    'limits',         l.rows,
    'globalSpentEur', g.spent,
    'learners',       lr.rows,
    'learnerCounts',  jsonb_build_object('daily', lc.daily, 'monthly', lc.monthly)
  )
  from bounds b, limits l, global_spend g, learners lr, learner_counts lc;
$$;

revoke all on function public.budget_overview(timestamptz, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading the prices
-- ---------------------------------------------------------------------------

-- The newest price per model, with the last price that differed from it, and
-- the recent euro rates.
--
-- Prices are for pre-flight estimation (cost-dashboard-spec.md S3); what a
-- call cost is what the provider reported and is never restated from these.
-- The page exists to show whether the snapshot job is still running and when
-- a provider moved a price, which is the thing that explains a step in spend.
create or replace function public.pricing_overview(
  p_fx_days integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (p.provider, p.model_id)
      p.provider,
      p.model_id,
      p.input_price_per_token,
      p.output_price_per_token,
      p.currency,
      p.fetched_at
    from public.model_pricing_snapshots p
    order by p.provider, p.model_id, p.fetched_at desc
  ),
  models as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'provider',          l.provider,
          'modelId',           l.model_id,
          'currency',          l.currency,
          'inputUsdPerToken',  l.input_price_per_token,
          'outputUsdPerToken', l.output_price_per_token,
          'fetchedAt',         l.fetched_at,
          'snapshots', (
            select count(*)
              from public.model_pricing_snapshots s
             where s.provider = l.provider
               and s.model_id = l.model_id
          ),
          'previous', (
            select jsonb_build_object(
                     'inputUsdPerToken',  s.input_price_per_token,
                     'outputUsdPerToken', s.output_price_per_token,
                     'fetchedAt',         s.fetched_at)
              from public.model_pricing_snapshots s
             where s.provider = l.provider
               and s.model_id = l.model_id
               and (s.input_price_per_token, s.output_price_per_token)
                   is distinct from (l.input_price_per_token, l.output_price_per_token)
             order by s.fetched_at desc
             limit 1
          )
        )
        order by l.provider, l.model_id
      ),
      '[]'::jsonb
    ) as rows
    from latest l
  ),
  fx as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rate',      r.rate,
          'rateDate',  r.rate_date,
          'source',    r.source,
          'fetchedAt', r.fetched_at
        )
        order by r.rate_date desc
      ),
      '[]'::jsonb
    ) as rows
    from (
      select *
        from public.fx_rates f
       where f.base_currency = 'USD'
         and f.quote_currency = 'EUR'
       order by f.rate_date desc
       limit least(greatest(coalesce(p_fx_days, 30), 1), 366)
    ) r
  )
  select jsonb_build_object(
    'models',        m.rows,
    'fx',            f.rows,
    'lastFetchedAt', (select max(p.fetched_at) from public.model_pricing_snapshots p)
  )
  from models m, fx f;
$$;

revoke all on function public.pricing_overview(integer)
  from public, anon, authenticated;
