-- Retrieval: hybrid search over the knowledge corpus.
--
-- Two functions rather than one, because the two arms answer different
-- questions and fail differently. Vector search finds text that means the same
-- thing; lexical search finds text that uses the same words. A learner asking
-- "warum mit dem Zug?" is served by both — the first finds an explanation of
-- the dative that never says "Zug", the second finds the example that does.
-- They are fused in the application, where the weighting is testable.
--
-- Both filter before they rank. Filtering after ranking is how a B1 document
-- reaches an A1 learner: it is the most similar thing in the corpus, and the
-- similarity says nothing about whether they can read it.

-- ---------------------------------------------------------------------------
-- The lexical index.
-- ---------------------------------------------------------------------------
--
-- The German configuration, not the default: it stems (Wohnungen -> wohnung)
-- and drops German stop words, neither of which the English one does. A
-- generated column rather than a trigger, so the index cannot fall out of step
-- with the content it indexes.

alter table public.knowledge_chunks
  add column content_tsv tsvector
    generated always as (to_tsvector('german', content)) stored;

create index knowledge_chunks_tsv_idx
  on public.knowledge_chunks using gin (content_tsv);

-- ---------------------------------------------------------------------------
-- Vector search.
-- ---------------------------------------------------------------------------
--
-- plpgsql rather than SQL so the body is not resolved when the function is
-- created. That is what lets the test harness, which has no pgvector, still
-- create it; the vector arm itself is exercised against a real database.

create or replace function public.search_knowledge_vector(
  p_embedding      extensions.vector(1536),
  p_cefr           text[]  default null,
  p_max_mini_level integer default null,
  p_content_types  text[]  default null,
  p_limit          integer default 24
)
returns table (
  id             bigint,
  document_id    bigint,
  content        text,
  cefr           text,
  mini_level     integer,
  topic          text,
  skill          text,
  grammar_target text,
  content_type   text,
  difficulty     integer,
  token_count    integer,
  similarity     double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  select
    c.id, c.document_id, c.content, c.cefr, c.mini_level, c.topic, c.skill,
    c.grammar_target, c.content_type, c.difficulty, c.token_count,
    -- Cosine distance is 0 for identical and 2 for opposite. Reported as a
    -- similarity in 0..1 so the application never has to remember which way
    -- round the operator runs.
    1.0 - ((c.embedding operator(extensions.<=>) p_embedding) / 2.0)
  from public.knowledge_chunks c
  where c.embedding is not null
    and (p_cefr is null or c.cefr = any (p_cefr))
    and (p_max_mini_level is null or c.mini_level is null
         or c.mini_level <= p_max_mini_level)
    and (p_content_types is null or c.content_type = any (p_content_types))
  order by c.embedding operator(extensions.<=>) p_embedding
  limit greatest(1, least(p_limit, 200));
end;
$$;

-- ---------------------------------------------------------------------------
-- Lexical search.
-- ---------------------------------------------------------------------------

create or replace function public.search_knowledge_lexical(
  p_query          text,
  p_cefr           text[]  default null,
  p_max_mini_level integer default null,
  p_content_types  text[]  default null,
  p_limit          integer default 24
)
returns table (
  id             bigint,
  document_id    bigint,
  content        text,
  cefr           text,
  mini_level     integer,
  topic          text,
  skill          text,
  grammar_target text,
  content_type   text,
  difficulty     integer,
  token_count    integer,
  rank           double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- websearch_to_tsquery rather than to_tsquery: the input is a learner's own
  -- sentence, and to_tsquery would raise a syntax error on an apostrophe.
  with query as (select websearch_to_tsquery('german', coalesce(p_query, '')) as q)
  select
    c.id, c.document_id, c.content, c.cefr, c.mini_level, c.topic, c.skill,
    c.grammar_target, c.content_type, c.difficulty, c.token_count,
    ts_rank(c.content_tsv, query.q)::double precision
  from public.knowledge_chunks c, query
  where query.q is not null
    and c.content_tsv @@ query.q
    and (p_cefr is null or c.cefr = any (p_cefr))
    and (p_max_mini_level is null or c.mini_level is null
         or c.mini_level <= p_max_mini_level)
    and (p_content_types is null or c.content_type = any (p_content_types))
  order by ts_rank(c.content_tsv, query.q) desc, c.id
  limit greatest(1, least(p_limit, 200));
$$;

-- The corpus is shared pedagogical content, readable by any signed-in learner
-- and by nobody else; these two functions are how it is read.
-- Named without an argument list, which Postgres allows for an unambiguous
-- name. Spelling the vector type here would be the one place the signature is
-- written twice, and the test harness substitutes that type.
revoke all on function public.search_knowledge_vector from public, anon;
grant execute on function public.search_knowledge_vector to authenticated;

revoke all on function public.search_knowledge_lexical from public, anon;
grant execute on function public.search_knowledge_lexical to authenticated;
