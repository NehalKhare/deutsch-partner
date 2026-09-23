-- Rebuild the daily cost rollup from the ledger.
--
-- cost_rollup_daily has existed since 20260821120600 and nothing has ever
-- written to it. The table, its unique bucket constraint and its RLS were all
-- in place; the job that fills it was not, so every historical view over it
-- returned an empty year no matter how busy the ledger was.
--
-- Rebuild, not accumulate. A day is recomputed from model_invocations in
-- full, so running this twice over the same day leaves the same numbers
-- rather than doubling them — which the cost-dashboard spec requires of a
-- rollup ("idempotent for a given day") and which matters more than usual
-- here, because the worker's scheduler is an in-process clock whose ticks may
-- run twice across replicas.
--
-- security invoker, like every other function in this schema. The ledger is
-- deny-by-default under RLS with no policy, so this runs only for a caller
-- that bypasses RLS — the secret key the worker holds, and nothing else.

create or replace function public.rebuild_cost_rollup_daily(
  p_from date default null,
  p_to   date default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_to    date := coalesce(p_to, (now() at time zone 'utc')::date);
  v_from  date;
  v_start timestamptz;
  v_end   timestamptz;
  v_count integer;
begin
  -- Left to itself the function is incremental: it redoes the newest day it
  -- already has, plus the day before it, so a row that arrived late still
  -- lands. The exception is a rollup with nothing in it, which backfills from
  -- the oldest call in the ledger — the state this table has been in since it
  -- was created, and the one that makes a year of history appear at once.
  v_from := coalesce(
    p_from,
    (select max(day) - 1 from public.cost_rollup_daily),
    (select min((created_at at time zone 'utc')::date) from public.model_invocations),
    v_to
  );

  if v_to < v_from then
    raise exception 'rebuild_cost_rollup_daily: % is before %', v_to, v_from;
  end if;

  -- Bounds as timestamptz rather than a cast on created_at, so the scan uses
  -- model_invocations_created_idx instead of reading the whole ledger.
  v_start := (v_from::text || 'T00:00:00Z')::timestamptz;
  v_end   := ((v_to + 1)::text || 'T00:00:00Z')::timestamptz;

  delete from public.cost_rollup_daily where day between v_from and v_to;

  insert into public.cost_rollup_daily (
    day, task, tier, model_id_resolved, status,
    call_count, input_tokens, output_tokens, cost_eur,
    p50_latency_ms, p95_latency_ms, truncated_count, rebuilt_at
  )
  select
    (created_at at time zone 'utc')::date,
    task,
    tier,
    model_id_resolved,
    status,
    count(*),
    sum(input_tokens),
    sum(output_tokens),
    sum(cost_eur),
    -- Null when no call in the bucket recorded a latency, which is what the
    -- column is nullable for. percentile_cont ignores nulls by itself.
    percentile_cont(0.5) within group (order by latency_ms)::integer,
    percentile_cont(0.95) within group (order by latency_ms)::integer,
    count(*) filter (where truncated),
    now()
  from public.model_invocations
  where created_at >= v_start
    and created_at < v_end
  group by 1, 2, 3, 4, 5;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_cost_rollup_daily(date, date)
  from public, anon, authenticated;
