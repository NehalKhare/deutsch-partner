-- Two things the worker split needs on the product-ops side.
--
-- 1. A 'queued' event. The surface that asks for a run to be driven no longer
--    drives it; it records a job and this event, and the board reads the event
--    as "still working". The gap between "queued at T" and the worker's first
--    'started' is the evidence an incident on a stuck worker needs.
--
-- 2. A pruning function for graph checkpoints. A run's checkpoints are a
--    cache of its control flow, not its truth, and nothing retired them.
--    Terminal runs older than the given interval lose theirs; the run, its
--    events, findings, proposals and reviews are untouched.

alter table public.ai_run_events
  drop constraint ai_run_events_status_check;

alter table public.ai_run_events
  add constraint ai_run_events_status_check check (status in (
    'started', 'progress', 'queued', 'ok', 'already_done', 'skipped', 'failed',
    'rejected'));

create or replace function public.prune_product_ops_checkpoints(
  p_older_than interval default interval '30 days'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - greatest(p_older_than, interval '7 days');
  v_count  integer;
begin
  delete from public.ai_run_checkpoint_writes w
   where w.thread_id in (
     select r.id from public.ai_runs r
      where r.status in ('completed', 'failed', 'rejected')
        and coalesce(r.completed_at, r.updated_at) < v_cutoff
   );

  delete from public.ai_run_checkpoints c
   where c.thread_id in (
     select r.id from public.ai_runs r
      where r.status in ('completed', 'failed', 'rejected')
        and coalesce(r.completed_at, r.updated_at) < v_cutoff
   );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_product_ops_checkpoints(interval)
  from public, anon, authenticated;
