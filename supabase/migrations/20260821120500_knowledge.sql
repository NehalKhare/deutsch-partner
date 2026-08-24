-- Retrieval corpus. Shared pedagogical content, not learner data.

create table public.knowledge_documents (
  id            bigint generated always as identity primary key,
  source        text not null,
  title         text not null,
  content_type  text not null check (content_type in (
                  'curriculum','vocabulary','sentence_pattern','grammar',
                  'situation','conversation_function','culture','dialogue',
                  'mistake_pattern')),
  language      text not null default 'de' check (language in ('de','en')),
  cefr          text check (cefr in ('A1','A2','B1')),
  license       text,
  attribution   text,
  -- Ingestion is idempotent: the same source content cannot be stored twice.
  content_hash  text not null unique,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index knowledge_documents_type_cefr_idx
  on public.knowledge_documents (content_type, cefr);

create table public.knowledge_chunks (
  id            bigint generated always as identity primary key,
  document_id   bigint not null references public.knowledge_documents (id) on delete cascade,
  chunk_index   integer not null check (chunk_index >= 0),
  content       text not null,
  chunk_hash    text not null,
  token_count   integer check (token_count >= 0),
  cefr          text check (cefr in ('A1','A2','B1')),
  mini_level    integer references public.mini_levels (mini_level),
  topic         text,
  skill         text,
  grammar_target text,
  content_type  text not null,
  difficulty    integer check (difficulty between 1 and 5),
  -- Dimension matches the configured embedding model; changing it is a
  -- migration, not a runtime switch.
  embedding     vector(1536),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint knowledge_chunks_unique_per_document unique (document_id, chunk_hash)
);

create index knowledge_chunks_document_idx on public.knowledge_chunks (document_id);
-- Retrieval always filters by learner level before ranking by similarity.
create index knowledge_chunks_filter_idx
  on public.knowledge_chunks (cefr, content_type, mini_level);
-- The composite index above does not lead with mini_level, so the foreign key
-- needs its own index for joins and cascade deletes.
create index knowledge_chunks_mini_level_idx on public.knowledge_chunks (mini_level);
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);

create trigger knowledge_documents_touch before update on public.knowledge_documents
  for each row execute function public.touch_updated_at();
