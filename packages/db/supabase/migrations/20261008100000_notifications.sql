-- In-app notifications, for learners and for operators.
--
-- Two tables, because the two audiences are two trust boundaries. A learner
-- may read their own notifications and mark them read, and nothing else: the
-- rows are written about them, by the server, through the secret key — a
-- learner who could insert one could tell themselves they bought a plan. An
-- operator's notifications are operator scope like the queue: RLS on, no
-- policy, every privilege revoked, reachable by the secret key alone from
-- behind the ops app's allowlist and second factor. One inbox for every
-- operator, read once for all: an alert is acknowledged, not collected.
--
-- The kinds and severities are closed sets held by CHECK, the same sets the
-- domain declares, so a screen can draw each kind and nothing invents one. A
-- link is a same-origin path or nothing. The text is bounded, and holds no
-- learner's words and no learner's id: the composers in the domain take a
-- level, a plan code, a stage, a reference, and write the sentence.
--
-- Marking read derives the owner from the session (mark_learner_notifications_read
-- takes no learner id), and the learner's UPDATE privilege is on read_at
-- alone, so a session cannot rewrite what it was told.

-- ---------------------------------------------------------------------------
-- Learners
-- ---------------------------------------------------------------------------

create table public.learner_notifications (
  id          uuid primary key default gen_random_uuid(),
  learner_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in (
                'level.advanced',
                'billing.subscription_started', 'billing.subscription_ended',
                'billing.payment_failed', 'billing.pass_granted', 'billing.pass_revoked',
                'account.withdrawal_received')),
  severity    text not null check (severity in ('info', 'success', 'warning', 'critical')),
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 500),
  href        text check (href is null or (href ~ '^/' and href !~ '^//' and href !~ '\s')),
  -- The same event twice is one row. Null when every occurrence is its own.
  dedupe_key  text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create unique index learner_notifications_dedupe_idx
  on public.learner_notifications (learner_id, dedupe_key)
  where dedupe_key is not null;

-- What the menu reads: a learner's newest few.
create index learner_notifications_recent_idx
  on public.learner_notifications (learner_id, created_at desc);

-- What the badge counts.
create index learner_notifications_unread_idx
  on public.learner_notifications (learner_id)
  where read_at is null;

alter table public.learner_notifications enable row level security;

create policy learner_notifications_select on public.learner_notifications
  for select to authenticated using ((select auth.uid()) = learner_id);
-- Both halves: WITH CHECK is what stops a learner reassigning a row.
create policy learner_notifications_update on public.learner_notifications
  for update to authenticated
  using ((select auth.uid()) = learner_id)
  with check ((select auth.uid()) = learner_id);

revoke all on public.learner_notifications from anon, authenticated;
grant select on public.learner_notifications to authenticated;
-- Column-level: the one thing a learner may change about a notification.
grant update (read_at) on public.learner_notifications to authenticated;

-- Written by the server about a learner. Secret key only; a learner's
-- session cannot call it whatever id it passes. Returns the row that now
-- represents the event: the new one, or — under a dedupe key — the one
-- already there, with created = false.
create or replace function public.record_learner_notification(
  p_learner_id uuid,
  p_kind text,
  p_severity text,
  p_title text,
  p_body text,
  p_href text default null,
  p_dedupe_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.learner_notifications
    (learner_id, kind, severity, title, body, href, dedupe_key)
  values
    (p_learner_id, p_kind, p_severity, p_title, p_body, p_href, p_dedupe_key)
  on conflict (learner_id, dedupe_key) where dedupe_key is not null
    do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  select n.id into v_id
    from public.learner_notifications n
   where n.learner_id = p_learner_id
     and n.dedupe_key = p_dedupe_key;

  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

revoke all on function public.record_learner_notification(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;

-- The learner's own: the owner is the session, never an argument. Null ids
-- means everything unread. Returns how many rows it marked. RLS applies on
-- top (SECURITY INVOKER), so the predicate here and the policy agree twice.
create or replace function public.mark_learner_notifications_read(
  p_ids uuid[] default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.learner_notifications n
     set read_at = now()
   where n.learner_id = (select auth.uid())
     and n.read_at is null
     and (p_ids is null or n.id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_learner_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_learner_notifications_read(uuid[]) to authenticated;

-- The badge. A count rather than a page, so it is right past the page's limit.
create or replace function public.learner_unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.learner_notifications n
   where n.learner_id = (select auth.uid())
     and n.read_at is null;
$$;

revoke all on function public.learner_unread_notification_count() from public, anon;
grant execute on function public.learner_unread_notification_count() to authenticated;

-- ---------------------------------------------------------------------------
-- Operators
-- ---------------------------------------------------------------------------

create table public.ops_notifications (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in (
                 'productops.review_needed', 'productops.run_failed', 'productops.run_completed',
                 'budget.threshold', 'jobs.dead_lettered', 'billing.event_failed',
                 'contract_notice.received', 'account.deleted')),
  severity     text not null check (severity in ('info', 'success', 'warning', 'critical')),
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null check (char_length(body) between 1 and 500),
  href         text check (href is null or (href ~ '^/' and href !~ '^//' and href !~ '\s')),
  -- What it is about: a run id, a job id, a scope, a reference. Never a
  -- learner id and never content.
  subject      text check (subject is null or char_length(subject) between 1 and 120),
  dedupe_key   text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  created_at   timestamptz not null default now(),
  -- Read once for everyone, by whom: the operator's pseudonym, never an id.
  read_at      timestamptz,
  read_by_hash text check (read_by_hash is null or char_length(read_by_hash) <= 128)
);

create unique index ops_notifications_dedupe_idx
  on public.ops_notifications (dedupe_key)
  where dedupe_key is not null;

create index ops_notifications_recent_idx
  on public.ops_notifications (created_at desc);

create index ops_notifications_unread_idx
  on public.ops_notifications (created_at desc)
  where read_at is null;

alter table public.ops_notifications enable row level security;
revoke all on public.ops_notifications from anon, authenticated;

create or replace function public.record_ops_notification(
  p_kind text,
  p_severity text,
  p_title text,
  p_body text,
  p_href text default null,
  p_subject text default null,
  p_dedupe_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.ops_notifications
    (kind, severity, title, body, href, subject, dedupe_key)
  values
    (p_kind, p_severity, p_title, p_body, p_href, p_subject, p_dedupe_key)
  on conflict (dedupe_key) where dedupe_key is not null
    do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  select n.id into v_id
    from public.ops_notifications n
   where n.dedupe_key = p_dedupe_key;

  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

-- Unread first, newest first, bounded. The one read the menu and the page make.
create or replace function public.ops_notifications_list(
  p_limit integer default 20,
  p_unread_only boolean default false
)
returns setof public.ops_notifications
language sql
stable
security invoker
set search_path = ''
as $$
  select n.*
    from public.ops_notifications n
   where (not p_unread_only or n.read_at is null)
   order by (n.read_at is null) desc, n.created_at desc, n.id desc
   limit greatest(least(coalesce(p_limit, 20), 200), 1);
$$;

create or replace function public.ops_unread_notification_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer from public.ops_notifications n where n.read_at is null;
$$;

-- Null ids means everything unread. Returns how many rows it marked.
create or replace function public.mark_ops_notifications_read(
  p_by_hash text,
  p_ids bigint[] default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ops_notifications n
     set read_at = now(),
         read_by_hash = p_by_hash
   where n.read_at is null
     and (p_ids is null or n.id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_ops_notification(text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.ops_notifications_list(integer, boolean) from public, anon, authenticated;
revoke all on function public.ops_unread_notification_count() from public, anon, authenticated;
revoke all on function public.mark_ops_notifications_read(text, bigint[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
--
-- A notification is a nudge, not a record: the ledger, the timeline and the
-- notices table are the records. Read rows go after ninety days and unread
-- ones after a year, for both audiences. Returns how many it removed.

create or replace function public.purge_notifications(
  p_read_after_days integer default 90,
  p_unread_after_days integer default 365
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_learner integer;
  v_ops integer;
begin
  delete from public.learner_notifications n
   where (n.read_at is not null and n.read_at < now() - make_interval(days => greatest(p_read_after_days, 1)))
      or (n.read_at is null and n.created_at < now() - make_interval(days => greatest(p_unread_after_days, 1)));
  get diagnostics v_learner = row_count;

  delete from public.ops_notifications n
   where (n.read_at is not null and n.read_at < now() - make_interval(days => greatest(p_read_after_days, 1)))
      or (n.read_at is null and n.created_at < now() - make_interval(days => greatest(p_unread_after_days, 1)));
  get diagnostics v_ops = row_count;

  return v_learner + v_ops;
end;
$$;

revoke all on function public.purge_notifications(integer, integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- The export, as before plus learner_notifications: what a learner was told
-- is theirs like any other row about them. A test holds the keys here to
-- every foreign key to profiles.
-- ---------------------------------------------------------------------------

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
    'plan_comps', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.plan_comps x where x.learner_id = p_learner_id), '[]'::jsonb),
    'learner_notifications', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.learner_notifications x where x.learner_id = p_learner_id), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.ops_learner_export(uuid) from public, anon, authenticated;

-- Scheduled by the database, like the other recurring work (20260924120000).
-- PGlite has no pg_cron: the harness strips every $cron$ block, and the
-- static test in packages/security-tests asserts the schedule is declared.
do $cron$
begin
  perform cron.schedule('dp_notifications_purge', '47 3 * * *',
    $job$select public.purge_notifications()$job$);
end
$cron$;
