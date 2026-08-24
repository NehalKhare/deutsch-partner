-- Onboarding.
--
-- Writes the profile and the learner's initial state as one statement. Two
-- round trips through PostgREST are not atomic, and a profile without a state
-- row leaves the dashboard querying something that is not there.
--
-- SECURITY INVOKER, deliberately: this runs as the calling learner, so Row
-- Level Security applies to both inserts and the function cannot be used to
-- create somebody else's profile.

create or replace function public.complete_onboarding(
  p_native_language       text,
  p_learning_goal         text,
  p_selected_level        text,
  p_target_topics         text[],
  p_interests             text[],
  p_input_preference      text,
  p_output_preference     text,
  p_correction_preference text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner_id uuid := (select auth.uid());
begin
  -- Fail closed. An unauthenticated caller has no profile to complete.
  if v_learner_id is null then
    raise exception 'onboarding requires an authenticated session'
      using errcode = '42501';
  end if;

  insert into public.profiles (
    id, native_language, learning_goal, selected_level, target_topics,
    interests, input_preference, output_preference, correction_preference,
    onboarded_at
  )
  values (
    v_learner_id, p_native_language, p_learning_goal, p_selected_level,
    coalesce(p_target_topics, '{}'), coalesce(p_interests, '{}'),
    p_input_preference, p_output_preference, p_correction_preference, now()
  )
  on conflict (id) do update set
    native_language       = excluded.native_language,
    learning_goal         = excluded.learning_goal,
    selected_level        = excluded.selected_level,
    target_topics         = excluded.target_topics,
    interests             = excluded.interests,
    input_preference      = excluded.input_preference,
    output_preference     = excluded.output_preference,
    correction_preference = excluded.correction_preference,
    onboarded_at          = coalesce(public.profiles.onboarded_at, now());

  -- Every learner starts at the beginning of the path. The level they picked
  -- is a stated preference, recorded as such; it is not evidence, so it does
  -- not move their effective level or their mini-level.
  --
  -- do nothing on conflict: re-running onboarding must never reset progress.
  insert into public.learner_states (
    learner_id, selected_level, estimated_level,
    effective_cefr, effective_plus, mini_level
  )
  values (v_learner_id, p_selected_level, null, 'A1', false, 1)
  on conflict (learner_id) do update set
    selected_level = excluded.selected_level;
end;
$$;

revoke all on function public.complete_onboarding(
  text, text, text, text[], text[], text, text, text
) from public, anon;

grant execute on function public.complete_onboarding(
  text, text, text, text[], text[], text, text, text
) to authenticated;
