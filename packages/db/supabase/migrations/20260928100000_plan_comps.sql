-- Operator comps: grant source 3 of billing-and-plans-spec.md S5, now built.
--
-- A comp is a plan given rather than sold — the team's own accounts, a
-- make-good — so it carries no Stripe ids and no amount. Like every other
-- grant it is a row the learner can read and never write: a learner who could
-- insert one could give themselves Premium. It is written only through the
-- secret key. A revocation ends it; nothing deletes, because the row is also
-- the record that the plan was given, by whom it was decided and why.

create table public.plan_comps (
  id         uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  plan_code  text not null check (plan_code in ('plus', 'premium')),
  starts_at  timestamptz not null default now(),
  -- Null grants until revoked: a comp, unlike a pass, may be open-ended.
  ends_at    timestamptz,
  -- A code, never a sentence, for the same reason billing_events.error_code
  -- is one: free text invites names and emails into a billing table.
  reason     text not null check (reason ~ '^[a-z0-9_]{1,60}$'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plan_comps_window check (ends_at is null or ends_at > starts_at)
);

create index plan_comps_learner_idx on public.plan_comps (learner_id);

alter table public.plan_comps enable row level security;

-- One policy, and it reads (spec S5): the learner sees what they were given,
-- and no privilege exists for them to write it.
create policy plan_comps_select on public.plan_comps
  for select to authenticated using ((select auth.uid()) = learner_id);

revoke all on public.plan_comps from anon, authenticated;
grant select on public.plan_comps to authenticated;

-- ---------------------------------------------------------------------------
-- The export (guardrails S16), now with comps
-- ---------------------------------------------------------------------------

-- As before, plus plan_comps: a comp is the learner's data like any other
-- grant. A test holds the keys here to every foreign key to profiles.
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
    'trainer_mined_sessions', coalesce((select jsonb_agg(to_jsonb(x)) from public.trainer_mined_sessions x where x.learner_id = p_learner_id), '[]'::jsonb),
    'billing_customers', coalesce((select jsonb_agg(to_jsonb(x)) from public.billing_customers x where x.learner_id = p_learner_id), '[]'::jsonb),
    'billing_checkouts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.billing_checkouts x where x.learner_id = p_learner_id), '[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.subscriptions x where x.learner_id = p_learner_id), '[]'::jsonb),
    'plan_passes', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.plan_passes x where x.learner_id = p_learner_id), '[]'::jsonb),
    'plan_comps', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.plan_comps x where x.learner_id = p_learner_id), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.ops_learner_export(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The first comp
-- ---------------------------------------------------------------------------

-- The operator's own learner account rides Premium without a subscription.
-- Guarded on the profile existing, so an environment without that account —
-- local, preview, the test database — applies this migration and seeds
-- nothing. Revoking it is an update of revoked_at through the secret key.
insert into public.plan_comps (learner_id, plan_code, reason)
select p.id, 'premium', 'operator'
from public.profiles p
where p.id = '69dc2186-2a20-48b2-8af7-83f5703f363e';
