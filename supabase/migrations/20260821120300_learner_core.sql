-- Learner-owned data. Every table here is protected by RLS keyed on
-- auth.uid(); the application never decides ownership.

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  native_language       text not null,
  learning_goal         text not null,
  selected_level        text not null check (selected_level in ('A1','A2','B1')),
  target_topics         text[] not null default '{}',
  interests             text[] not null default '{}',
  input_preference      text not null check (input_preference in ('text','voice')),
  output_preference     text not null check (output_preference in ('text','voice')),
  correction_preference text not null
                        check (correction_preference in ('gentle','explicit','minimal')),
  onboarded_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.learner_states (
  learner_id      uuid primary key references public.profiles (id) on delete cascade,
  selected_level  text not null check (selected_level in ('A1','A2','B1')),
  estimated_level text check (estimated_level in ('A1','A2','B1')),
  effective_cefr  text not null check (effective_cefr in ('A1','A2','B1')),
  effective_plus  boolean not null default false,
  mini_level      integer not null default 1 references public.mini_levels (mini_level),
  fluency         numeric(4,3) not null default 0 check (fluency between 0 and 1),
  comprehension   numeric(4,3) not null default 0 check (comprehension between 0 and 1),
  confidence      numeric(4,3) not null default 0 check (confidence between 0 and 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- B1 is the top of the path, so B1+ is not expressible: it would mean B2.
  constraint learner_states_no_plus_at_b1
    check (not (effective_cefr = 'B1' and effective_plus)),
  constraint learner_states_level_matches_mini_level
    check (effective_cefr = public.cefr_for_mini_level(mini_level))
);

create index learner_states_mini_level_idx on public.learner_states (mini_level);

create table public.learner_vocabulary (
  learner_id         uuid not null references public.profiles (id) on delete cascade,
  vocabulary_item_id uuid not null references public.vocabulary_items (id) on delete cascade,
  exposure_count     integer not null default 0 check (exposure_count >= 0),
  correct_count      integer not null default 0 check (correct_count >= 0),
  incorrect_count    integer not null default 0 check (incorrect_count >= 0),
  mastery_score      numeric(4,3) not null default 0 check (mastery_score between 0 and 1),
  confidence         numeric(4,3) not null default 0 check (confidence between 0 and 1),
  last_seen_at       timestamptz,
  next_review_at     timestamptz,
  status             text not null default 'new' check (status in (
                       'new','introduced','learning','familiar','mastered','weak')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (learner_id, vocabulary_item_id),
  constraint learner_vocabulary_uses_within_exposures
    check (correct_count + incorrect_count <= exposure_count),
  -- Exposure is not mastery: a confident status must be backed by the score.
  constraint learner_vocabulary_status_matches_mastery
    check (status not in ('mastered','familiar') or mastery_score >= 0.6)
);

create index learner_vocabulary_item_idx on public.learner_vocabulary (vocabulary_item_id);
-- Serves "what is due for this learner", the review engine's hot query.
create index learner_vocabulary_due_idx
  on public.learner_vocabulary (learner_id, next_review_at)
  where next_review_at is not null and status <> 'mastered';
create index learner_vocabulary_weak_idx
  on public.learner_vocabulary (learner_id, mastery_score)
  where status = 'weak';

create table public.learner_errors (
  id                 uuid primary key default gen_random_uuid(),
  learner_id         uuid not null references public.profiles (id) on delete cascade,
  error_type         text not null check (error_type in (
                       'word_order','gender','case_nominative','case_accusative',
                       'case_dative','verb_conjugation','modal_verb','separable_verb',
                       'perfekt','subordinate_clause','relative_clause',
                       'adjective_ending','preposition','reflexive_verb','article',
                       'plural_form','vocabulary_choice','spelling')),
  pattern            text not null,
  occurrence_count   integer not null default 1 check (occurrence_count >= 1),
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  resolved           boolean not null default false,
  -- Capped: this row aggregates a recurring pattern, it is not a log.
  example_utterances text[] not null default '{}'
                     check (cardinality(example_utterances) <= 20),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint learner_errors_seen_order check (last_seen_at >= first_seen_at),
  constraint learner_errors_one_per_pattern unique (learner_id, error_type, pattern)
);

create index learner_errors_learner_idx on public.learner_errors (learner_id);
create index learner_errors_unresolved_idx
  on public.learner_errors (learner_id, occurrence_count desc)
  where not resolved;

create table public.learner_memories (
  id               uuid primary key default gen_random_uuid(),
  learner_id       uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in (
                     'interest','goal','preference','achievement','fact','recurring_error')),
  content          text not null check (length(content) <= 500),
  salience         numeric(4,3) not null default 0.5 check (salience between 0 and 1),
  learner_error_id uuid references public.learner_errors (id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A recurring-error memory points at the aggregate rather than restating it.
  constraint learner_memories_error_link
    check ((kind = 'recurring_error') = (learner_error_id is not null))
);

create index learner_memories_learner_idx on public.learner_memories (learner_id);
create index learner_memories_error_idx on public.learner_memories (learner_error_id);
create index learner_memories_salient_idx
  on public.learner_memories (learner_id, salience desc);

create table public.recommendations (
  id            uuid primary key default gen_random_uuid(),
  learner_id    uuid not null references public.profiles (id) on delete cascade,
  activity_type text not null check (activity_type in (
                  'conversation','review','vocabulary_drill','grammar_drill',
                  'roleplay','assessment')),
  mode          text not null,
  topic         text not null,
  reason_kind   text not null check (reason_kind in (
                  'review_due','weakness','interest','level_progression')),
  reason        jsonb not null default '{}'::jsonb,
  score         numeric(4,3) not null check (score between 0 and 1),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  constraint recommendations_expiry_after_creation
    check (expires_at is null or expires_at >= created_at)
);

create index recommendations_learner_idx on public.recommendations (learner_id);
create index recommendations_ranked_idx
  on public.recommendations (learner_id, score desc, created_at desc);

create table public.assessments (
  id             uuid primary key default gen_random_uuid(),
  learner_id     uuid not null references public.profiles (id) on delete cascade,
  kind           text not null check (kind in (
                   'onboarding','mini_level_check','a1_milestone',
                   'a2_milestone','b1_readiness')),
  mini_level     integer references public.mini_levels (mini_level),
  estimated_cefr text check (estimated_cefr in ('A1','A2','B1')),
  score          numeric(4,3) check (score between 0 and 1),
  -- "B1-oriented" / "readiness estimate". Never an official certification.
  passed         boolean,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index assessments_learner_idx on public.assessments (learner_id, created_at desc);
create index assessments_mini_level_idx on public.assessments (mini_level);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger learner_states_touch before update on public.learner_states
  for each row execute function public.touch_updated_at();
create trigger learner_vocabulary_touch before update on public.learner_vocabulary
  for each row execute function public.touch_updated_at();
create trigger learner_errors_touch before update on public.learner_errors
  for each row execute function public.touch_updated_at();
create trigger learner_memories_touch before update on public.learner_memories
  for each row execute function public.touch_updated_at();
