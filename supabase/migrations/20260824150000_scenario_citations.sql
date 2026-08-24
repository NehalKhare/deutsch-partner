-- Source citations on scenario search results.
--
-- Every scenario row has always carried where it came from (`source`, the
-- dataset document, and `item_index`, its position in that document); this
-- surfaces both through the search function so an API response can cite its
-- source instead of presenting retrieved content as if it appeared from
-- nowhere. The columns travel with each hit rather than being looked up
-- afterwards, so a card and its citation cannot come from different rows.
--
-- A `RETURNS TABLE` shape cannot be widened with `create or replace`, so the
-- function is dropped and recreated; grants do not survive that, so they are
-- restated. The scenarios table itself is untouched.

drop function public.search_scenarios;

create function public.search_scenarios(
  p_embedding extensions.vector(1536),
  p_types     text[]  default null,
  p_levels    text[]  default null,
  p_limit     integer default 12
)
returns table (
  id            bigint,
  slug          text,
  type          text,
  kind          text,
  title         text,
  title_english text,
  description   text,
  target_level  text,
  source        text,
  item_index    integer,
  similarity    double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  select
    s.id, s.slug, s.type, s.kind, s.title, s.title_english, s.description,
    s.target_level, s.source, s.item_index,
    -- Cosine distance runs 0..2; reported as a 0..1 similarity so callers
    -- never have to remember which way round the operator runs.
    1.0 - ((s.embedding operator(extensions.<=>) p_embedding) / 2.0)
  from public.scenarios s
  where s.embedding is not null
    and (p_types is null or s.type = any (p_types))
    and (p_levels is null or s.target_level = any (p_levels))
  order by s.embedding operator(extensions.<=>) p_embedding
  limit greatest(1, least(p_limit, 50));
end;
$$;

revoke all on function public.search_scenarios from public, anon;
grant execute on function public.search_scenarios to authenticated;
