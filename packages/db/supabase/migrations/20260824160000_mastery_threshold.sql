-- How high the bar to move up is, is the learner's choice.
--
-- The gate itself is unchanged arithmetic — at least five evaluated turns,
-- and a share of them error-free — but the share is now a setting: 33% for a
-- learner who wants momentum, 50% for balance, 80% for the thorough default
-- the product has always set. A closed set under a CHECK rather than a free
-- percentage, so the stored value is always one the product can explain.
--
-- The five-turn minimum is code, not a column: it is what "evidence" means
-- and is not the learner's to lower.

alter table public.profiles
  add column mastery_threshold smallint not null default 80
    check (mastery_threshold in (33, 50, 80));

comment on column public.profiles.mastery_threshold is
  'The share of evaluated turns that must be error-free before a mini-level counts as cleared. One of 33, 50, 80.';
