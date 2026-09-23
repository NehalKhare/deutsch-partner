-- Shared curriculum content. Not owned by any learner: readable by every
-- signed-in learner, writable only by the service role.

create table public.mini_levels (
  mini_level          integer primary key
                      check (mini_level between 1 and 70),
  cefr                text not null check (cefr in ('A1','A2','B1')),
  theme               text not null,
  target_vocabulary   text[] not null default '{}',
  target_grammar      text[] not null default '{}',
  conversation_functions text[] not null default '{}',
  comprehension_goals text[] not null default '{}',
  production_goals    text[] not null default '{}',
  mastery_criteria    jsonb not null default '{}'::jsonb,
  review_requirements jsonb not null default '{}'::jsonb,
  recommended_activities text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint mini_levels_cefr_matches_level
    check (cefr = public.cefr_for_mini_level(mini_level))
);

create table public.vocabulary_items (
  id                  uuid primary key default gen_random_uuid(),
  lemma               text not null,
  word                text not null,
  part_of_speech      text not null check (part_of_speech in (
                        'noun','verb','adjective','adverb','pronoun',
                        'preposition','conjunction','article','numeral',
                        'interjection','phrase')),
  gender              text check (gender in ('der','die','das')),
  plural              text,
  english_translation text not null,
  german_definition   text not null,
  example             text not null,
  collocations        text[] not null default '{}',
  common_mistakes     text[] not null default '{}',
  cefr                text not null check (cefr in ('A1','A2','B1')),
  mini_level          integer not null references public.mini_levels (mini_level),
  topic               text not null,
  frequency_band      integer not null check (frequency_band between 1 and 10),
  is_core_word        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Gender belongs to nouns and to nothing else.
  constraint vocabulary_items_gender_only_on_nouns
    check ((part_of_speech = 'noun') = (gender is not null)),
  constraint vocabulary_items_cefr_matches_level
    check (cefr = public.cefr_for_mini_level(mini_level)),
  constraint vocabulary_items_lemma_pos_unique unique (lemma, part_of_speech)
);

create index vocabulary_items_mini_level_idx on public.vocabulary_items (mini_level);
create index vocabulary_items_cefr_topic_idx on public.vocabulary_items (cefr, topic);
create index vocabulary_items_core_idx on public.vocabulary_items (cefr, frequency_band)
  where is_core_word;

create table public.grammar_patterns (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name                text not null,
  explanation         text not null,
  examples            text[] not null check (cardinality(examples) > 0),
  cefr                text not null check (cefr in ('A1','A2','B1')),
  mini_level          integer not null references public.mini_levels (mini_level),
  difficulty          integer not null check (difficulty between 1 and 5),
  common_mistakes     text[] not null default '{}',
  related_pattern_keys text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint grammar_patterns_cefr_matches_level
    check (cefr = public.cefr_for_mini_level(mini_level)),
  constraint grammar_patterns_not_related_to_self
    check (not (key = any (related_pattern_keys)))
);

create index grammar_patterns_mini_level_idx on public.grammar_patterns (mini_level);
create index grammar_patterns_cefr_idx on public.grammar_patterns (cefr);

create trigger mini_levels_touch before update on public.mini_levels
  for each row execute function public.touch_updated_at();
create trigger vocabulary_items_touch before update on public.vocabulary_items
  for each row execute function public.touch_updated_at();
create trigger grammar_patterns_touch before update on public.grammar_patterns
  for each row execute function public.touch_updated_at();

-- Read-only to learners. Ingestion runs with the service role, which bypasses
-- RLS, so no write policy is needed or wanted here.
alter table public.mini_levels       enable row level security;
alter table public.vocabulary_items  enable row level security;
alter table public.grammar_patterns  enable row level security;

create policy mini_levels_read on public.mini_levels
  for select to authenticated using (true);
create policy vocabulary_items_read on public.vocabulary_items
  for select to authenticated using (true);
create policy grammar_patterns_read on public.grammar_patterns
  for select to authenticated using (true);

revoke all on public.mini_levels, public.vocabulary_items, public.grammar_patterns
  from anon, authenticated;
grant select on public.mini_levels, public.vocabulary_items, public.grammar_patterns
  to authenticated;
