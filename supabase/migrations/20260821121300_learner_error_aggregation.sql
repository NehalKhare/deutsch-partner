-- Recurring error aggregation.
--
-- One learner making the same mistake forty times is one thing to work on,
-- not forty. Counting that has to be atomic: two turns in the same session can
-- report the same pattern at once, and a read-then-write through PostgREST
-- would have both read the same count and both write it back plus one.
--
-- SECURITY INVOKER throughout, and no learner id parameter: the owner comes
-- from the verified session, so this cannot be aimed at somebody else's row.

-- Newest first, deduplicated, capped. Keeping the oldest examples would freeze
-- the evidence at whatever the learner happened to do first, which is the
-- least useful thing to show them. The limit mirrors the cardinality check on
-- learner_errors.example_utterances.
create or replace function public.merge_error_examples(
  p_existing text[],
  p_new text,
  p_limit integer
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(u order by ord), '{}'::text[])
  from (
    select u, min(ord) as ord
    from unnest(
      case
        when p_new is null or btrim(p_new) = ''
          then coalesce(p_existing, '{}'::text[])
        else array[p_new] || coalesce(p_existing, '{}'::text[])
      end
    ) with ordinality as candidates (u, ord)
    where btrim(u) <> ''
    group by u
    order by min(ord)
    limit p_limit
  ) kept;
$$;

create or replace function public.record_learner_error(
  p_error_type text,
  p_pattern text,
  p_utterance text default null,
  p_observed_at timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner_id uuid := (select auth.uid());
  -- The same normalisation the application applies, enforced at the boundary
  -- that matters. A pattern is written by a model, so spacing, casing and
  -- trailing punctuation vary between turns; without this every turn would
  -- open a new row and nothing would reach a count worth acting on.
  v_pattern text := lower(btrim(regexp_replace(
    btrim(regexp_replace(coalesce(p_pattern, ''), '\s+', ' ', 'g')),
    '[.!?]+$', '')));
  v_at timestamptz := coalesce(p_observed_at, now());
  v_id uuid;
begin
  -- Fail closed. An unauthenticated caller has no history to add to.
  if v_learner_id is null then
    raise exception 'recording a learner error requires an authenticated session'
      using errcode = '42501';
  end if;

  if v_pattern = '' then
    raise exception 'a learner error needs a pattern to aggregate on'
      using errcode = '22023';
  end if;

  insert into public.learner_errors (
    learner_id, error_type, pattern, occurrence_count,
    first_seen_at, last_seen_at, resolved, example_utterances
  )
  values (
    v_learner_id, p_error_type, v_pattern, 1, v_at, v_at, false,
    public.merge_error_examples('{}'::text[], p_utterance, 20)
  )
  on conflict (learner_id, error_type, pattern) do update set
    occurrence_count = public.learner_errors.occurrence_count + 1,
    -- Widened in both directions: an observation carrying an earlier stamp is
    -- clock skew, and a row whose last_seen_at precedes its first_seen_at is
    -- one the check constraint refuses.
    first_seen_at = least(public.learner_errors.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.learner_errors.last_seen_at, excluded.last_seen_at),
    -- It came back, so it was not corrected after all.
    resolved = false,
    example_utterances = public.merge_error_examples(
      public.learner_errors.example_utterances, p_utterance, 20)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.merge_error_examples(text[], text, integer)
  from public, anon;
grant execute on function public.merge_error_examples(text[], text, integer)
  to authenticated;

revoke all on function public.record_learner_error(text, text, text, timestamptz)
  from public, anon;
grant execute on function public.record_learner_error(text, text, text, timestamptz)
  to authenticated;
