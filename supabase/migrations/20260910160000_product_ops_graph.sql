-- Product ops as a graph: durable control flow, and a finer-grained timeline.
--
-- The orchestrator became a LangGraph state graph whose nodes are the stages
-- and whose two human gates are interrupts. A graph that pauses has to be
-- resumable from somewhere durable, and the server is serverless-shaped: an
-- in-memory checkpoint dies with the instance that made it. So the graph's
-- checkpoints live here, in two operator-scope tables shaped the way the
-- checkpoint protocol asks for them — one row per checkpoint, one row per
-- pending write — keyed by the run they belong to.
--
-- Rows remain the truth for every artifact. A checkpoint carries control flow
-- and identifiers, never a proposal, a PRD or a plan; those are read from
-- their own tables when a node needs them. If a checkpoint and a row disagree,
-- the row is right, and deleting a run's checkpoints loses nothing a person
-- would miss — the run resumes from its recorded stage.

create table public.ai_run_checkpoints (
  thread_id       uuid not null references public.ai_runs (id) on delete cascade,
  checkpoint_ns   text not null default '',
  checkpoint_id   text not null,
  parent_id       text,
  -- The serialiser's type tag and its payload, base64. Opaque on purpose:
  -- the graph library owns the shape and versions it.
  checkpoint_type text not null,
  checkpoint      text not null,
  metadata_type   text not null,
  metadata        text not null,
  created_at      timestamptz not null default now(),
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);

create index ai_run_checkpoints_thread_idx
  on public.ai_run_checkpoints (thread_id, checkpoint_ns, checkpoint_id desc);

create table public.ai_run_checkpoint_writes (
  thread_id       uuid not null references public.ai_runs (id) on delete cascade,
  checkpoint_ns   text not null default '',
  checkpoint_id   text not null,
  task_id         text not null,
  idx             integer not null check (idx >= 0),
  channel         text not null,
  value_type      text not null,
  value           text not null,
  created_at      timestamptz not null default now(),
  primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- ---------------------------------------------------------------------------
-- The timeline gains a progress row
-- ---------------------------------------------------------------------------
--
-- An agent that reads six files and searches twice is doing something, and a
-- board that could only say "planning the change" for three minutes would
-- report it as stalled. Each tool call becomes a 'progress' row carrying the
-- agent and the tool name — never the arguments or the result — and touches
-- the run, so updated_at is the liveness signal it was already meant to be.
--
-- Neither an entry event nor an outcome: the idempotency guards look for an
-- 'ok' on the stage's own row and are unaffected.

alter table public.ai_run_events
  drop constraint ai_run_events_status_check;

alter table public.ai_run_events
  add constraint ai_run_events_status_check check (status in (
    'started', 'progress', 'ok', 'already_done', 'skipped', 'failed',
    'rejected'));

-- ---------------------------------------------------------------------------
-- Liveness
-- ---------------------------------------------------------------------------
--
-- The board reads a run's updated_at to decide whether anything is driving
-- it. A stage transition touches the row; a tool call inside a long stage did
-- not, so a planner reading its twelfth file looked exactly like a process
-- that had died. This is the touch: it changes nothing but the timestamp the
-- trigger stamps, and it is what a progress event calls.

create or replace function public.touch_product_ops_run(p_run_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.ai_runs
     set metadata = metadata
   where id = p_run_id;
$$;

revoke all on function public.touch_product_ops_run(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operator scope: deny by default, no policies at all
-- ---------------------------------------------------------------------------

alter table public.ai_run_checkpoints       enable row level security;
alter table public.ai_run_checkpoint_writes enable row level security;

revoke all on
  public.ai_run_checkpoints,
  public.ai_run_checkpoint_writes
  from anon, authenticated;

-- Nothing is granted back and no policy is created: these are reachable only
-- by the secret key, which bypasses RLS.
