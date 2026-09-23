-- The trainer's answer analyzer can now report du/Sie and register slips, so
-- the closed taxonomy gains one member and those findings become reviewable
-- recurring mistakes like any other. The constraint name is the one Postgres
-- gave the inline column check in learner_core.
alter table public.learner_errors
  drop constraint learner_errors_error_type_check;
alter table public.learner_errors
  add constraint learner_errors_error_type_check
  check (error_type in (
    'word_order','gender','case_nominative','case_accusative',
    'case_dative','verb_conjugation','modal_verb','separable_verb',
    'perfekt','subordinate_clause','relative_clause',
    'adjective_ending','preposition','reflexive_verb','article',
    'plural_form','vocabulary_choice','spelling','register_formality'));
