-- The spend dashboard, told what it already knows.
--
-- Two things were wrong with the summary this replaces, and together they made
-- an operator's only view of AI spend read zero against real money.
--
-- The first is that it reported euro alone. Euro is the reporting currency and
-- stays the headline, but it is derived: a row written when no exchange rate
-- had ever been snapshotted stores an exact dollar figure and a euro figure of
-- zero, because inventing one would put a number in a financial record that
-- nothing ever charged. The dollars were on every row the whole time and the
-- summary threw them away. It now carries both, and the page shows euro with
-- dollars beside it.
--
-- The second is what `unpriced` counted. fx_stale is set on two quite different
-- rows: one that could not be priced at all, and one priced correctly at a rate
-- carried forward from the last day the source published — a weekend, in the
-- ordinary case. Counting them together meant the alert could never clear, and
-- an alert that is always on is an alert nobody reads. They are counted apart
-- now: unpriced means no rate was stored on the row.
--
-- Historical rows are untouched, as they must be. public.model_invocations is
-- append-only by trigger and its euro figures are final.

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
      -- Exact, always known, and independent of whether a rate was ever
      -- snapshotted. The number that stays true when the euro one cannot be.
      coalesce(sum(cost_usd), 0)                        as cost_usd,
      coalesce(sum(input_tokens), 0)                    as input_tokens,
      coalesce(sum(output_tokens), 0)                   as output_tokens,
      count(*) filter (where status <> 'ok')            as failures,
      count(*) filter (where status = 'budget_denied')  as budget_denials,
      count(*) filter (where truncated)                 as truncations,
      count(*) filter (where degraded)                  as degraded,
      -- No rate on the row at all: its euro figure is zero and means nothing.
      count(*) filter (where fx_rate_eur_per_usd is null)
                                                        as unpriced,
      -- Priced, correctly, at a rate from an earlier day. Normal over a
      -- weekend; a broken snapshot job if it persists.
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
          'inputTokens', coalesce(sum(input_tokens), 0),
          'outputTokens', coalesce(sum(output_tokens), 0)
        ) as row,
        -- Ordered by dollars, not euro: the ordering has to survive a window
        -- in which nothing could be priced, or the most expensive task sorts
        -- alongside the free ones.
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
          'costUsd', coalesce(sum(cost_usd), 0)
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
