-- AI Product Ops: the operator-facing workflow.
--
-- Operator-scope tables throughout. Nothing here is owned by a learner, so the
-- pattern is deny-by-default rather than auth.uid() ownership: RLS is enabled,
-- no policy is created, and every privilege is revoked from anon and
-- authenticated. Only the secret key, which bypasses RLS, gets through.
--
-- Identity is recorded as operator_id_hash, the same pseudonym the usage ledger
-- carries, so this history survives an account deletion without ever having
-- been able to identify anyone.
--
-- Two shapes recur. Entities carry uuid keys and an updated_at trigger. Logs
-- carry bigint identity keys and are append-only, enforced by trigger rather
-- than by convention: the mistake that actually happens is a well-meaning
-- correction to one row.

-- ---------------------------------------------------------------------------
-- The run
-- ---------------------------------------------------------------------------

create table public.ai_runs (
  id               uuid primary key default gen_random_uuid(),
  run_type         text not null check (run_type in (
                     'manual_market_scan', 'feature_implementation')),
  status           text not null default 'running' check (status in (
                     'running', 'awaiting_review', 'completed', 'failed',
                     'rejected')),
  -- The stage the run is standing at. Every transition is a compare-and-set
  -- against this column; see advance_product_ops_run below.
  current_stage    text not null default 'research' check (current_stage in (
                     'research', 'synthesis', 'human_review', 'prd',
                     'code_plan', 'plan_review', 'implementation',
                     'verification', 'pull_request', 'completed', 'failed',
                     'rejected')),
  operator_id_hash text not null,
  request_id       uuid,
  -- A code, never a provider message. An error string can quote the prompt
  -- back, and the prompt can contain retrieved content.
  error_code       text,
  metadata         jsonb not null default '{}'::jsonb,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index ai_runs_created_idx on public.ai_runs (created_at desc);
create index ai_runs_open_idx on public.ai_runs (status, created_at desc)
  where status in ('running', 'awaiting_review');

-- The timeline the dashboard renders and an incident is reconstructed from.
create table public.ai_run_events (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.ai_runs (id) on delete cascade,
  stage      text not null,
  -- The same closed set a stage outcome comes from, plus the two the
  -- orchestrator writes around one: 'started' for a stage that has begun and
  -- 'skipped' for one nothing asked to run. 'rejected' is here because a human
  -- gate ends a run as deliberately as a failure does, and recording that as a
  -- failure would put a person's decision in the same column as an outage.
  status     text not null check (status in (
               'started', 'ok', 'already_done', 'skipped', 'failed',
               'rejected')),
  detail     jsonb not null default '{}'::jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);

create index ai_run_events_run_idx on public.ai_run_events (run_id, id);

-- ---------------------------------------------------------------------------
-- Research findings
-- ---------------------------------------------------------------------------
--
-- finding_hash is the idempotency key: a re-run of one run's research stage
-- produces the same hashes and inserts nothing. It is scoped to the run rather
-- than global, because the same market fact turning up in a later scan is a
-- signal, not a duplicate.

create table public.market_research (
  id              bigint generated always as identity primary key,
  run_id          uuid not null references public.ai_runs (id) on delete cascade,
  title           text not null,
  source_url      text,
  source_type     text not null check (source_type in (
                    'web', 'forum', 'review', 'competitor', 'internal')),
  summary         text not null,
  pain_points     jsonb not null default '[]'::jsonb,
  trends          jsonb not null default '[]'::jsonb,
  evidence        jsonb not null default '[]'::jsonb,
  relevance_score numeric(4,3) check (relevance_score between 0 and 1),
  finding_hash    text not null,
  created_at      timestamptz not null default now(),
  constraint market_research_one_per_finding unique (run_id, finding_hash)
);

create index market_research_run_idx on public.market_research (run_id, id);

-- ---------------------------------------------------------------------------
-- The proposal, and the human decisions about it
-- ---------------------------------------------------------------------------

create table public.product_proposals (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references public.ai_runs (id)
                           on delete cascade,
  title                  text not null,
  title_slug             text not null
                           check (title_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  problem_statement      text not null,
  market_justification   text not null,
  target_users           text not null,
  user_impact            text not null,
  proposed_solution      text not null,
  complexity             text not null
                           check (complexity in ('small', 'medium', 'large')),
  priority_score         smallint not null
                           check (priority_score between 0 and 100),
  implementation_outline jsonb not null default '[]'::jsonb,
  affected_areas         jsonb not null default '[]'::jsonb,
  supporting_research    jsonb not null default '[]'::jsonb,
  internal_context       jsonb not null default '[]'::jsonb,
  status                 text not null default 'pending_review'
                           check (status in (
                             'pending_review', 'approved', 'rejected',
                             'prd_ready', 'plan_ready', 'coding', 'verifying',
                             'pr_open', 'completed', 'failed')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint product_proposals_one_per_slug unique (run_id, title_slug)
);

create index product_proposals_board_idx
  on public.product_proposals (status, priority_score desc, created_at desc);

-- Review history lives apart from the proposal so a human decision is never
-- silently overwritten by the next one.
create table public.proposal_reviews (
  id                bigint generated always as identity primary key,
  proposal_id       uuid not null references public.product_proposals (id)
                      on delete cascade,
  action            text not null check (action in (
                      'approve', 'reject', 'reprioritise', 'approve_plan',
                      'comment')),
  previous_priority smallint check (previous_priority between 0 and 100),
  new_priority      smallint check (new_priority between 0 and 100),
  comment           text,
  operator_id_hash  text not null,
  created_at        timestamptz not null default now()
);

create index proposal_reviews_proposal_idx
  on public.proposal_reviews (proposal_id, id);

-- ---------------------------------------------------------------------------
-- The artifacts
-- ---------------------------------------------------------------------------
--
-- The PRD is stored here and also written to .ai/prds/ so the coding worker
-- has an explicit file to consume. The file is a projection; if the two
-- disagree, this row is right.

create table public.product_prds (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null unique references public.product_proposals (id)
                  on delete cascade,
  document      text not null,
  document_hash text not null,
  sections      jsonb not null default '{}'::jsonb,
  file_path     text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The approved file lists here become the coding agent's path allowlist. That
-- is the mechanism which keeps it from wandering the repository: not an
-- instruction in a prompt, but a list a person approved.
create table public.implementation_plans (
  id               uuid primary key default gen_random_uuid(),
  proposal_id      uuid not null unique
                     references public.product_proposals (id) on delete cascade,
  files_to_modify  jsonb not null default '[]'::jsonb,
  files_to_create  jsonb not null default '[]'::jsonb,
  database_changes jsonb not null default '[]'::jsonb,
  api_changes      jsonb not null default '[]'::jsonb,
  ui_changes       jsonb not null default '[]'::jsonb,
  tests            jsonb not null default '[]'::jsonb,
  dependencies     jsonb not null default '[]'::jsonb,
  risks            jsonb not null default '[]'::jsonb,
  status           text not null default 'pending_review' check (status in (
                     'pending_review', 'approved', 'rejected')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- What the agent actually touched, applied or refused. The answer to "what did
-- the robot do to my repository", which no git history gives for a rejection.
create table public.code_changes (
  id              bigint generated always as identity primary key,
  plan_id         uuid not null references public.implementation_plans (id)
                    on delete cascade,
  path            text not null,
  edit_count      integer not null default 0 check (edit_count >= 0),
  bytes_before    integer check (bytes_before >= 0),
  bytes_after     integer check (bytes_after >= 0),
  applied         boolean not null,
  rejected_reason text,
  created_at      timestamptz not null default now(),
  -- A refusal without a reason is an unexplained refusal, which is the one
  -- kind of row this table exists to make impossible.
  constraint code_changes_rejection_states_why check (
    (applied and rejected_reason is null)
    or (not applied and rejected_reason is not null)
  )
);

create index code_changes_plan_idx on public.code_changes (plan_id, id);

-- Unique on the branch, which is what stops product-ops/abc-2 existing after a
-- worker dies between pushing and recording.
create table public.pull_requests (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.product_proposals (id)
                on delete cascade,
  provider    text not null default 'github' check (provider in ('github')),
  repository  text not null,
  branch      text not null,
  pr_number   integer check (pr_number > 0),
  url         text,
  status      text not null default 'open'
                check (status in ('open', 'merged', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint pull_requests_one_per_branch unique (repository, branch)
);

create index pull_requests_proposal_idx
  on public.pull_requests (proposal_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Touch triggers on the mutable tables
-- ---------------------------------------------------------------------------

create trigger ai_runs_touch before update on public.ai_runs
  for each row execute function public.touch_updated_at();

create trigger product_proposals_touch before update on public.product_proposals
  for each row execute function public.touch_updated_at();

create trigger product_prds_touch before update on public.product_prds
  for each row execute function public.touch_updated_at();

create trigger implementation_plans_touch
  before update on public.implementation_plans
  for each row execute function public.touch_updated_at();

create trigger pull_requests_touch before update on public.pull_requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only, enforced by the database
-- ---------------------------------------------------------------------------

-- The guard takes its parent table and foreign-key column as trigger
-- arguments, because it has to distinguish two deletes that look identical
-- from inside the row.
--
-- Retiring a whole run is legitimate and cascades to its logs. Correcting one
-- recorded row is the falsification this table exists to prevent. A cascade
-- fires after the parent row has already gone in the same transaction, so the
-- parent's absence is exactly the signal that separates them — and no caller
-- can fake it without first deleting the parent, which is the operation they
-- were entitled to perform anyway.

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_id uuid;
  v_orphaned  boolean;
begin
  if tg_op = 'DELETE' and tg_nargs = 2 then
    v_parent_id := (to_jsonb(old) ->> tg_argv[1])::uuid;

    execute
      format('select not exists (select 1 from public.%I where id = $1)',
             tg_argv[0])
      into v_orphaned
      using v_parent_id;

    if v_orphaned then
      return old;
    end if;
  end if;

  raise exception
    'public.% is append-only; corrections are new rows', tg_table_name
    using errcode = '42501';
end;
$$;

revoke all on function public.reject_append_only_mutation()
  from public, anon, authenticated;

create trigger ai_run_events_append_only
  before update or delete on public.ai_run_events
  for each row
  execute function public.reject_append_only_mutation('ai_runs', 'run_id');

create trigger market_research_append_only
  before update or delete on public.market_research
  for each row
  execute function public.reject_append_only_mutation('ai_runs', 'run_id');

create trigger proposal_reviews_append_only
  before update or delete on public.proposal_reviews
  for each row
  execute function public.reject_append_only_mutation(
    'product_proposals', 'proposal_id');

create trigger code_changes_append_only
  before update or delete on public.code_changes
  for each row
  execute function public.reject_append_only_mutation(
    'implementation_plans', 'plan_id');

-- ---------------------------------------------------------------------------
-- The stage transition, as a compare-and-set
-- ---------------------------------------------------------------------------
--
-- Two workers, or one double-clicked button, must not both win. The row is
-- locked, the stage the caller believed it was leaving is compared, and a
-- stale transition returns advanced = false rather than overwriting. The event
-- row and the stage move in one transaction, so a timeline can never disagree
-- with the run it describes.
--
-- SECURITY INVOKER, so the caller's own privileges decide. These tables have
-- RLS on and no policy, which denies anon and authenticated outright.

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
  v_stage text;
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
         completed_at = case
                          when p_to in ('completed', 'failed', 'rejected')
                            then now()
                          else completed_at
                        end,
         error_code = coalesce(p_event ->> 'errorCode', error_code)
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

-- ---------------------------------------------------------------------------
-- The human decision, recorded once
-- ---------------------------------------------------------------------------
--
-- The proposal's status and the review row move together. Recording the
-- previous priority alongside the new one is what makes the trail an audit
-- rather than a log of the current value.

create or replace function public.record_proposal_review(
  p_proposal_id      uuid,
  p_action           text,
  p_new_priority     integer,
  p_comment          text,
  p_operator_id_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous smallint;
  v_status   text;
  v_priority smallint;
begin
  if p_action not in
    ('approve', 'reject', 'reprioritise', 'approve_plan', 'comment') then
    raise exception 'unknown review action' using errcode = '22023';
  end if;

  if p_new_priority is not null
     and (p_new_priority < 0 or p_new_priority > 100) then
    raise exception 'review priority is outside the scoring range'
      using errcode = '22023';
  end if;

  if p_operator_id_hash is null or p_operator_id_hash = '' then
    raise exception 'a review must record who made it' using errcode = '22023';
  end if;

  select priority_score into v_previous
    from public.product_proposals
   where id = p_proposal_id
     for update;

  if not found then
    raise exception 'unknown proposal' using errcode = '42704';
  end if;

  v_status := case p_action
                when 'approve' then 'approved'
                when 'reject' then 'rejected'
                when 'approve_plan' then 'coding'
                else null
              end;

  -- Approving a plan is the moment the file lists become an allowlist, so the
  -- plan's own status moves in the same transaction as the proposal's. A plan
  -- approval with no plan to approve is refused outright rather than leaving a
  -- run at 'coding' with nothing for the apply layer to check a write against.
  if p_action = 'approve_plan' then
    update public.implementation_plans
       set status = 'approved'
     where proposal_id = p_proposal_id;

    if not found then
      raise exception 'no implementation plan to approve' using errcode = '42704';
    end if;
  end if;

  v_priority := case
                  when p_action = 'reprioritise' then p_new_priority::smallint
                  else v_previous
                end;

  update public.product_proposals
     set status = coalesce(v_status, status),
         priority_score = v_priority
   where id = p_proposal_id;

  insert into public.proposal_reviews
    (proposal_id, action, previous_priority, new_priority, comment,
     operator_id_hash)
  values (
    p_proposal_id,
    p_action,
    v_previous,
    case when p_action = 'reprioritise' then p_new_priority::smallint end,
    p_comment,
    p_operator_id_hash
  );

  return jsonb_build_object(
    'status', coalesce(v_status, (
      select status from public.product_proposals where id = p_proposal_id
    )),
    'priorityScore', v_priority
  );
end;
$$;

revoke all on function
  public.record_proposal_review(uuid, text, integer, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The board, aggregated server-side
-- ---------------------------------------------------------------------------
--
-- One call returns everything the dashboard draws. Six queries and a reduce in
-- React is six chances to disagree.

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
                 'completedAt', r.completed_at)
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

-- ---------------------------------------------------------------------------
-- Operator scope: deny by default, no policies at all
-- ---------------------------------------------------------------------------

alter table public.ai_runs              enable row level security;
alter table public.ai_run_events        enable row level security;
alter table public.market_research      enable row level security;
alter table public.product_proposals    enable row level security;
alter table public.proposal_reviews     enable row level security;
alter table public.product_prds         enable row level security;
alter table public.implementation_plans enable row level security;
alter table public.code_changes         enable row level security;
alter table public.pull_requests        enable row level security;

revoke all on
  public.ai_runs,
  public.ai_run_events,
  public.market_research,
  public.product_proposals,
  public.proposal_reviews,
  public.product_prds,
  public.implementation_plans,
  public.code_changes,
  public.pull_requests
  from anon, authenticated;

-- Nothing is granted back and no policy is created: these are reachable only
-- by the secret key, which bypasses RLS.
