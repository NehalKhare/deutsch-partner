-- The dashboard learns to show what the learner has actually done.
--
-- Two changes to the summary function, both prompted by a dashboard that
-- looked dead on a working account.
--
-- First, the per-level tallies come along. Every mini-level a learner has
-- been evaluated at has a stored score, and the dashboard is where those
-- become legible: a score per level, and a band average that says what "A1"
-- has amounted to so far. The averaging itself happens in application code,
-- where it is a pure function under test — the database hands over rows.
--
-- Second, the recurring-mistake list drops its three-occurrences threshold.
-- A learner with thirty-eight recorded mistakes saw an empty list because no
-- single pattern had recurred three times yet; the five most frequent open
-- mistakes are worth showing at any count, and the count is printed beside
-- each one so nobody mistakes once for a habit.

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
       order by le.occurrence_count desc, le.last_seen_at desc
       limit 5
    ) e
  ),
  levels as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'miniLevel',   lp.mini_level,
          'score',       lp.score,
          'turns',       lp.turns,
          'strongTurns', lp.strong_turns
        )
        order by lp.mini_level
      ) filter (where lp.learner_id is not null),
      '[]'::jsonb
    ) as scores
    from public.level_performances lp, me
    where lp.learner_id = me.learner_id
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
    'levelScores',       lv.scores,
    'recurringMistakes', m.recurring,
    'recentThreads',     t.recent,
    'generatedAt',       p_now
  )
  from state s
  left join level l on true
  left join vocab v on true
  left join mistakes m on true
  left join levels lv on true
  left join threads t on true;
$$;
