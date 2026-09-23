-- Learner support: the operator's view of one learner, and the corrections an
-- operator may make on their behalf.
--
-- The first operator surface over personal data. Every learner table keeps its
-- RLS policies exactly as they were; these functions are reached only with the
-- secret key, which bypasses RLS, from behind the ops app's allowlist, second
-- factor and per-action audit log. Each is revoked from anon and authenticated
-- so a learner's session cannot call one, whatever id it passes.
--
-- Every function takes the learner id and every statement filters on it,
-- including the ones that also take a row id: an error id or a memory id alone
-- must never be enough to touch a row, or a stale form could edit the wrong
-- learner.
--
-- Account deletion is not here. It goes through the Auth admin API, which
-- removes the auth user; every learner table cascades from it. The usage
-- ledger keeps its pseudonymous rows, by design (cost-dashboard-spec.md S3).

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- A page of learners, newest first, keyset by (created_at, id).
--
-- Returns up to p_limit + 1 rows so the caller can tell whether there is a
-- next page without a second count. Last activity is the newest of a thread
-- update and a level tally, which is what the schema records of a session —
-- the words themselves are never stored.
create or replace function public.ops_learner_list(
  p_limit          integer     default 50,
  p_before_created timestamptz default null,
  p_before_id      uuid        default null,
  p_cefr           text        default null,
  p_onboarded      boolean     default null,
  p_inactive_days  integer     default null,
  p_now            timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with learners as (
    select
      p.id,
      p.created_at,
      p.onboarded_at,
      p.selected_level,
      p.mastery_threshold,
      p.trainer_personality,
      ls.effective_cefr,
      ls.effective_plus,
      ls.mini_level,
      ls.furthest_mini_level,
      coalesce(cardinality(ls.skipped_mini_levels), 0) as skipped_count,
      greatest(
        (select max(t.updated_at) from public.conversation_threads t where t.learner_id = p.id),
        (select max(lp.updated_at) from public.level_performances lp where lp.learner_id = p.id)
      ) as last_active_at,
      (select count(*) from public.learner_errors e
        where e.learner_id = p.id and not e.resolved) as open_errors
    from public.profiles p
    left join public.learner_states ls on ls.learner_id = p.id
  ),
  filtered as (
    select *
      from learners l
     where (p_cefr is null or l.effective_cefr = p_cefr)
       and (p_onboarded is null or (l.onboarded_at is not null) = p_onboarded)
       and (p_inactive_days is null
            or coalesce(l.last_active_at, l.created_at)
               < p_now - make_interval(days => greatest(p_inactive_days, 0)))
  ),
  page as (
    select *
      from filtered f
     where p_before_created is null
        or (f.created_at, f.id) < (p_before_created, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
     order by f.created_at desc, f.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) + 1
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',                 pg.id,
                 'createdAt',          pg.created_at,
                 'onboardedAt',        pg.onboarded_at,
                 'selectedLevel',      pg.selected_level,
                 'effectiveCefr',      pg.effective_cefr,
                 'effectivePlus',      pg.effective_plus,
                 'miniLevel',          pg.mini_level,
                 'furthestMiniLevel',  pg.furthest_mini_level,
                 'skippedCount',       pg.skipped_count,
                 'masteryThreshold',   pg.mastery_threshold,
                 'trainerPersonality', pg.trainer_personality,
                 'lastActiveAt',       pg.last_active_at,
                 'openErrors',         pg.open_errors
               )
               order by pg.created_at desc, pg.id desc
             )
        from page pg
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
               'learners',  count(*),
               'onboarded', count(*) filter (where p.onboarded_at is not null))
        from public.profiles p
    )
  );
$$;

revoke all on function public.ops_learner_list(integer, timestamptz, uuid, text, boolean, integer, timestamptz)
  from public, anon, authenticated;

-- Everything the product stores about one learner, for support. Null when the
-- account has no profile (signed up, never onboarded).
--
-- Rows come out as to_jsonb of the table, snake_case, so the application
-- parses them with the same row mappers the learner's own reads use.
create or replace function public.ops_learner_detail(p_learner_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p.id is null then null else jsonb_build_object(
    'profile', to_jsonb(p),
    'state', (select to_jsonb(ls) from public.learner_states ls where ls.learner_id = p.id),
    'levels', coalesce((
      select jsonb_agg(to_jsonb(lp) order by lp.mini_level)
        from public.level_performances lp where lp.learner_id = p.id
    ), '[]'::jsonb),
    'vocabulary', jsonb_build_object(
      'byStatus', coalesce((
        select jsonb_object_agg(s.status, s.n)
          from (select lv.status, count(*) as n
                  from public.learner_vocabulary lv
                 where lv.learner_id = p.id
                 group by lv.status) s
      ), '{}'::jsonb),
      'due', (
        select count(*) from public.learner_vocabulary lv
         where lv.learner_id = p.id and lv.status <> 'mastered' and lv.next_review_at <= now()
      ),
      -- The weakest hundred, which is what support is asked about.
      'rows', coalesce((
        select jsonb_agg(w.row order by w.mastery_score, w.last_seen_at desc nulls last)
          from (
            select
              lv.mastery_score,
              lv.last_seen_at,
              jsonb_build_object(
                'vocabularyItemId', lv.vocabulary_item_id,
                'lemma',            vi.lemma,
                'word',             vi.word,
                'englishTranslation', vi.english_translation,
                'miniLevel',        vi.mini_level,
                'status',           lv.status,
                'masteryScore',     lv.mastery_score,
                'exposureCount',    lv.exposure_count,
                'correctCount',     lv.correct_count,
                'incorrectCount',   lv.incorrect_count,
                'lastSeenAt',       lv.last_seen_at,
                'nextReviewAt',     lv.next_review_at
              ) as row
            from public.learner_vocabulary lv
            join public.vocabulary_items vi on vi.id = lv.vocabulary_item_id
            where lv.learner_id = p.id
            order by lv.mastery_score, lv.last_seen_at desc nulls last
            limit 100
          ) w
      ), '[]'::jsonb)
    ),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.resolved, e.occurrence_count desc, e.last_seen_at desc)
        from (select * from public.learner_errors le
               where le.learner_id = p.id
               order by le.resolved, le.occurrence_count desc, le.last_seen_at desc
               limit 200) e
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.salience desc, m.created_at desc)
        from (select * from public.learner_memories lm
               where lm.learner_id = p.id
               order by lm.salience desc, lm.created_at desc
               limit 500) m
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from (select * from public.assessments x
               where x.learner_id = p.id order by x.created_at desc limit 50) a
    ), '[]'::jsonb),
    'recommendations', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
        from (select * from public.recommendations x
               where x.learner_id = p.id order by x.created_at desc limit 50) r
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.updated_at desc)
        from (select * from public.conversation_threads x
               where x.learner_id = p.id order by x.updated_at desc limit 50) t
    ), '[]'::jsonb),
    'coaching', (select to_jsonb(c) from public.trainer_coaching_profiles c where c.learner_id = p.id),
    'feedback', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at desc)
        from (select * from public.trainer_feedback x
               where x.learner_id = p.id order by x.created_at desc limit 50) f
    ), '[]'::jsonb),
    'minedSessions', (select count(*) from public.trainer_mined_sessions s where s.learner_id = p.id)
  ) end
  from (select 1) one
  left join public.profiles p on p.id = p_learner_id;
$$;

revoke all on function public.ops_learner_detail(uuid) from public, anon, authenticated;

-- Every row of every learner-owned table, unabridged: the answer to a data
-- access request (guardrails S16). A test checks the keys here against every
-- foreign key to profiles, so a new learner table cannot be left out quietly.
create or replace function public.ops_learner_export(p_learner_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when not exists (select 1 from public.profiles p where p.id = p_learner_id) then null
  else jsonb_build_object(
    'exportedAt', now(),
    'profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.profiles x where x.id = p_learner_id), '[]'::jsonb),
    'learner_states', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_states x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_vocabulary', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_vocabulary x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_errors', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_errors x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_memories', coalesce((select jsonb_agg(to_jsonb(x)) from public.learner_memories x where x.learner_id = p_learner_id), '[]'::jsonb),
    'recommendations', coalesce((select jsonb_agg(to_jsonb(x)) from public.recommendations x where x.learner_id = p_learner_id), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(to_jsonb(x)) from public.assessments x where x.learner_id = p_learner_id), '[]'::jsonb),
    'conversation_threads', coalesce((select jsonb_agg(to_jsonb(x)) from public.conversation_threads x where x.learner_id = p_learner_id), '[]'::jsonb),
    'level_performances', coalesce((select jsonb_agg(to_jsonb(x)) from public.level_performances x where x.learner_id = p_learner_id), '[]'::jsonb),
    'trainer_coaching_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_coaching_profiles x where x.learner_id = p_learner_id), '[]'::jsonb),
    'trainer_feedback', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_feedback x where x.learner_id = p_learner_id), '[]'::jsonb),
    'trainer_mined_sessions', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_mined_sessions x where x.learner_id = p_learner_id), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.ops_learner_export(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Correcting
--
-- Each returns the row as it was and as it is, for the audit event, or null
-- when there was nothing for that learner to change.
-- ---------------------------------------------------------------------------

-- Places a learner at a mini-level, by the same rule a learner's own move
-- follows (packages/learning/src/progression.ts, placedAt): the level is the
-- mini-level's band, the estimate is cleared because it was evidence about
-- somewhere they no longer are, the plus modifier drops, nothing is marked
-- skipped, and the furthest level rises by trigger.
create or replace function public.ops_set_learner_mini_level(
  p_learner_id uuid,
  p_mini_level integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.learner_states;
  v_after  public.learner_states;
  v_cefr   text := public.cefr_for_mini_level(p_mini_level);
begin
  if v_cefr is null then
    raise exception 'mini-level % is not on the path', p_mini_level using errcode = '22023';
  end if;

  select * into v_before from public.learner_states where learner_id = p_learner_id for update;
  if not found then return null; end if;

  update public.learner_states
     set mini_level      = p_mini_level,
         selected_level  = v_cefr,
         estimated_level = null,
         effective_cefr  = v_cefr,
         effective_plus  = false
   where learner_id = p_learner_id
  returning * into v_after;

  return jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after));
end;
$$;

revoke all on function public.ops_set_learner_mini_level(uuid, integer) from public, anon, authenticated;

create or replace function public.ops_clear_skipped_levels(p_learner_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.learner_states;
  v_after  public.learner_states;
begin
  select * into v_before from public.learner_states where learner_id = p_learner_id for update;
  if not found then return null; end if;

  update public.learner_states
     set skipped_mini_levels = '{}'
   where learner_id = p_learner_id
  returning * into v_after;

  return jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after));
end;
$$;

revoke all on function public.ops_clear_skipped_levels(uuid) from public, anon, authenticated;

-- Forgets one level's tally, so the learner earns it again from their next turn.
create or replace function public.ops_reset_level_performance(
  p_learner_id uuid,
  p_mini_level integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with removed as (
    delete from public.level_performances lp
     where lp.learner_id = p_learner_id
       and lp.mini_level = p_mini_level
    returning lp.*
  )
  select to_jsonb(removed) from removed;
$$;

revoke all on function public.ops_reset_level_performance(uuid, integer) from public, anon, authenticated;

create or replace function public.ops_set_learner_error_resolved(
  p_learner_id uuid,
  p_error_id   uuid,
  p_resolved   boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.learner_errors;
  v_after  public.learner_errors;
begin
  select * into v_before
    from public.learner_errors
   where id = p_error_id and learner_id = p_learner_id
     for update;
  if not found then return null; end if;

  update public.learner_errors
     set resolved = coalesce(p_resolved, false)
   where id = p_error_id and learner_id = p_learner_id
  returning * into v_after;

  return jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after));
end;
$$;

revoke all on function public.ops_set_learner_error_resolved(uuid, uuid, boolean) from public, anon, authenticated;

-- One of 33, 50 or 80; the column's own check refuses anything else.
create or replace function public.ops_set_mastery_threshold(
  p_learner_id uuid,
  p_threshold  integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.profiles;
  v_after  public.profiles;
begin
  select * into v_before from public.profiles where id = p_learner_id for update;
  if not found then return null; end if;

  update public.profiles
     set mastery_threshold = p_threshold
   where id = p_learner_id
  returning * into v_after;

  return jsonb_build_object(
    'before', jsonb_build_object('mastery_threshold', v_before.mastery_threshold),
    'after',  jsonb_build_object('mastery_threshold', v_after.mastery_threshold)
  );
end;
$$;

revoke all on function public.ops_set_mastery_threshold(uuid, integer) from public, anon, authenticated;

-- After a correction dispute is settled in the learner's favour, the Trainer
-- should stop hedging with them. Only the count; votes are history.
create or replace function public.ops_reset_disputed_corrections(p_learner_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before integer;
begin
  select disputed_corrections into v_before
    from public.trainer_coaching_profiles
   where learner_id = p_learner_id
     for update;
  if not found then return null; end if;

  update public.trainer_coaching_profiles
     set disputed_corrections = 0
   where learner_id = p_learner_id;

  return jsonb_build_object(
    'before', jsonb_build_object('disputed_corrections', v_before),
    'after',  jsonb_build_object('disputed_corrections', 0)
  );
end;
$$;

revoke all on function public.ops_reset_disputed_corrections(uuid) from public, anon, authenticated;

create or replace function public.ops_delete_learner_memory(
  p_learner_id uuid,
  p_memory_id  uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with removed as (
    delete from public.learner_memories m
     where m.id = p_memory_id
       and m.learner_id = p_learner_id
    returning m.*
  )
  select to_jsonb(removed) from removed;
$$;

revoke all on function public.ops_delete_learner_memory(uuid, uuid) from public, anon, authenticated;
