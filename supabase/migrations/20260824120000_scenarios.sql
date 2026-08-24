-- Scenarios: the practice corpus behind "Scenarios & Comprehensions".
--
-- One row per scenario item, of exactly two types: a dialogue (a
-- speaker-tagged German script with English translations, practised as an AI
-- roleplay) or a comprehension (a German passage — reading text, telephone
-- menu or train announcement — paired with questions and answers). The finer
-- kind is kept alongside the type for display and analysis.
--
-- Unlike the knowledge corpus, which is chunked for prompt context, a
-- scenario is stored whole: the unit a learner searches for, opens and
-- practises is the item itself, and its structured body (dialogue lines,
-- questions) is rendered by the UI rather than pasted into a prompt. One
-- item is one embedding.
--
-- Shared pedagogical content, like the knowledge tables: readable by any
-- signed-in learner, written only by the offline ingestion script through
-- the secret key — no insert, update or delete policy exists on purpose.

create table public.scenarios (
  id              bigint generated always as identity primary key,
  slug            text not null,
  type            text not null
    check (type in ('dialogue', 'comprehension')),
  kind            text not null
    check (kind in ('dialogue', 'reading', 'telephone', 'announcement')),
  title           text not null,
  title_english   text not null,
  description     text not null,
  target_level    text not null
    check (target_level in ('A1', 'A2', 'B1', 'B2')),
  -- The structured body. For a dialogue: { setting, lines: [{speaker,
  -- german, english}] }. For a comprehension: { passage, passage_english,
  -- questions: [{question, answer}] }.
  content         jsonb not null,
  vocabulary      jsonb not null default '[]'::jsonb,
  source          text not null,
  item_index      integer not null check (item_index >= 0),
  -- The hash of everything stored and embedded, so re-ingestion can skip an
  -- unchanged item before contacting the embedding provider.
  content_hash    text not null,
  -- The exact text that was embedded, kept so retrieval quality can be
  -- audited and evaluated without re-deriving what the vector saw.
  embedding_text  text not null,
  embedding       extensions.vector(1536),
  embedding_model text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint scenarios_slug_unique unique (slug)
);

create index scenarios_type_level_idx
  on public.scenarios (type, target_level);

create index scenarios_embedding_idx
  on public.scenarios using hnsw (embedding extensions.vector_cosine_ops);

create trigger scenarios_touch before update on public.scenarios
  for each row execute function public.touch_updated_at();

alter table public.scenarios enable row level security;

create policy scenarios_read on public.scenarios
  for select to authenticated using (true);

revoke all on public.scenarios from anon, authenticated;
grant select on public.scenarios to authenticated;

-- ---------------------------------------------------------------------------
-- Vector search over scenarios.
-- ---------------------------------------------------------------------------
--
-- plpgsql rather than SQL so the body is not resolved when the function is
-- created — that is what lets the test harness, which has no pgvector, still
-- create it. Filters before it ranks, like the knowledge search: a filter
-- applied after ranking is how a comprehension fills a dialogue-only page.
-- Returns card metadata only; the full body is read by slug through RLS.

create or replace function public.search_scenarios(
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
    s.target_level,
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
