-- What all learners' trainer feedback adds up to, for the operator.
--
-- One function returning one jsonb document, exactly as the two dashboards
-- and the product-ops board are aggregated: counts by verdict, by reason, by
-- the trainer prompt version the reply was written under, and by the tools
-- the reply used, plus the most recent notes in learners' own words. Nothing
-- in it names a learner — the only per-learner figure is a distinct count.
--
-- Operator scope. SECURITY INVOKER over a table whose policies show a learner
-- only their own rows, so a learner who somehow reached it would get their
-- own summary and nobody else's; and execute is revoked from authenticated
-- anyway, so the only caller is the secret-key client the operator pages and
-- the product-ops research stage use. The prompt_version breakdown is the
-- point: it is what turns votes into evidence about a prompt change.

create or replace function public.learner_feedback_summary(
  p_days integer default 30,
  p_notes integer default 20
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_notes integer := least(greatest(coalesce(p_notes, 20), 0), 100);
  v_from  timestamptz := now() - make_interval(days => v_days);
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'window', jsonb_build_object('from', v_from, 'to', now(), 'days', v_days),
    'totals', (
      select jsonb_build_object(
               'votes',     count(*),
               'helpful',   count(*) filter (where f.verdict = 'helpful'),
               'unhelpful', count(*) filter (where f.verdict = 'unhelpful'),
               'learners',  count(distinct f.learner_id),
               'noted',     count(*) filter (where f.note is not null))
        from public.trainer_feedback f
       where f.created_at >= v_from
    ),
    'byReason', coalesce((
      select jsonb_agg(
               jsonb_build_object('reason', r.reason, 'count', r.n)
               order by r.n desc, r.reason
             )
        from (
          select reason, count(*) as n
            from public.trainer_feedback f, unnest(f.reasons) as reason
           where f.created_at >= v_from
           group by reason
        ) r
    ), '[]'::jsonb),
    'byPromptVersion', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'promptVersion', v.prompt_version,
                 'votes',         v.votes,
                 'helpful',       v.helpful,
                 'unhelpful',     v.unhelpful)
               order by v.prompt_version desc
             )
        from (
          select f.prompt_version,
                 count(*)                                         as votes,
                 count(*) filter (where f.verdict = 'helpful')    as helpful,
                 count(*) filter (where f.verdict = 'unhelpful')  as unhelpful
            from public.trainer_feedback f
           where f.created_at >= v_from
           group by f.prompt_version
        ) v
    ), '[]'::jsonb),
    'byTool', coalesce((
      select jsonb_agg(
               jsonb_build_object('tool', t.tool, 'votes', t.votes, 'unhelpful', t.unhelpful)
               order by t.unhelpful desc, t.votes desc, t.tool
             )
        from (
          select tool,
                 count(*)                                        as votes,
                 count(*) filter (where f.verdict = 'unhelpful') as unhelpful
            from public.trainer_feedback f, unnest(f.tools) as tool
           where f.created_at >= v_from
           group by tool
        ) t
    ), '[]'::jsonb),
    'recentNotes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'note',      n.note,
                 'verdict',   n.verdict,
                 'reasons',   to_jsonb(n.reasons),
                 'createdAt', n.created_at)
               order by n.created_at desc
             )
        from (
          select f.note, f.verdict, f.reasons, f.created_at
            from public.trainer_feedback f
           where f.created_at >= v_from
             and f.note is not null
           order by f.created_at desc
           limit v_notes
        ) n
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.learner_feedback_summary(integer, integer)
  from public, anon, authenticated;
