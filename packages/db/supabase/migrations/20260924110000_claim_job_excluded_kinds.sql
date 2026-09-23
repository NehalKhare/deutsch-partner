-- Per-kind concurrency needs the claim to be steerable: a worker whose slow
-- slots are full keeps draining the fast kinds instead of stalling behind a
-- claim it would only have to give back. The claim function gains an optional
-- excluded-kinds list; a caller that passes nothing gets exactly the old
-- behaviour.
--
-- Dropped and recreated rather than overloaded: two claim_job signatures
-- would make PostgREST's rpc dispatch ambiguous.

drop function public.claim_job(text, text, integer);

create function public.claim_job(
  p_queue text,
  p_worker text,
  p_lock_seconds integer default 90,
  p_excluded_kinds text[] default null
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
          and (p_excluded_kinds is null or c.kind <> all(p_excluded_kinds))
        order by c.run_after, c.id
        for update skip locked
        limit 1
     )
    returning j.*;
end;
$$;

revoke all on function public.claim_job(text, text, integer, text[])
  from public, anon, authenticated;

-- What the queue holds right now, by queue and status. The worker's telemetry
-- reads it on an interval; failed rows are the dead letters an operator wants
-- a number for.

create function public.job_queue_stats()
returns table(queue text, status text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select j.queue, j.status, count(*)
    from public.ops_jobs j
   where j.status in ('queued', 'running', 'failed')
   group by j.queue, j.status
$$;

revoke all on function public.job_queue_stats() from public, anon, authenticated;
