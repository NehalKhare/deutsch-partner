-- Conversations become ephemeral; performance becomes the record.
--
-- What a learner says in a practice session now lives only in their browser's
-- memory and dies with the tab. The tables that held transcripts are dropped
-- outright rather than merely left unwritten: a table that still exists is a
-- table something can quietly start writing to again, and the rows already in
-- it are exactly the data this change exists to stop keeping.
--
-- Threads survive. A thread is a place to practise — a title, a topic and the
-- level it was opened at — and a learner can walk back into one and start
-- fresh. What the product remembers long-term is not what was said but how it
-- went: a per-level tally of evaluated turns and how many were error-free,
-- which is what level advancement is gated on.

drop function public.append_conversation_message(
  uuid, text, text, text, text, text, integer, jsonb
);

-- Their policies, triggers and indexes go with them.
drop table public.conversation_messages;
drop table public.thread_summaries;

-- ---------------------------------------------------------------------------
-- The per-level performance tally
-- ---------------------------------------------------------------------------

-- A CHECK rather than a foreign key to mini_levels, for the same reason
-- learner_states.furthest_mini_level uses one: the referenced table is a fixed
-- list of seventy rows, and every foreign key in this schema must carry an
-- index that this column — only ever read as part of its own primary key —
-- would never use.
create table public.level_performances (
  learner_id   uuid not null references public.profiles (id) on delete cascade,
  mini_level   integer not null check (mini_level between 1 and 70),
  turns        integer not null default 0 check (turns >= 0),
  strong_turns integer not null default 0,
  -- Stored by the database so a row can never disagree with its own tally.
  -- greatest() keeps the expression total; a zero-turn row scores zero.
  score        numeric(4,3) not null generated always as
                 (round(strong_turns::numeric / greatest(turns, 1), 3)) stored,
  updated_at   timestamptz not null default now(),
  primary key (learner_id, mini_level),
  constraint level_performances_strong_within_turns
    check (strong_turns between 0 and turns)
);

create trigger level_performances_touch before update on public.level_performances
  for each row execute function public.touch_updated_at();

alter table public.level_performances enable row level security;

create policy level_performances_select on public.level_performances
  for select to authenticated using ((select auth.uid()) = learner_id);
create policy level_performances_insert on public.level_performances
  for insert to authenticated with check ((select auth.uid()) = learner_id);
create policy level_performances_update on public.level_performances
  for update to authenticated
  using ((select auth.uid()) = learner_id)
  with check ((select auth.uid()) = learner_id);
create policy level_performances_delete on public.level_performances
  for delete to authenticated using ((select auth.uid()) = learner_id);

revoke all on public.level_performances from anon, authenticated;
grant select, insert, update, delete on public.level_performances to authenticated;

-- ---------------------------------------------------------------------------
-- Recording one evaluated turn
-- ---------------------------------------------------------------------------

-- A database function for the same two reasons the thread functions were.
-- It takes no learner id — the owner comes from the verified session — and it
-- must not half-happen: two turns finishing at once must count as two, which
-- a read-modify-write in application code cannot promise and a single upsert
-- can.
create or replace function public.record_level_turn(
  p_mini_level integer,
  p_strong     boolean
)
returns public.level_performances
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner_id uuid := (select auth.uid());
  v_row public.level_performances;
begin
  if v_learner_id is null then
    raise exception 'recording a turn requires an authenticated session'
      using errcode = '42501';
  end if;

  insert into public.level_performances as lp
    (learner_id, mini_level, turns, strong_turns)
  values
    (v_learner_id, p_mini_level, 1, case when p_strong then 1 else 0 end)
  on conflict (learner_id, mini_level) do update
     set turns        = lp.turns + 1,
         strong_turns = lp.strong_turns + (case when p_strong then 1 else 0 end)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_level_turn(integer, boolean)
  from public, anon;
grant execute on function public.record_level_turn(integer, boolean)
  to authenticated;

comment on table public.level_performances is
  'Per-mini-level tally of evaluated turns. The long-term record of a conversation; the words themselves are never stored.';
