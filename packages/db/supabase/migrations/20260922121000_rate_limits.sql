-- Request-frequency limits that hold across instances.
--
-- The in-memory limiter was per process: N instances allowed N times the
-- quota and a restart forgave everyone. One row per caller per scope, moved
-- by one atomic upsert under the row lock, is the same fixed window shared by
-- every instance. Keys are pseudonyms already, never a learner id.
--
-- Operator scope, secret key only: a learner's browser has no business
-- reading how often anybody has asked for anything.

create table public.rate_limit_buckets (
  bucket_key   text primary key,
  window_start timestamptz not null,
  hits         integer not null check (hits >= 0),
  updated_at   timestamptz not null default now()
);

create index rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

-- One call, one decision. The window is fixed: it starts at the first hit
-- and rolls over when it has run its course.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now    timestamptz := now();
  v_window interval := make_interval(secs => p_window_seconds);
  v_start  timestamptz;
  v_hits   integer;
begin
  if coalesce(length(p_key), 0) = 0 or length(p_key) > 200
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'rate limit arguments' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets (bucket_key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (bucket_key) do update
    set hits = case
                 when public.rate_limit_buckets.window_start + v_window <= v_now then 1
                 else public.rate_limit_buckets.hits + 1
               end,
        window_start = case
                 when public.rate_limit_buckets.window_start + v_window <= v_now then v_now
                 else public.rate_limit_buckets.window_start
               end,
        updated_at = v_now
  returning window_start, hits into v_start, v_hits;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'remaining', greatest(0, p_limit - v_hits),
    'resetAt', v_start + v_window
  );
end;
$$;

-- Windows that ended long ago are just rows. Scheduled from the worker.
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
   where window_start < now() - greatest(p_older_than, interval '1 hour');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.purge_rate_limit_buckets(interval)
  from public, anon, authenticated;
