-- A thread mode for reading comprehension practised in the chat.
--
-- Comprehension scenarios used to be a client-side quiz: read the passage,
-- type answers, string-check. That costs no model call, but it also teaches
-- nothing when the answer is wrong and records nothing the learner's error
-- history could learn from. Practising the same passage in the chat gets both
-- for free — the tutor explains, and every learner message flows through the
-- same evaluation pipeline as any other turn.
--
-- The mode is a fact about the thread, so the closed set that guards it grows
-- by one honest value rather than filing reading practice under "roleplay".

alter table public.conversation_threads
  drop constraint conversation_threads_mode_check;

alter table public.conversation_threads
  add constraint conversation_threads_mode_check
  check (mode in (
    'free_chat','roleplay','travel','daily_life','work','hobbies',
    'storytelling','opinions','problem_solving','grammar_practice',
    'vocabulary_practice','review','assessment','reading'));
