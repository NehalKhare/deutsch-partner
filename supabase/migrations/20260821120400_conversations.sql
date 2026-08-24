-- Conversation threads, messages and rolling summaries.

create table public.conversation_threads (
  id         uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  topic      text not null,
  cefr       text not null check (cefr in ('A1','A2','B1')),
  mini_level integer not null references public.mini_levels (mini_level),
  mode       text not null check (mode in (
               'free_chat','roleplay','travel','daily_life','work','hobbies',
               'storytelling','opinions','problem_solving','grammar_practice',
               'vocabulary_practice','review','assessment')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_threads_updated_after_created
    check (updated_at >= created_at),
  -- Target of the composite foreign key that keeps child rows honest.
  constraint conversation_threads_id_learner_unique unique (id, learner_id)
);

create index conversation_threads_learner_idx
  on public.conversation_threads (learner_id, updated_at desc);
create index conversation_threads_mini_level_idx
  on public.conversation_threads (mini_level);

create table public.conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null,
  -- Denormalised so the RLS policy is an indexed equality test rather than a
  -- correlated subquery on the hottest table in the product. The composite
  -- foreign key below makes drift impossible.
  learner_id       uuid not null,
  role             text not null check (role in ('user','assistant')),
  content          text not null check (length(content) between 1 and 4000),
  language         text not null check (language in ('de','en')),
  input_mode       text not null check (input_mode in ('text','voice')),
  transcript       text,
  audio_duration_ms integer check (audio_duration_ms between 0 and 300000),
  correction       jsonb,
  created_at       timestamptz not null default now(),
  constraint conversation_messages_thread_fkey
    foreign key (thread_id, learner_id)
    references public.conversation_threads (id, learner_id)
    on delete cascade,
  -- A voice message must carry the transcript the learner was shown; a text
  -- message must not pretend to have one.
  constraint conversation_messages_transcript_matches_mode
    check ((input_mode = 'voice') = (transcript is not null))
);

create index conversation_messages_thread_idx
  on public.conversation_messages (thread_id, created_at);
create index conversation_messages_learner_idx
  on public.conversation_messages (learner_id, created_at desc);

create table public.thread_summaries (
  thread_id    uuid not null,
  learner_id   uuid not null,
  summary      text not null check (length(summary) <= 4000),
  message_count integer not null default 0 check (message_count >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (thread_id),
  constraint thread_summaries_thread_fkey
    foreign key (thread_id, learner_id)
    references public.conversation_threads (id, learner_id)
    on delete cascade
);

create index thread_summaries_learner_idx on public.thread_summaries (learner_id);

create trigger conversation_threads_touch before update on public.conversation_threads
  for each row execute function public.touch_updated_at();
create trigger thread_summaries_touch before update on public.thread_summaries
  for each row execute function public.touch_updated_at();
