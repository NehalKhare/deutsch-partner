-- Name the model in the per-task breakdown.
--
-- The By-task table answered "what did this task cost" and the By-model table
-- answered "what did this model cost", and nothing joined them. The question
-- an operator actually arrives with sits in between: OpenRouter resolves a
-- requested model to whatever it routes to, a task escalates a tier mid-turn,
-- a fallback moves a provider — and none of that was visible without reading
-- two tables and guessing which row belonged to which.
--
-- So model_id_resolved joins the grouping key. A task that stayed on one
-- model is one row and reads exactly as before; a task that went to two is
-- two rows, and that split is the escalation, not a formatting accident.
--
-- Ordered task-total first so a task's rows stay adjacent. Ordering the whole
-- table by row cost alone would scatter a task's two models across the table
-- and hide the very thing splitting them was meant to show.
--
-- The limit is new and deliberate. The read layer has always capped this
-- array, so a deployment with more combinations than the cap failed the
-- schema and took the whole page down with it — a page that says nothing
-- because there was too much to say. Bounding it here means the table shows
-- the costliest and the page still renders.

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
    select coalesce(jsonb_agg(row order by task_usd desc, task_name, cost_usd desc), '[]'::jsonb)
             as rows
    from (
      select
        jsonb_build_object(
          'task', task,
          'tier', tier,
          -- What the provider actually ran, not what the registry asked for.
          'modelId', model_id_resolved,
          'calls', count(*),
          'costEur', coalesce(sum(cost_eur), 0),
          'costUsd', coalesce(sum(cost_usd), 0),
          'costUsdUnpriced', coalesce(
            sum(cost_usd) filter (where fx_rate_eur_per_usd is null), 0
          ),
          'inputTokens', coalesce(sum(input_tokens), 0),
          'outputTokens', coalesce(sum(output_tokens), 0)
        ) as row,
        task as task_name,
        coalesce(sum(cost_usd), 0) as cost_usd,
        -- The task's whole bill, across every model it reached. A window over
        -- the grouped rows, so it sorts the task block without collapsing it.
        sum(coalesce(sum(cost_usd), 0)) over (partition by task) as task_usd
      from calls
      group by task, tier, model_id_resolved
      order by task_usd desc, task_name, cost_usd desc
      limit 200
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
      order by cost_usd desc
      limit 200
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
