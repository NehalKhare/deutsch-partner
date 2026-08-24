-- Server-side aggregation for the two dashboards.
--
-- The build spec is explicit that the learner dashboard must not compute its
-- numbers in React. Six round trips and a reduce in a component is six chances
-- to be inconsistent with itself and one render pass that cannot be cached; one
-- function returning one object is a single consistent read.
--
-- Both functions are SECURITY INVOKER. The learner one therefore sees exactly
-- what Row Level Security lets the caller see, which is why it takes no learner
-- id: there is nobody else's summary it could return.

-- ---------------------------------------------------------------------------
-- The learner's own summary.
-- ---------------------------------------------------------------------------

create or replace function public.learner_dashboard(
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as learner_id
  ),
  state as (
    select ls.*
      from public.learner_states ls, me
     where ls.learner_id = me.learner_id
  ),
  level as (
    select ml.*
      from public.mini_levels ml, state s
     where ml.mini_level = s.mini_level
  ),
  vocab as (
    select
      count(*)                                                as total,
      count(*) filter (where lv.status = 'mastered')          as mastered,
      count(*) filter (where lv.status = 'learning')          as learning,
      count(*) filter (where lv.next_review_at <= p_now
                         and lv.status <> 'mastered')         as due,
      count(*) filter (where lv.exposure_count >= 3
                         and lv.mastery_score < 0.5)          as weak
    from public.learner_vocabulary lv, me
    where lv.learner_id = me.learner_id
  ),
  mistakes as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'errorType', e.error_type,
          'pattern', e.pattern,
          'occurrences', e.occurrence_count
        )
        order by e.occurrence_count desc, e.last_seen_at desc
      ) filter (where e.id is not null),
      '[]'::jsonb
    ) as recurring
    from (
      select le.*
        from public.learner_errors le, me
       where le.learner_id = me.learner_id
         and not le.resolved
         and le.occurrence_count >= 3
       order by le.occurrence_count desc, le.last_seen_at desc
       limit 5
    ) e
  ),
  threads as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'topic', t.topic,
          'updatedAt', t.updated_at
        )
        order by t.updated_at desc
      ) filter (where t.id is not null),
      '[]'::jsonb
    ) as recent
    from (
      select ct.*
        from public.conversation_threads ct, me
       where ct.learner_id = me.learner_id
       order by ct.updated_at desc
       limit 5
    ) t
  )
  select jsonb_build_object(
    'level', jsonb_build_object(
      'selected',  s.selected_level,
      'estimated', s.estimated_level,
      'effective', s.effective_cefr,
      'plus',      s.effective_plus,
      'miniLevel', s.mini_level
    ),
    'miniLevel', jsonb_build_object(
      'number', s.mini_level,
      'theme',  l.theme,
      'focus',  l.focus,
      'targetVocabulary', to_jsonb(l.target_vocabulary),
      'conversationFunctions', to_jsonb(l.conversation_functions)
    ),
    'skills', jsonb_build_object(
      'fluency',       s.fluency,
      'comprehension', s.comprehension,
      'confidence',    s.confidence
    ),
    'vocabulary', jsonb_build_object(
      'total',    v.total,
      'mastered', v.mastered,
      'learning', v.learning,
      'due',      v.due,
      'weak',     v.weak
    ),
    'recurringMistakes', m.recurring,
    'recentThreads',     t.recent,
    'generatedAt',       p_now
  )
  from state s
  left join level l on true
  left join vocab v on true
  left join mistakes m on true
  left join threads t on true;
$$;

revoke all on function public.learner_dashboard(timestamptz) from public, anon;
grant execute on function public.learner_dashboard(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- The operator's spend summary.
-- ---------------------------------------------------------------------------
--
-- Reported in euro, derived from the rates stored on each row rather than
-- recomputed, and carrying no conversation content and no identifying field —
-- the ledger holds a pseudonym and nothing else, so there is nothing here to
-- leak even to somebody who reaches it.
--
-- Not granted to authenticated. The cost dashboard runs on the secret key
-- behind a server-side operator check, and a learner who guesses the route
-- gets a denial from the database as well as from the route.

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
      coalesce(sum(input_tokens), 0)                    as input_tokens,
      coalesce(sum(output_tokens), 0)                   as output_tokens,
      count(*) filter (where status <> 'ok')            as failures,
      count(*) filter (where status = 'budget_denied')  as budget_denials,
      count(*) filter (where truncated)                 as truncations,
      count(*) filter (where degraded)                  as degraded,
      count(*) filter (where fx_stale)                  as unpriced
    from calls
  ),
  by_task as (
    select coalesce(jsonb_agg(row order by cost_eur desc), '[]'::jsonb) as rows
    from (
      select
        jsonb_build_object(
          'task', task,
          'tier', tier,
          'calls', count(*),
          'costEur', coalesce(sum(cost_eur), 0),
          'inputTokens', coalesce(sum(input_tokens), 0),
          'outputTokens', coalesce(sum(output_tokens), 0)
        ) as row,
        coalesce(sum(cost_eur), 0) as cost_eur
      from calls
      group by task, tier
    ) grouped
  ),
  by_model as (
    select coalesce(jsonb_agg(row order by cost_eur desc), '[]'::jsonb) as rows
    from (
      select
        jsonb_build_object(
          'modelId', model_id_resolved,
          'calls', count(*),
          'costEur', coalesce(sum(cost_eur), 0)
        ) as row,
        coalesce(sum(cost_eur), 0) as cost_eur
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
