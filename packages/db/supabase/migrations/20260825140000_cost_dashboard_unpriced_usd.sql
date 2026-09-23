-- Which dollars carry no euro figure of their own.
--
-- The summary already reports euro (converted at write time, stored, final)
-- and dollars (exact, always known). Neither answers the question the cost
-- dashboard actually has to answer for a deployment older than its first
-- exchange rate: what did all of this cost in euro?
--
-- Adding today's rate to the whole dollar column would double-count every row
-- that already carries a euro figure. So the split is reported instead: the
-- dollars belonging to rows with no rate on them, which are exactly the rows
-- whose stored euro figure is zero and means nothing. The read layer converts
-- that part, and only that part, at the newest snapshotted rate — and says so
-- on the page, because it is an estimate at today's rate rather than what was
-- charged on the day.
--
-- Nothing is restated. public.model_invocations stays append-only and every
-- stored cost_eur stays exactly as it was written.

create or replace function public.cost_dashboard(
  p_from timestamptz,
  p_to   timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with calls as (
    select *
      from public.model_invocations mi
     where mi.created_at >= p_from
       and mi.created_at <  p_to
  ),
  totals as (
    select
      count(*)                                          as call_count,
      count(distinct user_id_hash)                      as learner_count,
      coalesce(sum(cost_eur), 0)                        as cost_eur,
      coalesce(sum(cost_usd), 0)                        as cost_usd,
      -- The part of the dollars that no euro figure covers.
      coalesce(
        sum(cost_usd) filter (where fx_rate_eur_per_usd is null), 0
      )                                                 as cost_usd_unpriced,
      coalesce(sum(input_tokens), 0)                    as input_tokens,
      coalesce(sum(output_tokens), 0)                   as output_tokens,
      count(*) filter (where status <> 'ok')            as failures,
      count(*) filter (where status = 'budget_denied')  as budget_denials,
      count(*) filter (where truncated)                 as truncations,
      count(*) filter (where degraded)                  as degraded,
      count(*) filter (where fx_rate_eur_per_usd is null)
                                                        as unpriced,
      count(*) filter (where fx_stale and fx_rate_eur_per_usd is not null)
                                                        as carried_forward
    from calls
  ),
  by_task as (
    select coalesce(jsonb_agg(row order by cost_usd desc), '[]'::jsonb) as rows
    from (
      select
        jsonb_build_object(
          'task', task,
          'tier', tier,
          'calls', count(*),
          'costEur', coalesce(sum(cost_eur), 0),
          'costUsd', coalesce(sum(cost_usd), 0),
          'costUsdUnpriced', coalesce(
            sum(cost_usd) filter (where fx_rate_eur_per_usd is null), 0
          ),
          'inputTokens', coalesce(sum(input_tokens), 0),
          'outputTokens', coalesce(sum(output_tokens), 0)
        ) as row,
        coalesce(sum(cost_usd), 0) as cost_usd
      from calls
      group by task, tier
    ) grouped
  ),
  by_model as (
    select coalesce(jsonb_agg(row order by cost_usd desc), '[]'::jsonb) as rows
    from (
      select
        jsonb_build_object(
          'modelId', model_id_resolved,
          'calls', count(*),
          'costEur', coalesce(sum(cost_eur), 0),
          'costUsd', coalesce(sum(cost_usd), 0),
          'costUsdUnpriced', coalesce(
            sum(cost_usd) filter (where fx_rate_eur_per_usd is null), 0
          )
        ) as row,
        coalesce(sum(cost_usd), 0) as cost_usd
      from calls
      group by model_id_resolved
    ) grouped
  ),
  fx as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('rate', rate, 'rateDate', rate_date, 'source', source)
        order by rate_date desc
      ) filter (where rate is not null),
      '[]'::jsonb
    ) as rates
    from (
      select r.* from public.fx_rates r
       where r.base_currency = 'USD' and r.quote_currency = 'EUR'
       order by r.rate_date desc
       limit 1
    ) r
  )
  select jsonb_build_object(
    'window',  jsonb_build_object('from', p_from, 'to', p_to),
    'totals',  to_jsonb(t),
    'byTask',  bt.rows,
    'byModel', bm.rows,
    -- Shown on the dashboard, because a euro figure derived from an unstated
    -- rate is not auditable.
    'fxRate',  fx.rates
  )
  from totals t, by_task bt, by_model bm, fx;
$$;

revoke all on function public.cost_dashboard(timestamptz, timestamptz)
  from public, anon, authenticated;
