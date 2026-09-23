-- The mini-level carries an English gloss alongside its German theme.
--
-- The theme is what the learner sees; the focus is the same subject phrased to
-- sit inside a sentence, and it is what the learning goals and the prompt
-- context are built from. Keeping it on the row means the database holds a
-- faithful copy of the definition the application ships rather than a subset.

alter table public.mini_levels
  add column if not exists focus text not null default '';

-- The default exists only to add the column to an empty table. Every row is
-- written with a real value, so a later insert that forgets one should fail.
alter table public.mini_levels
  alter column focus drop default;
