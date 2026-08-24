-- Row Level Security.
--
-- Rules applied throughout, per the Supabase security checklist:
--   * auth.uid() is wrapped in a subselect so it evaluates once per statement
--     rather than once per row.
--   * every policy names its role with TO authenticated. Role alone is
--     authentication, not authorization, so each also carries an ownership
--     predicate.
--   * UPDATE policies define both USING and WITH CHECK. Without WITH CHECK a
--     learner could reassign a row to somebody else.
--   * every table has a SELECT policy, because an UPDATE must first read the
--     row it is changing.

-- ---------------------------------------------------------------------------
-- Learner-owned tables
-- ---------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.learner_states      enable row level security;
alter table public.learner_vocabulary  enable row level security;
alter table public.learner_errors      enable row level security;
alter table public.learner_memories    enable row level security;
alter table public.recommendations     enable row level security;
alter table public.assessments         enable row level security;
alter table public.conversation_threads  enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.thread_summaries      enable row level security;

-- profiles is keyed on id rather than learner_id.
create policy profiles_select on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy profiles_delete on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'learner_states', 'learner_vocabulary', 'learner_errors',
    'learner_memories', 'recommendations', 'assessments',
    'conversation_threads', 'conversation_messages', 'thread_summaries'
  ]
  loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using ((select auth.uid()) = learner_id)', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
         with check ((select auth.uid()) = learner_id)', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
         using ((select auth.uid()) = learner_id)
         with check ((select auth.uid()) = learner_id)', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated
         using ((select auth.uid()) = learner_id)', t);

    execute format(
      'revoke all on public.%1$I from anon, authenticated', t);
    execute format(
      'grant select, insert, update, delete on public.%1$I to authenticated', t);
  end loop;
end $$;

revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Knowledge corpus: readable by signed-in learners, written by ingestion only
-- ---------------------------------------------------------------------------

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks    enable row level security;

create policy knowledge_documents_read on public.knowledge_documents
  for select to authenticated using (true);
create policy knowledge_chunks_read on public.knowledge_chunks
  for select to authenticated using (true);

revoke all on public.knowledge_documents, public.knowledge_chunks
  from anon, authenticated;
grant select on public.knowledge_documents, public.knowledge_chunks
  to authenticated;

-- ---------------------------------------------------------------------------
-- Operator tables: deny by default, no policies at all
-- ---------------------------------------------------------------------------

alter table public.model_invocations       enable row level security;
alter table public.fx_rates                enable row level security;
alter table public.model_pricing_snapshots enable row level security;
alter table public.budget_limits           enable row level security;
alter table public.budget_counters         enable row level security;
alter table public.cost_rollup_daily       enable row level security;

revoke all on
  public.model_invocations,
  public.fx_rates,
  public.model_pricing_snapshots,
  public.budget_limits,
  public.budget_counters,
  public.cost_rollup_daily
  from anon, authenticated;

-- Nothing is granted back and no policy is created: these are reachable only
-- by the service role, which bypasses RLS.
