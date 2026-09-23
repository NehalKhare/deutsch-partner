-- Letting a learner choose their level, and move on when they ask.
--
-- Two facts the product could not record before. Neither is derivable from
-- what is already stored, which is why they are columns rather than views.
--
-- furthest_mini_level is what makes a level toggle non-destructive. A learner
-- who is on mini-level 30 and looks at A1 for five minutes must come back to
-- 30, not to 16. It is the highest level they have been placed at, by any
-- route — earned, skipped or chosen — because all three are ways of having
-- been there, and the toggle needs to know where to return them to.
--
-- skipped_mini_levels is what keeps the record honest. A learner may ask to
-- move on from a level they have not mastered, and they should be able to:
-- a level that bores somebody is a level they stop showing up for. But the
-- dashboard's progress figures must not then mean two different things at
-- once, so a level moved past is recorded as moved past.

-- A CHECK rather than a foreign key. The referenced table is a fixed list of
-- seventy rows that will not change, and every foreign key in this schema is
-- required to carry an index -- which this column, only ever read as part of
-- its own row, has no other use for.
alter table public.learner_states
  add column furthest_mini_level integer not null default 1
    check (furthest_mini_level between 1 and 70),
  add column skipped_mini_levels integer[] not null default '{}';

-- A learner cannot be standing further along the path than they have ever
-- been.
--
-- Maintained by the database rather than by whoever is writing. "The high
-- water mark must be raised whenever the level is" is exactly the kind of
-- rule every writer honours until one does not, and the one that forgets
-- leaves a row that quietly loses the learner's place. The trigger makes it a
-- fact; the constraint below is the backstop that proves the trigger runs.
create or replace function public.raise_furthest_mini_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.furthest_mini_level := greatest(
    coalesce(new.furthest_mini_level, 1),
    new.mini_level
  );
  return new;
end;
$$;

create trigger learner_states_raise_furthest
  before insert or update on public.learner_states
  for each row execute function public.raise_furthest_mini_level();

alter table public.learner_states
  add constraint learner_states_furthest_at_least_current
    check (furthest_mini_level >= mini_level);

-- Bounded by the path itself. Which levels are valid is checked by the domain
-- schema on the way in; this stops the column growing without limit.
alter table public.learner_states
  add constraint learner_states_skipped_within_path
    check (coalesce(array_length(skipped_mini_levels, 1), 0) <= 70);

-- Existing learners have been exactly where they are and skipped nothing.
update public.learner_states
   set furthest_mini_level = mini_level
 where furthest_mini_level < mini_level;

comment on column public.learner_states.furthest_mini_level is
  'Highest mini-level ever occupied, so a level toggle can return the learner to it.';
comment on column public.learner_states.skipped_mini_levels is
  'Levels moved past on request rather than mastered. Progress figures must be able to tell the difference.';
