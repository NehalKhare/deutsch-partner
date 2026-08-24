-- Starting a thread and appending to it.
--
-- Both are database functions for the same two reasons. First, neither takes a
-- learner id: the owner comes from the verified session, so a call cannot be
-- aimed at somebody else's conversation. Second, each does something that must
-- not half-happen — a thread has to carry the level its learner is actually at,
-- and an appended message has to move its thread to the top of the list.

create or replace function public.start_conversation_thread(
  p_title text,
  p_topic text,
  p_mode  text
)
returns public.conversation_threads
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner_id uuid := (select auth.uid());
  v_cefr text;
  v_mini_level integer;
  v_thread public.conversation_threads;
begin
  if v_learner_id is null then
    raise exception 'starting a conversation requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The level is read, never accepted from the caller. A learner cannot open a
  -- B1 conversation by asking for one; they get the level their record says
  -- they are at, which is the only level the tutor should pitch to.
  select ls.effective_cefr, ls.mini_level
    into v_cefr, v_mini_level
    from public.learner_states ls
   where ls.learner_id = v_learner_id;

  if v_cefr is null then
    raise exception 'a learner must finish onboarding before starting a conversation'
      using errcode = '23503';
  end if;

  insert into public.conversation_threads
    (learner_id, title, topic, cefr, mini_level, mode)
  values (v_learner_id, p_title, p_topic, v_cefr, v_mini_level, p_mode)
  returning * into v_thread;

  return v_thread;
end;
$$;

create or replace function public.append_conversation_message(
  p_thread_id         uuid,
  p_role              text,
  p_content           text,
  p_language          text,
  p_input_mode        text,
  p_transcript        text default null,
  p_audio_duration_ms integer default null,
  p_correction        jsonb default null
)
returns public.conversation_messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner_id uuid := (select auth.uid());
  v_message public.conversation_messages;
begin
  if v_learner_id is null then
    raise exception 'appending a message requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The composite foreign key on (thread_id, learner_id) rejects this if the
  -- thread is not the caller's, so ownership is enforced by the schema rather
  -- than by a check that could be forgotten.
  insert into public.conversation_messages
    (thread_id, learner_id, role, content, language, input_mode,
     transcript, audio_duration_ms, correction)
  values
    (p_thread_id, v_learner_id, p_role, p_content, p_language, p_input_mode,
     p_transcript, p_audio_duration_ms, p_correction)
  returning * into v_message;

  -- The thread list is ordered by updated_at, so a thread that has just been
  -- spoken in belongs at the top. Doing it here rather than in a second round
  -- trip means the message and the ordering cannot disagree.
  update public.conversation_threads
     set updated_at = now()
   where id = p_thread_id;

  return v_message;
end;
$$;

revoke all on function public.start_conversation_thread(text, text, text)
  from public, anon;
grant execute on function public.start_conversation_thread(text, text, text)
  to authenticated;

revoke all on function public.append_conversation_message(
  uuid, text, text, text, text, text, integer, jsonb
) from public, anon;
grant execute on function public.append_conversation_message(
  uuid, text, text, text, text, text, integer, jsonb
) to authenticated;
