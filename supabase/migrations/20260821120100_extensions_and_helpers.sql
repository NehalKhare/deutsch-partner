-- Extensions and shared schema helpers.

create extension if not exists vector;

-- The single source of truth for the level/mini-level partition, mirroring
-- domain/cefr.ts. Immutable, so CHECK constraints can call it and the rule
-- lives in one place instead of being restated on every table.
create or replace function public.cefr_for_mini_level(p_mini_level integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_mini_level between 1 and 15  then 'A1'
    when p_mini_level between 16 and 35 then 'A2'
    when p_mini_level between 36 and 70 then 'B1'
  end;
$$;

-- Keeps updated_at honest without trusting the client to send it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
