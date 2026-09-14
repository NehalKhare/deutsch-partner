-- A failed run can be tried again from the stage that failed.
--
-- Every stage is already a resume point: it checks for its own output before
-- doing work, and a run's spend is reconstructed from its timeline. What was
-- missing was a way back out of 'failed'. The orchestrator now moves a failed
-- run to the stage its timeline says failed, through the same compare-and-set
-- every other transition uses, and drives it again under the same euro ceiling.
--
-- The transition function has to agree. It kept error_code and completed_at
-- across every transition, which was right while no run ever left a terminal
-- stage and is wrong the moment one does: a run back at 'prd' with a stale
-- error code and a completion time would read as both running and finished.
-- Leaving a terminal stage now clears both. Entering one sets them as before.
--
-- create or replace keeps the function's privileges; the revoke is re-issued
-- so this file states the grant it expects rather than inheriting one.

create or replace function public.advance_product_ops_run(
  p_run_id uuid,
  p_from   text,
  p_to     text,
  p_event  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_stage    text;
  v_terminal boolean := p_to in ('completed', 'failed', 'rejected');
begin
  select current_stage into v_stage
    from public.ai_runs
   where id = p_run_id
     for update;

  if not found then
    raise exception 'unknown product ops run' using errcode = '42704';
  end if;

  if v_stage is distinct from p_from then
    return jsonb_build_object('advanced', false, 'stage', v_stage);
  end if;

  update public.ai_runs
     set current_stage = p_to,
         status = case
                    when p_to in ('human_review', 'plan_review')
                      then 'awaiting_review'
                    when p_to = 'completed' then 'completed'
                    when p_to = 'failed' then 'failed'
                    when p_to = 'rejected' then 'rejected'
                    else 'running'
                  end,
         started_at = coalesce(started_at, now()),
         -- Set on entering a terminal stage, cleared on leaving one. A run
         -- that is moving again has not completed.
         completed_at = case when v_terminal then now() else null end,
         -- Likewise: a code describes how the run ended, and a run tried
         -- again has not ended. The failure itself stays on the timeline.
         error_code = case
                        when v_terminal then coalesce(p_event ->> 'errorCode', error_code)
                        else null
                      end
   where id = p_run_id;

  insert into public.ai_run_events
    (run_id, stage, status, detail, request_id)
  values (
    p_run_id,
    p_to,
    coalesce(p_event ->> 'status', 'ok'),
    coalesce(p_event - 'status' - 'requestId' - 'errorCode', '{}'::jsonb),
    nullif(p_event ->> 'requestId', '')::uuid
  );

  return jsonb_build_object('advanced', true, 'stage', p_to);
end;
$$;

revoke all on function
  public.advance_product_ops_run(uuid, text, text, jsonb)
  from public, anon, authenticated;
