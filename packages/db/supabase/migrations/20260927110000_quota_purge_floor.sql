-- Daily plan quotas share rate_limit_buckets with the per-minute limits
-- (billing-and-plans-spec.md S2): a fixed 24-hour window per learner per
-- plan, opened on first use. The purge's floor was one hour, which was the
-- longest window anything used when it was written. A purge asked for less
-- than a day would now delete a quota bucket that is still counting, and a
-- deleted bucket is a fresh day's allowance.
--
-- So the floor becomes the longest window in use. The worker already asks
-- for one day; this makes that the least anyone can ask for, rather than a
-- convention one call site happens to follow.

create or replace function public.purge_rate_limit_buckets(
  p_older_than interval default interval '1 day'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.rate_limit_buckets
   where window_start < now() - greatest(p_older_than, interval '1 day');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_rate_limit_buckets(interval)
  from public, anon, authenticated;
