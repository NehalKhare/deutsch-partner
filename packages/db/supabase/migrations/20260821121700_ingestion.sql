-- Ingestion: the embedding cache and the idempotent document write.

-- ---------------------------------------------------------------------------
-- An embedding call has no output tokens.
-- ---------------------------------------------------------------------------
--
-- The ledger's ceiling column was written for chat, where a zero ceiling would
-- be a misconfiguration. An embedding emits a vector, so zero is the correct
-- and only sensible figure for it.

alter table public.model_invocations
  drop constraint model_invocations_max_output_tokens_check;

alter table public.model_invocations
  add constraint model_invocations_max_output_tokens_check
  check (
    case when tier in ('embedding', 'tts')
         then max_output_tokens = 0
         else max_output_tokens > 0
    end
  );

-- ---------------------------------------------------------------------------
-- The embedding cache.
-- ---------------------------------------------------------------------------
--
-- Re-embedding text that has not changed is the easiest cost in the system to
-- remove entirely, so this is keyed by the hash of the exact text that was
-- embedded together with the model that embedded it. A model change is a new
-- key rather than a stale hit: two models' vectors are not comparable and
-- mixing them silently poisons every similarity score that follows.
--
-- Operator-scope, like the accounting tables: RLS on, no policy, nothing
-- granted back.

create table public.embedding_cache (
  id           bigint generated always as identity primary key,
  model_id     text not null,
  content_hash text not null,
  dimensions   integer not null check (dimensions > 0),
  embedding    extensions.vector(1536) not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint embedding_cache_unique_per_model unique (model_id, content_hash)
);

-- Eviction reads this; nothing else does.
create index embedding_cache_last_used_idx
  on public.embedding_cache (last_used_at);

alter table public.embedding_cache enable row level security;
revoke all on public.embedding_cache from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ingesting one document.
-- ---------------------------------------------------------------------------
--
-- Idempotent by construction rather than by convention. A document is keyed by
-- the hash of its cleaned content, a chunk by the hash of its own text, and a
-- chunk that is no longer produced is removed. Re-running the same source
-- therefore converges on the same rows instead of accumulating copies, and the
-- whole document moves in one transaction so a partial failure leaves the
-- previous version intact rather than half a new one.

create or replace function public.ingest_document(
  p_document jsonb,
  p_chunks   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.knowledge_documents%rowtype;
  v_chunk    public.knowledge_chunks%rowtype;
  v_element  jsonb;
  v_id       bigint;
  v_existing bigint;
  v_hashes   text[];
  v_written  integer := 0;
  v_removed  integer := 0;
begin
  v_document := jsonb_populate_record(null::public.knowledge_documents, p_document);

  if v_document.content_hash is null then
    raise exception 'a document must carry the hash of its own content'
      using errcode = '23502';
  end if;

  select d.id into v_existing
    from public.knowledge_documents d
   where d.content_hash = v_document.content_hash;

  insert into public.knowledge_documents
    (source, title, content_type, language, cefr,
     license, attribution, content_hash, metadata)
  values
    (v_document.source, v_document.title, v_document.content_type,
     coalesce(v_document.language, 'de'), v_document.cefr,
     v_document.license, v_document.attribution, v_document.content_hash,
     coalesce(v_document.metadata, '{}'::jsonb))
  on conflict (content_hash) do update
    set title       = excluded.title,
        source      = excluded.source,
        content_type = excluded.content_type,
        language    = excluded.language,
        cefr        = excluded.cefr,
        license     = excluded.license,
        attribution = excluded.attribution,
        metadata    = excluded.metadata,
        updated_at  = now()
  returning id into v_id;

  for v_element in
    select value from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb))
  loop
    -- Populating the row type converts each field with its own column's input
    -- function, which is how the embedding arrives as a vector without this
    -- function having to name the type.
    v_chunk := jsonb_populate_record(null::public.knowledge_chunks, v_element);

    insert into public.knowledge_chunks
      (document_id, chunk_index, content, chunk_hash, token_count, cefr,
       mini_level, topic, skill, grammar_target, content_type, difficulty,
       embedding, metadata)
    values
      (v_id, v_chunk.chunk_index, v_chunk.content, v_chunk.chunk_hash,
       v_chunk.token_count, v_chunk.cefr, v_chunk.mini_level, v_chunk.topic,
       v_chunk.skill, v_chunk.grammar_target, v_chunk.content_type,
       v_chunk.difficulty, v_chunk.embedding,
       coalesce(v_chunk.metadata, '{}'::jsonb))
    on conflict (document_id, chunk_hash) do update
      set chunk_index    = excluded.chunk_index,
          content        = excluded.content,
          token_count    = excluded.token_count,
          cefr           = excluded.cefr,
          mini_level     = excluded.mini_level,
          topic          = excluded.topic,
          skill          = excluded.skill,
          grammar_target = excluded.grammar_target,
          content_type   = excluded.content_type,
          difficulty     = excluded.difficulty,
          -- Keep the stored vector when the caller supplies none: a re-run
          -- that hit the embedding cache has nothing new to write.
          embedding      = coalesce(excluded.embedding, public.knowledge_chunks.embedding),
          metadata       = excluded.metadata;

    v_written := v_written + 1;
    v_hashes := array_append(v_hashes, v_chunk.chunk_hash);
  end loop;

  -- Chunks the source no longer produces. Without this a document that shrinks
  -- keeps answering queries from text it no longer contains.
  delete from public.knowledge_chunks c
   where c.document_id = v_id
     and c.chunk_hash <> all (coalesce(v_hashes, array[]::text[]));
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'document_id',    v_id,
    'created',        v_existing is null,
    'chunks_written', v_written,
    'chunks_removed', v_removed
  );
end;
$$;

revoke all on function public.ingest_document(jsonb, jsonb)
  from public, anon, authenticated;
