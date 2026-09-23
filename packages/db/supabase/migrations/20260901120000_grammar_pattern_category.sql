-- Culture and pragmatics notes share the grammar catalogue: same key space,
-- same teach flow, same repository. The category is what lets the trainer's
-- agenda give them a slot of their own instead of dressing "Du oder Sie" up
-- as a grammar drill.
alter table public.grammar_patterns
  add column category text not null default 'grammar'
  check (category in ('grammar', 'culture'));
