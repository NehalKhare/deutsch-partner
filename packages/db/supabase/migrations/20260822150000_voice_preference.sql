-- How the tutor sounds is the learner's choice.
--
-- The tutor's default persona is a man named Jonas, but a voice is something
-- a learner listens to for months, and "the product's choice" is the wrong
-- answer to a question that personal. One column, two values, defaulting to
-- the persona as shipped; every existing and newly onboarded learner starts
-- there and changes it in settings.

alter table public.profiles
  add column voice_preference text not null default 'male'
    check (voice_preference in ('male', 'female'));

comment on column public.profiles.voice_preference is
  'Which voice reads replies aloud. The tutor''s name and manner do not change with it.';
