-- The Trainer learns from feedback.
--
-- Two tables, both the learner's own. trainer_coaching_profiles is the current
-- position of every dial the learner's feedback has moved: how much a
-- correction explains, how hard an exercise stretches, how long a sitting
-- runs, what the agenda leans towards, and whether it ends on the news. Each
-- is a closed set the CHECK holds, and the rules that move them live in
-- application code (lib/trainer/coaching.ts) — the learner judges, the
-- arithmetic decides, and no model gets a vote.
--
-- trainer_feedback is the record those dials were derived from: one row per
-- vote, with its reasons from a closed set, the tool receipt of the reply it
-- was about, and an optional note in the learner's words. It holds no line of
-- any reply. Transcripts are ephemeral by design (20260822110000), and a
-- feedback table that quoted them would be the transcript table by another
-- name. The note is bounded and passes the same secret filter as a memory.

create table public.trainer_coaching_profiles (
  learner_id           uuid primary key references public.profiles (id) on delete cascade,
  explanation_depth    text not null default 'standard'
                         check (explanation_depth in ('brief', 'standard', 'detailed')),
  challenge            text not null default 'standard'
                         check (challenge in ('gentler', 'standard', 'harder')),
  session_length       text not null default 'standard'
                         check (session_length in ('short', 'standard')),
  focus                text not null default 'balanced'
                         check (focus in ('balanced', 'vocabulary', 'grammar')),
  news_enabled         boolean not null default true,
  -- Corrections the learner disputed, less the helpful votes since. Bounded
  -- so a held-down button cannot make it unbounded.
  disputed_corrections integer not null default 0
                         check (disputed_corrections between 0 and 99),
  helpful_count        integer not null default 0 check (helpful_count >= 0),
  unhelpful_count      integer not null default 0 check (unhelpful_count >= 0),
  updated_at           timestamptz not null default now()
);

create trigger trainer_coaching_profiles_touch
  before update on public.trainer_coaching_profiles
  for each row execute function public.touch_updated_at();

alter table public.trainer_coaching_profiles enable row level security;

create policy trainer_coaching_profiles_select on public.trainer_coaching_profiles
  for select to authenticated using ((select auth.uid()) = learner_id);
create policy trainer_coaching_profiles_insert on public.trainer_coaching_profiles
  for insert to authenticated with check ((select auth.uid()) = learner_id);
create policy trainer_coaching_profiles_update on public.trainer_coaching_profiles
  for update to authenticated
  using ((select auth.uid()) = learner_id)
  with check ((select auth.uid()) = learner_id);
create policy trainer_coaching_profiles_delete on public.trainer_coaching_profiles
  for delete to authenticated using ((select auth.uid()) = learner_id);

revoke all on public.trainer_coaching_profiles from anon, authenticated;
grant select, insert, update, delete on public.trainer_coaching_profiles to authenticated;

create table public.trainer_feedback (
  id             uuid primary key default gen_random_uuid(),
  learner_id     uuid not null references public.profiles (id) on delete cascade,
  verdict        text not null check (verdict in ('helpful', 'unhelpful')),
  -- A closed set, held by the database as well as by the domain schema.
  reasons        text[] not null default '{}'
                   check (cardinality(reasons) <= 7
                     and reasons <@ array['too_long', 'too_short', 'too_hard',
                                          'too_easy', 'unclear',
                                          'wrong_correction', 'skip_news']::text[]),
  note           text check (note is null or char_length(note) between 1 and 240),
  -- The reply's receipt: which tools it used, never what it said.
  tools          text[] not null default '{}' check (cardinality(tools) <= 8),
  prompt_version integer not null check (prompt_version > 0),
  created_at     timestamptz not null default now()
);

-- The trainer reads the newest few notes at the top of every turn.
create index trainer_feedback_recent_idx
  on public.trainer_feedback (learner_id, created_at desc);

alter table public.trainer_feedback enable row level security;

-- No update: a vote is a record. Delete is the learner's reset.
create policy trainer_feedback_select on public.trainer_feedback
  for select to authenticated using ((select auth.uid()) = learner_id);
create policy trainer_feedback_insert on public.trainer_feedback
  for insert to authenticated with check ((select auth.uid()) = learner_id);
create policy trainer_feedback_delete on public.trainer_feedback
  for delete to authenticated using ((select auth.uid()) = learner_id);

revoke all on public.trainer_feedback from anon, authenticated;
grant select, insert, delete on public.trainer_feedback to authenticated;
