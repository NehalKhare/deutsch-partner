-- The recurring jobs, scheduled by the database instead of by every worker
-- replica ticking an in-process clock. One schedule, however many workers:
-- pg_cron fires, the enqueue deduplicates on the kind, the workers drain.
--
-- The envelope built here is the same one the worker's scheduler built in
-- TypeScript: kind, a fresh correlation id, source "scheduler". The payload's
-- defaults (force, olderThanDays and the like) are applied by the worker's
-- Zod schema on the way out of the queue, so they are not repeated here.

create or replace function public.enqueue_scheduled_job(
  p_kind text,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_correlation uuid := gen_random_uuid();
begin
  return public.enqueue_job(
    'jobs',
    p_kind,
    jsonb_build_object(
      'kind', p_kind,
      'correlationId', v_correlation,
      'source', 'scheduler'
    ) || coalesce(p_extra, '{}'::jsonb),
    v_correlation,
    null,
    p_kind,
    now(),
    5
  );
end;
$$;

revoke all on function public.enqueue_scheduled_job(text, jsonb)
  from public, anon, authenticated;

-- PGlite has no pg_cron, so the harness strips the extension line and the
-- $cron$ block below; a static test in packages/security-tests asserts both
-- are really declared here. Hourly jobs sit on different minutes and the two
-- daily jobs on different early-morning slots, so the queue never takes the
-- whole schedule in one tick. cron.schedule upserts by name, so re-running
-- the migration moves a schedule rather than duplicating it.

create extension if not exists pg_cron;

do $cron$
begin
  perform cron.schedule('dp_productops_reconcile', '*/5 * * * *',
    $job$select public.enqueue_scheduled_job('productops.reconcile')$job$);
  perform cron.schedule('dp_fx_refresh', '7 * * * *',
    $job$select public.enqueue_scheduled_job('fx.refresh')$job$);
  perform cron.schedule('dp_ratelimit_purge', '23 * * * *',
    $job$select public.enqueue_scheduled_job('ratelimit.purge')$job$);
  -- Hourly rather than daily: the calendar is the operator's view of money
  -- being spent right now. Two days, so the rebuild redoes yesterday and
  -- today rather than the whole ledger.
  perform cron.schedule('dp_cost_rollup', '41 * * * *',
    $job$select public.enqueue_scheduled_job('cost.rollup', jsonb_build_object('sinceDays', 2))$job$);
  perform cron.schedule('dp_pricing_snapshot', '13 4 * * *',
    $job$select public.enqueue_scheduled_job('pricing.snapshot')$job$);
  perform cron.schedule('dp_checkpoints_prune', '29 5 * * *',
    $job$select public.enqueue_scheduled_job('checkpoints.prune')$job$);
end
$cron$;
