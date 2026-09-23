-- The board gains each run's updated_at, which is the only evidence the page
-- has that anything is driving a run.
--
-- A run sitting at a server-owned stage looks identical whether a background
-- drive is working through it or the process that was driving it died. The
-- dashboard needs to tell those apart to know whether to keep asking, and the
-- run's updated_at is the answer: advance_product_ops_run updates the row on
-- every stage transition, so the touch_updated_at trigger stamps it.
--
-- Only the runs objects change. create or replace keeps the function's
-- existing privileges, and the revoke is re-issued anyway so that this file
-- states the grant it expects rather than inheriting one silently.

create or replace function public.product_ops_dashboard(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'proposals', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'runId', p.run_id,
                 'title', p.title,
                 'titleSlug', p.title_slug,
                 'status', p.status,
                 'complexity', p.complexity,
                 'priorityScore', p.priority_score,
                 'createdAt', p.created_at,
                 'updatedAt', p.updated_at,
                 'runStage', r.current_stage,
                 'runStatus', r.status,
                 'reviewCount', (
                   select count(*) from public.proposal_reviews v
                    where v.proposal_id = p.id
                 ),
                 'hasPrd', exists (
                   select 1 from public.product_prds d
                    where d.proposal_id = p.id
                 ),
                 'hasPlan', exists (
                   select 1 from public.implementation_plans l
                    where l.proposal_id = p.id
                 ),
                 'pullRequest', (
                   select jsonb_build_object(
                            'number', q.pr_number,
                            'url', q.url,
                            'status', q.status)
                     from public.pull_requests q
                    where q.proposal_id = p.id
                    order by q.created_at desc
                    limit 1
                 )
               )
               order by p.priority_score desc, p.created_at desc
             )
        from (
          select *
            from public.product_proposals
           order by priority_score desc, created_at desc
           limit v_limit
        ) p
        join public.ai_runs r on r.id = p.run_id
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', r.id,
                 'runType', r.run_type,
                 'status', r.status,
                 'stage', r.current_stage,
                 'errorCode', r.error_code,
                 'startedAt', r.started_at,
                 'completedAt', r.completed_at,
                 -- The liveness signal. Never null: the column is not null
                 -- with a default, so the page always has something to
                 -- measure quiet against.
                 'updatedAt', r.updated_at)
               order by r.created_at desc
             )
        from (
          select *
            from public.ai_runs
           order by created_at desc
           limit v_limit
        ) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.product_ops_dashboard(integer)
  from public, anon, authenticated;
