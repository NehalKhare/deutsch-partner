-- cost.rollup joined the job kinds in the domain and the scheduler, but the
-- queue's CHECK constraint was never widened, so every scheduled rollup
-- enqueue has been refused at the table. The constraint now names the same
-- closed set the domain does.

alter table public.ops_jobs drop constraint ops_jobs_kind_check;
alter table public.ops_jobs add constraint ops_jobs_kind_check
  check (kind in (
    'productops.drive', 'productops.implement', 'productops.reconcile',
    'fx.refresh', 'pricing.snapshot', 'checkpoints.prune',
    'ingest.knowledge', 'ratelimit.purge', 'cost.rollup'));
