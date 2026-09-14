-- How the trainer carries itself is the learner's choice.
--
-- The trainer as shipped is friendly: warm, encouraging, a coach who praises
-- what went right before it corrects what did not. Some learners want the
-- opposite — every error named, no praise for the routine, precision
-- expected — and a manner is something a learner sits with for months, so
-- "the product's choice" is the wrong answer to a question that personal.
--
-- One column on the profile, two values, defaulting to the trainer as
-- shipped; every existing and newly onboarded learner starts there and
-- changes it in settings. On the profile rather than on the coaching dials,
-- deliberately: the dials are what feedback taught the trainer and "forget my
-- feedback" wipes them, whereas this is a choice the learner made in so many
-- words and must survive that reset. It changes the trainer's manner only —
-- the session protocol, the agenda and the judgement of answers are the same
-- under either — and it is rendered as one templated block in the prompt
-- layer, never as prose about the learner.

alter table public.profiles
  add column trainer_personality text not null default 'friendly'
    check (trainer_personality in ('friendly', 'strict'));

comment on column public.profiles.trainer_personality is
  'The manner the trainer takes with this learner. Tone only: what a session covers and how answers are judged do not change with it.';
