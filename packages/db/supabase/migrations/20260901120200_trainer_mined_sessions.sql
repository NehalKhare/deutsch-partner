-- One row per mined trainer session: the post-session miner claims its key
-- here before writing anything, so a duplicated completion turn (a retry, a
-- resent message) mines nothing twice. The key is derived client-blind on the
-- server from the session's covered subjects and the day; the row holds no
-- content at all.
create table public.trainer_mined_sessions (
  learner_id  uuid not null references public.profiles (id) on delete cascade,
  session_key text not null check (char_length(session_key) between 1 and 64),
  mined_at    timestamptz not null default now(),
  primary key (learner_id, session_key)
);

alter table public.trainer_mined_sessions enable row level security;

create policy trainer_mined_sessions_select on public.trainer_mined_sessions
  for select to authenticated
  using ((select auth.uid()) = learner_id);
create policy trainer_mined_sessions_insert on public.trainer_mined_sessions
  for insert to authenticated
  with check ((select auth.uid()) = learner_id);

revoke all on public.trainer_mined_sessions from anon, authenticated;
grant select, insert on public.trainer_mined_sessions to authenticated;
