-- The job queue the worker drains.
--
-- A job is a request for work recorded by whoever wants it done — an
-- operator's action in the ops app, the worker's own scheduler, the
-- reconciler, a command line — and claimed by a worker process that knows
-- nothing else. Postgres is the queue because Postgres is already the only
-- durable state this workflow has: the orchestrator holds nothing in memory,
-- every stage is idempotent, and a run's row is the truth a job merely points
-- at. A crashed worker's job comes back when its lock expires; a duplicate
-- pickup finds the run already moved and reports 'raced'.
--
-- Operator scope: no policy at all, so a learner cannot see that the table
-- exists, and every privilege is revoked from the two web roles. Only the
-- secret-key client reaches it. The functions are SECURITY INVOKER, so they
-- do not widen that.

create table public.ops_jobs (
  id                bigint generated always as identity primary key,
  -- Two queues, so a build inside a worktree never starves a research pass.
  queue             text not null check (queue in ('jobs', 'coder')),
  kind              text not null check (kind in (
                      'productops.drive', 'productops.implement',
                      'productops.reconcile', 'fx.refresh', 'pricing.snapshot',
                      'checkpoints.prune', 'ingest.knowledge', 'ratelimit.purge')),
  -- The envelope, validated by the worker before anything runs.
  payload           jsonb not null default '{}'::jsonb,
  status            text not null default 'queued'
                    check (status in ('queued', 'running', 'done', 'failed')),
  attempts          integer not null default 0 check (attempts >= 0),
  max_attempts      integer not null default 5 check (max_attempts >= 1),
  run_after         timestamptz not null default now(),
  locked_at         timestamptz,
  locked_by         text,
  lock_expires_at   timestamptz,
  -- A code, never a message: the worker maps failures to a closed set.
  last_error        text,
  -- The same id the run carries, so the ops app's log line, this row and the
  -- worker's timeline events read as one story.
  correlation_id    uuid not null,
  -- The operator's pseudonym when a person asked; null for the scheduler.
  requested_by_hash text,
  -- One job per subject in flight: a second nudge on a queued run is a no-op.
  dedupe_key        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);

create unique index ops_jobs_dedupe_active_idx
  on public.ops_jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

-- What a worker's claim scans: the queue's runnable rows, oldest first.
create index ops_jobs_claim_idx
  on public.ops_jobs (queue, run_after, id)
  where status = 'queued';

-- What the expiry sweep scans.
create index ops_jobs_running_idx
  on public.ops_jobs (lock_expires_at)
  where status = 'running';

create trigger ops_jobs_touch_updated_at
  before update on public.ops_jobs
  for each row execute function public.touch_updated_at();

alter table public.ops_jobs enable row level security;
revoke all on public.ops_jobs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue
-- ---------------------------------------------------------------------------
--
-- Returns the job that now represents the request: the new row, or the one
-- already queued or running for the same subject. A caller that wants the
-- work done does not care which.

create or replace function public.enqueue_job(
  p_queue text,
  p_kind text,
  p_payload jsonb,
  p_correlation_id uuid,
  p_requested_by_hash text default null,
  p_dedupe_key text default null,
  p_run_after timestamptz default now(),
  p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.ops_jobs
    (queue, kind, payload, correlation_id, requested_by_hash, dedupe_key,
     run_after, max_attempts)
  values
    (p_queue, p_kind, coalesce(p_payload, '{}'::jsonb), p_correlation_id,
     p_requested_by_hash, p_dedupe_key, coalesce(p_run_after, now()),
     coalesce(p_max_attempts, 5))
  on conflict (dedupe_key)
    where dedupe_key is not null and status in ('queued', 'running')
    do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', true);
  end if;

  select j.id into v_id
    from public.ops_jobs j
   where j.dedupe_key = p_dedupe_key
     and j.status in ('queued', 'running')
   order by j.id desc
   limit 1;

  return jsonb_build_object('id', v_id, 'created', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim
-- ---------------------------------------------------------------------------
--
-- One runnable row per call, oldest first, skipping rows another worker holds
-- the lock on. Two workers calling at once get two different jobs or one gets
-- nothing; neither gets the other's.

create or replace function public.claim_job(
  p_queue text,
  p_worker text,
  p_lock_seconds integer default 90
)
returns setof public.ops_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    update public.ops_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           locked_at = now(),
           locked_by = p_worker,
           lock_expires_at = now() + make_interval(secs => greatest(p_lock_seconds, 5))
     where j.id = (
       select c.id
         from public.ops_jobs c
        where c.queue = p_queue
          and c.status = 'queued'
          and c.run_after <= now()
        order by c.run_after, c.id
        for update skip locked
        limit 1
     )
    returning j.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Heartbeat, completion, failure
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat_job(
  p_job_id bigint,
  p_worker text,
  p_lock_seconds integer default 90
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ops_jobs j
     set lock_expires_at = now() + make_interval(secs => greatest(p_lock_seconds, 5))
   where j.id = p_job_id
     and j.locked_by = p_worker
     and j.status = 'running';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.complete_job(
  p_job_id bigint,
  p_worker text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ops_jobs j
     set status = 'done',
         finished_at = now(),
         locked_by = null,
         lock_expires_at = null,
         last_error = null
   where j.id = p_job_id
     and j.locked_by = p_worker
     and j.status = 'running';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Back to the queue with a delay while attempts remain; failed for good
-- otherwise, or at once when the caller says the job can never succeed (a
-- payload that does not parse). Returns the status the job now has.
create or replace function public.fail_job(
  p_job_id bigint,
  p_worker text,
  p_error text,
  p_retry_in_seconds integer default 30,
  p_final boolean default false
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.ops_jobs j
     set status = case when p_final or j.attempts >= j.max_attempts then 'failed' else 'queued' end,
         run_after = now() + make_interval(secs => greatest(coalesce(p_retry_in_seconds, 0), 0)),
         finished_at = case when p_final or j.attempts >= j.max_attempts then now() else null end,
         locked_by = null,
         lock_expires_at = null,
         last_error = left(coalesce(p_error, 'unknown'), 120)
   where j.id = p_job_id
     and j.locked_by = p_worker
     and j.status = 'running'
  returning j.status into v_status;

  return v_status;
end;
$$;

-- A worker that died mid-job leaves a running row whose lock has expired.
-- Every worker sweeps these before it claims: back to the queue while attempts
-- remain, failed otherwise. Returns how many it moved.
create or replace function public.requeue_expired_jobs()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.ops_jobs j
     set status = case when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
         finished_at = case when j.attempts >= j.max_attempts then now() else null end,
         locked_by = null,
         lock_expires_at = null,
         last_error = 'lock_expired'
   where j.status = 'running'
     and j.lock_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_job(text, text, jsonb, uuid, text, text, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.claim_job(text, text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_job(bigint, text, integer) from public, anon, authenticated;
revoke all on function public.complete_job(bigint, text) from public, anon, authenticated;
revoke all on function public.fail_job(bigint, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.requeue_expired_jobs() from public, anon, authenticated;
