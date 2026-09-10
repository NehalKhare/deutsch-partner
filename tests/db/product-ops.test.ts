import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ALICE, createTestDatabase, type TestDatabase } from "./harness";

/**
 * The product-ops schema, against a real engine.
 *
 * Four properties matter here and none of them is checkable from the
 * application side. The tables are operator scope, so a learner's role must
 * bounce off them rather than merely find them empty. The logs are append-only,
 * so a well-meaning correction to one row has to fail. A stage transition is a
 * compare-and-set, so two workers racing must not both win. And the idempotency
 * keys are constraints rather than application checks, because a constraint
 * holds under concurrency and a check-then-write does not.
 */

let database: TestDatabase;

const OPERATOR = "hash-operator";

/** What a compare-and-set transition reports back. */
interface Outcome {
  readonly advanced: boolean;
  readonly stage: string;
}

/** Every table the feature adds. Named once so a new one cannot skip a gate. */
const TABLES = [
  "ai_runs",
  "ai_run_events",
  "market_research",
  "product_proposals",
  "proposal_reviews",
  "product_prds",
  "implementation_plans",
  "code_changes",
  "pull_requests",
  "ai_run_checkpoints",
  "ai_run_checkpoint_writes",
] as const;

/** Every function the feature adds, none of which authenticated may execute. */
const FUNCTIONS = [
  "advance_product_ops_run",
  "record_proposal_review",
  "product_ops_dashboard",
  "touch_product_ops_run",
] as const;

async function seedRun(stage = "research"): Promise<string> {
  const result = await database.db.query<{ id: string }>(
    `insert into public.ai_runs
       (run_type, status, current_stage, operator_id_hash, started_at)
     values ('manual_market_scan', 'running', $1, $2, now())
     returning id`,
    [stage, OPERATOR],
  );

  return result.rows[0].id;
}

async function seedProposal(
  runId: string,
  over: { slug?: string; priority?: number } = {},
): Promise<string> {
  const result = await database.db.query<{ id: string }>(
    `insert into public.product_proposals
       (run_id, title, title_slug, problem_statement, market_justification,
        target_users, user_impact, proposed_solution, complexity, priority_score)
     values ($1, 'Medical German', $2, 'Nurses cannot work', 'Demand is high',
             'Healthcare workers', 'Employability', 'A module', 'medium', $3)
     returning id`,
    [runId, over.slug ?? "medical-german", over.priority ?? 70],
  );

  return result.rows[0].id;
}

async function stageOf(runId: string): Promise<string> {
  const result = await database.db.query<{ current_stage: string }>(
    `select current_stage from public.ai_runs where id = $1`,
    [runId],
  );

  return result.rows[0].current_stage;
}

async function eventCount(runId: string): Promise<number> {
  const result = await database.db.query<{ count: string }>(
    `select count(*)::text as count from public.ai_run_events where run_id = $1`,
    [runId],
  );

  return Number(result.rows[0].count);
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.exec(`delete from public.ai_runs`);
});

describe("operator scope", () => {
  it.each(TABLES)("%s has row level security enabled", async (table) => {
    const result = await database.db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class
       where oid = ('public.' || $1)::regclass`,
      [table],
    );

    expect(result.rows[0].relrowsecurity).toBe(true);
  });

  it.each(TABLES)("%s carries no policy at all", async (table) => {
    // A policy would be a way in. These tables are reachable only by the
    // secret key, which bypasses RLS entirely.
    const result = await database.db.query<{ count: string }>(
      `select count(*)::text as count from pg_policies
       where schemaname = 'public' and tablename = $1`,
      [table],
    );

    expect(result.rows[0].count).toBe("0");
  });

  it.each(TABLES)("%s is unreadable by a signed-in learner", async (table) => {
    await expect(
      database.asLearner(ALICE, () =>
        database.db.query(`select 1 from public.${table}`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each(TABLES)("%s is unreadable by an anonymous visitor", async (table) => {
    await expect(
      database.asAnon(() => database.db.query(`select 1 from public.${table}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each(FUNCTIONS)("%s is not executable by a learner", async (name) => {
    const result = await database.db.query<{ allowed: boolean }>(
      `select has_function_privilege(
         'authenticated', p.oid, 'execute') as allowed
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [name],
    );

    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) expect(row.allowed).toBe(false);
  });
});

describe("append-only logs", () => {
  const appendOnly = [
    "ai_run_events",
    "market_research",
    "proposal_reviews",
    "code_changes",
  ] as const;

  it.each(appendOnly)("%s has an append-only trigger", async (table) => {
    const result = await database.db.query<{ count: string }>(
      `select count(*)::text as count from pg_trigger
       where tgrelid = ('public.' || $1)::regclass and not tgisinternal`,
      [table],
    );

    expect(Number(result.rows[0].count)).toBeGreaterThan(0);
  });

  it("refuses to update a recorded event", async () => {
    const runId = await seedRun();
    await database.db.query(
      `insert into public.ai_run_events (run_id, stage, status)
       values ($1, 'research', 'ok')`,
      [runId],
    );

    await expect(
      database.db.query(
        `update public.ai_run_events set status = 'failed' where run_id = $1`,
        [runId],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses to delete a recorded event", async () => {
    const runId = await seedRun();
    await database.db.query(
      `insert into public.ai_run_events (run_id, stage, status)
       values ($1, 'research', 'ok')`,
      [runId],
    );

    await expect(
      database.db.query(`delete from public.ai_run_events where run_id = $1`, [
        runId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it("lets a whole run be retired, logs and all", async () => {
    // The other half of the property above. A guard that made a run
    // undeletable would not be an audit trail, it would be a leak.
    const runId = await seedRun();
    await database.db.query(
      `insert into public.ai_run_events (run_id, stage, status)
       values ($1, 'research', 'ok')`,
      [runId],
    );

    await expect(
      database.db.query(`delete from public.ai_runs where id = $1`, [runId]),
    ).resolves.toBeDefined();
    expect(await eventCount(runId)).toBe(0);
  });

  it("refuses to rewrite a human review", async () => {
    const runId = await seedRun();
    const proposalId = await seedProposal(runId);
    await database.db.query(
      `insert into public.proposal_reviews
         (proposal_id, action, operator_id_hash)
       values ($1, 'approve', $2)`,
      [proposalId, OPERATOR],
    );

    await expect(
      database.db.query(
        `update public.proposal_reviews set action = 'reject'
         where proposal_id = $1`,
        [proposalId],
      ),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("advance_product_ops_run", () => {
  it("moves the stage and records one event, together", async () => {
    const runId = await seedRun("research");

    const result = await database.db.query<{ outcome: Outcome }>(
      `select public.advance_product_ops_run(
         $1, 'research', 'synthesis',
         jsonb_build_object('status', 'ok')) as outcome`,
      [runId],
    );

    expect(result.rows[0].outcome).toMatchObject({
      advanced: true,
      stage: "synthesis",
    });
    expect(await stageOf(runId)).toBe("synthesis");
    expect(await eventCount(runId)).toBe(1);
  });

  it("rejects a transition from a stage the run has already left", async () => {
    // Two workers, one run. The second must lose rather than overwrite.
    const runId = await seedRun("research");
    await database.db.query(
      `select public.advance_product_ops_run(
         $1, 'research', 'synthesis', jsonb_build_object('status', 'ok'))`,
      [runId],
    );

    const stale = await database.db.query<{ outcome: Outcome }>(
      `select public.advance_product_ops_run(
         $1, 'research', 'human_review',
         jsonb_build_object('status', 'ok')) as outcome`,
      [runId],
    );

    expect(stale.rows[0].outcome).toMatchObject({
      advanced: false,
      stage: "synthesis",
    });
    expect(await stageOf(runId)).toBe("synthesis");
  });

  it("writes no event when the transition is refused", async () => {
    const runId = await seedRun("research");

    await database.db.query(
      `select public.advance_product_ops_run(
         $1, 'prd', 'code_plan', jsonb_build_object('status', 'ok'))`,
      [runId],
    );

    expect(await eventCount(runId)).toBe(0);
  });

  it("rejects a stage outside the known set", async () => {
    const runId = await seedRun("research");

    await expect(
      database.db.query(
        `select public.advance_product_ops_run(
           $1, 'research', 'world_domination', '{}'::jsonb)`,
        [runId],
      ),
    ).rejects.toThrow();
  });
});

describe("the signatures the repository calls", () => {
  /**
   * The repository invokes these by named parameter, and a name it gets wrong
   * is invisible to every test that calls them positionally. These call each
   * one exactly the way createProductOpsRepository does, so a renamed
   * parameter fails here rather than in production.
   */

  it("advance_product_ops_run takes the parameters the repository sends", async () => {
    const runId = await seedRun("research");

    await expect(
      database.db.query(
        `select public.advance_product_ops_run(
           p_run_id => $1,
           p_from => 'research',
           p_to => 'synthesis',
           p_event => jsonb_build_object('status', 'ok')) as outcome`,
        [runId],
      ),
    ).resolves.toBeDefined();
  });

  it("record_proposal_review takes the parameters the repository sends", async () => {
    const runId = await seedRun("human_review");
    const proposalId = await seedProposal(runId);

    await expect(
      database.db.query(
        `select public.record_proposal_review(
           p_proposal_id => $1,
           p_action => 'approve',
           p_new_priority => null,
           p_comment => 'Ship it',
           p_operator_id_hash => $2) as outcome`,
        [proposalId, OPERATOR],
      ),
    ).resolves.toBeDefined();
  });

  it("product_ops_dashboard takes the parameter the repository sends", async () => {
    await expect(
      database.db.query(
        `select public.product_ops_dashboard(p_limit => 20) as board`,
      ),
    ).resolves.toBeDefined();
  });

  it("product_ops_dashboard reports when each run last moved", async () => {
    // The dashboard's only evidence that anything is driving a run. Without
    // it every run at a server-owned stage looks freshly moved, and the page
    // shows an operator a spinner over work that died days ago. Asserted
    // against the shape the schema parses rather than 'it returned something',
    // because a dropped key is exactly what that assertion would miss.
    await seedRun("research");

    const result = await database.db.query<{
      board: { runs: { updatedAt: string; stage: string }[] };
    }>(`select public.product_ops_dashboard(p_limit => 20) as board`);

    const [run] = result.rows[0].board.runs;
    expect(run.stage).toBe("research");
    expect(Number.isNaN(Date.parse(run.updatedAt))).toBe(false);
  });

  it("moves that timestamp when a stage advances", async () => {
    // The whole mechanism depends on advance_product_ops_run touching the row
    // — it is the trigger, not the orchestrator, that stamps this. A future
    // transition written as an insert-only event would leave updated_at
    // frozen and the staleness check would call every live run stalled.
    const runId = await seedRun("research");

    const before = await database.db.query<{ at: string }>(
      `select updated_at as at from public.ai_runs where id = $1`,
      [runId],
    );

    await database.db.query(
      `select public.advance_product_ops_run($1, 'research', 'synthesis', '{}'::jsonb)`,
      [runId],
    );

    const after = await database.db.query<{ at: string }>(
      `select updated_at as at from public.ai_runs where id = $1`,
      [runId],
    );

    expect(Date.parse(after.rows[0].at)).toBeGreaterThanOrEqual(
      Date.parse(before.rows[0].at),
    );
    expect(after.rows[0].at).not.toBe(before.rows[0].at);
  });
});

describe("liveness", () => {
  it("touch_product_ops_run moves updated_at and nothing else", async () => {
    // An agent's tool call inside a long stage touches the run so the board
    // can tell a slow planner from a dead process. The row is otherwise
    // untouched: the stage, the status and the error code stay put.
    const runId = await seedRun("code_plan");

    const before = await database.db.query<{ at: string; stage: string }>(
      `select updated_at as at, current_stage as stage
         from public.ai_runs where id = $1`,
      [runId],
    );

    await database.db.query(`select public.touch_product_ops_run($1)`, [runId]);

    const after = await database.db.query<{ at: string; stage: string }>(
      `select updated_at as at, current_stage as stage
         from public.ai_runs where id = $1`,
      [runId],
    );

    expect(after.rows[0].stage).toBe(before.rows[0].stage);
    expect(after.rows[0].at).not.toBe(before.rows[0].at);
  });

  it("records an agent's progress as its own event status", async () => {
    const runId = await seedRun("code_plan");

    await expect(
      database.db.query(
        `insert into public.ai_run_events (run_id, stage, status, detail)
         values ($1, 'code_plan', 'progress', '{"tool":"read_file","ok":true}'::jsonb)`,
        [runId],
      ),
    ).resolves.toBeDefined();
  });
});

describe("graph checkpoints", () => {
  it("go with their run when it is retired", async () => {
    const runId = await seedRun("research");

    await database.db.query(
      `insert into public.ai_run_checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, checkpoint_type, checkpoint,
          metadata_type, metadata)
       values ($1, '', '1ef00000-0000-6000-8000-000000000001', 'json', 'e30=',
               'json', 'e30=')`,
      [runId],
    );
    await database.db.query(
      `insert into public.ai_run_checkpoint_writes
         (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel,
          value_type, value)
       values ($1, '', '1ef00000-0000-6000-8000-000000000001', 'task', 0,
               'stage', 'json', 'e30=')`,
      [runId],
    );

    await database.db.query(`delete from public.ai_runs where id = $1`, [runId]);

    const left = await database.db.query<{ count: string }>(
      `select (select count(*) from public.ai_run_checkpoints where thread_id = $1)
            + (select count(*) from public.ai_run_checkpoint_writes where thread_id = $1)
            as count`,
      [runId],
    );
    expect(Number(left.rows[0].count)).toBe(0);
  });

  it("refuses a second checkpoint under the same id", async () => {
    const runId = await seedRun("research");
    const insert = `insert into public.ai_run_checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, checkpoint_type, checkpoint,
          metadata_type, metadata)
       values ($1, '', 'same', 'json', 'e30=', 'json', 'e30=')`;

    await database.db.query(insert, [runId]);
    await expect(database.db.query(insert, [runId])).rejects.toThrow(/duplicate/i);
  });
});

describe("the event timeline", () => {
  it("records a human rejection as a decision rather than a failure", async () => {
    // An operator saying no is not an outage, and a timeline that filed it as
    // one would make the two indistinguishable in an incident review.
    const runId = await seedRun("human_review");

    await expect(
      database.db.query(
        `insert into public.ai_run_events (run_id, stage, status)
         values ($1, 'rejected', 'rejected')`,
        [runId],
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a status outside the closed set", async () => {
    const runId = await seedRun();

    await expect(
      database.db.query(
        `insert into public.ai_run_events (run_id, stage, status)
         values ($1, 'research', 'probably_fine')`,
        [runId],
      ),
    ).rejects.toThrow(/check|constraint/i);
  });
});

describe("record_proposal_review", () => {
  it("approves a proposal and records who decided", async () => {
    const runId = await seedRun("human_review");
    const proposalId = await seedProposal(runId);

    await database.db.query(
      `select public.record_proposal_review(
         $1, 'approve', null, 'Ship it', $2)`,
      [proposalId, OPERATOR],
    );

    const proposal = await database.db.query<{ status: string }>(
      `select status from public.product_proposals where id = $1`,
      [proposalId],
    );
    const review = await database.db.query<{
      action: string;
      comment: string;
      operator_id_hash: string;
    }>(
      `select action, comment, operator_id_hash
       from public.proposal_reviews where proposal_id = $1`,
      [proposalId],
    );

    expect(proposal.rows[0].status).toBe("approved");
    expect(review.rows[0]).toMatchObject({
      action: "approve",
      comment: "Ship it",
      operator_id_hash: OPERATOR,
    });
  });

  it("rejects a proposal without deleting it", async () => {
    const runId = await seedRun("human_review");
    const proposalId = await seedProposal(runId);

    await database.db.query(
      `select public.record_proposal_review($1, 'reject', null, 'Too thin', $2)`,
      [proposalId, OPERATOR],
    );

    const proposal = await database.db.query<{ status: string }>(
      `select status from public.product_proposals where id = $1`,
      [proposalId],
    );

    expect(proposal.rows[0].status).toBe("rejected");
  });

  it("records both the old and the new priority when it changes", async () => {
    // The audit trail is the point: a human decision must not be silently
    // overwritten by the next one.
    const runId = await seedRun("human_review");
    const proposalId = await seedProposal(runId, { priority: 40 });

    await database.db.query(
      `select public.record_proposal_review($1, 'reprioritise', 91, null, $2)`,
      [proposalId, OPERATOR],
    );

    const proposal = await database.db.query<{ priority_score: number }>(
      `select priority_score from public.product_proposals where id = $1`,
      [proposalId],
    );
    const review = await database.db.query<{
      previous_priority: number;
      new_priority: number;
    }>(
      `select previous_priority, new_priority
       from public.proposal_reviews where proposal_id = $1`,
      [proposalId],
    );

    expect(proposal.rows[0].priority_score).toBe(91);
    expect(review.rows[0]).toMatchObject({
      previous_priority: 40,
      new_priority: 91,
    });
  });

  it("refuses an action outside the known set", async () => {
    const runId = await seedRun("human_review");
    const proposalId = await seedProposal(runId);

    await expect(
      database.db.query(
        `select public.record_proposal_review($1, 'merge_it', null, null, $2)`,
        [proposalId, OPERATOR],
      ),
    ).rejects.toThrow();
  });

  it("refuses a priority outside the scoring range", async () => {
    const runId = await seedRun("human_review");
    const proposalId = await seedProposal(runId);

    await expect(
      database.db.query(
        `select public.record_proposal_review($1, 'reprioritise', 101, null, $2)`,
        [proposalId, OPERATOR],
      ),
    ).rejects.toThrow();
  });
});

describe("approving a plan", () => {
  async function planFor(proposalId: string): Promise<string> {
    const result = await database.db.query<{ id: string }>(
      `insert into public.implementation_plans (proposal_id)
       values ($1) returning id`,
      [proposalId],
    );

    return result.rows[0].id;
  }

  it("moves the plan and the proposal in one transaction", async () => {
    const runId = await seedRun("plan_review");
    const proposalId = await seedProposal(runId);
    const planId = await planFor(proposalId);

    await database.db.query(
      `select public.record_proposal_review(
         $1, 'approve_plan', null, 'Go', $2)`,
      [proposalId, OPERATOR],
    );

    const plan = await database.db.query<{ status: string }>(
      `select status from public.implementation_plans where id = $1`,
      [planId],
    );
    const proposal = await database.db.query<{ status: string }>(
      `select status from public.product_proposals where id = $1`,
      [proposalId],
    );

    expect(plan.rows[0].status).toBe("approved");
    expect(proposal.rows[0].status).toBe("coding");
  });

  it("refuses a plan approval when there is no plan to approve", async () => {
    // Otherwise a run reaches 'coding' with no file list, which is to say with
    // no allowlist for the apply layer to check a write against.
    const runId = await seedRun("plan_review");
    const proposalId = await seedProposal(runId);

    await expect(
      database.db.query(
        `select public.record_proposal_review(
           $1, 'approve_plan', null, null, $2)`,
        [proposalId, OPERATOR],
      ),
    ).rejects.toThrow(/no implementation plan/i);
  });

  it("leaves the proposal alone when the approval is refused", async () => {
    const runId = await seedRun("plan_review");
    const proposalId = await seedProposal(runId);

    await expect(
      database.db.query(
        `select public.record_proposal_review(
           $1, 'approve_plan', null, null, $2)`,
        [proposalId, OPERATOR],
      ),
    ).rejects.toThrow();

    const proposal = await database.db.query<{ status: string }>(
      `select status from public.product_proposals where id = $1`,
      [proposalId],
    );
    const reviews = await database.db.query<{ count: string }>(
      `select count(*)::text as count from public.proposal_reviews
        where proposal_id = $1`,
      [proposalId],
    );

    expect(proposal.rows[0].status).toBe("pending_review");
    expect(reviews.rows[0].count).toBe("0");
  });
});

describe("idempotency keys", () => {
  it("accepts one finding per hash per run and refuses the second", async () => {
    const runId = await seedRun();
    const insert = () =>
      database.db.query(
        `insert into public.market_research
           (run_id, title, source_type, summary, finding_hash)
         values ($1, 'Nurses need German', 'web', 'A summary', 'hash-1')`,
        [runId],
      );

    await insert();

    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });

  it("lets two runs record the same finding", async () => {
    // The hash dedupes a retry of one run, not the market itself.
    const first = await seedRun();
    const second = await seedRun();
    const insert = (runId: string) =>
      database.db.query(
        `insert into public.market_research
           (run_id, title, source_type, summary, finding_hash)
         values ($1, 'Nurses need German', 'web', 'A summary', 'hash-1')`,
        [runId],
      );

    await insert(first);

    await expect(insert(second)).resolves.toBeDefined();
  });

  it("refuses a second proposal with the same slug in one run", async () => {
    const runId = await seedRun();
    await seedProposal(runId, { slug: "medical-german" });

    await expect(
      seedProposal(runId, { slug: "medical-german" }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("refuses a second PRD for one proposal", async () => {
    const runId = await seedRun();
    const proposalId = await seedProposal(runId);
    const insert = () =>
      database.db.query(
        `insert into public.product_prds
           (proposal_id, document, document_hash, file_path)
         values ($1, '# PRD', 'doc-hash', '.ai/prds/x.md')`,
        [proposalId],
      );

    await insert();

    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });

  it("refuses a second plan for one proposal", async () => {
    const runId = await seedRun();
    const proposalId = await seedProposal(runId);
    const insert = () =>
      database.db.query(
        `insert into public.implementation_plans (proposal_id) values ($1)`,
        [proposalId],
      );

    await insert();

    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });

  it("lets a PRD be re-stored as an upsert on its proposal", async () => {
    // The repository upserts on proposal_id, which is only possible because
    // the constraint is on that column alone. A stage that generated a
    // document and died before recording it writes the same row on retry.
    const runId = await seedRun();
    const proposalId = await seedProposal(runId);

    await database.db.query(
      `insert into public.product_prds
         (proposal_id, document, document_hash, file_path)
       values ($1, '# PRD', 'doc-hash', '.ai/prds/x.md')`,
      [proposalId],
    );

    await database.db.query(
      `insert into public.product_prds
         (proposal_id, document, document_hash, file_path)
       values ($1, '# PRD v2', 'doc-hash-2', '.ai/prds/x.md')
       on conflict (proposal_id) do update
          set document = excluded.document,
              document_hash = excluded.document_hash`,
      [proposalId],
    );

    const stored = await database.db.query<{ count: string; document: string }>(
      `select count(*)::text as count, max(document) as document
         from public.product_prds where proposal_id = $1`,
      [proposalId],
    );

    expect(stored.rows[0].count).toBe("1");
    expect(stored.rows[0].document).toBe("# PRD v2");
  });

  it("refuses a second pull request for one branch", async () => {
    // This is the constraint that stops feature-123-2 existing.
    const runId = await seedRun();
    const proposalId = await seedProposal(runId);
    const insert = () =>
      database.db.query(
        `insert into public.pull_requests
           (proposal_id, repository, branch)
         values ($1, 'owner/repo', 'product-ops/abc')`,
        [proposalId],
      );

    await insert();

    await expect(insert()).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("code_changes", () => {
  async function planFor(): Promise<string> {
    const runId = await seedRun();
    const proposalId = await seedProposal(runId);
    const result = await database.db.query<{ id: string }>(
      `insert into public.implementation_plans (proposal_id) values ($1)
       returning id`,
      [proposalId],
    );

    return result.rows[0].id;
  }

  it("requires a reason for anything it refused to write", async () => {
    const planId = await planFor();

    await expect(
      database.db.query(
        `insert into public.code_changes (plan_id, path, applied)
         values ($1, 'lib/x.ts', false)`,
        [planId],
      ),
    ).rejects.toThrow();
  });

  it("records a rejection with its reason", async () => {
    const planId = await planFor();

    await expect(
      database.db.query(
        `insert into public.code_changes
           (plan_id, path, applied, rejected_reason)
         values ($1, '.env.local', false, 'deny_listed')`,
        [planId],
      ),
    ).resolves.toBeDefined();
  });
});

describe("product_ops_dashboard", () => {
  it("returns proposals with their run and review state", async () => {
    const runId = await seedRun("human_review");
    await seedProposal(runId, { slug: "medical-german", priority: 92 });

    const result = await database.db.query<{ board: unknown }>(
      `select public.product_ops_dashboard(20) as board`,
    );
    const board = result.rows[0].board as {
      proposals: readonly { titleSlug: string; priorityScore: number }[];
    };

    expect(board.proposals).toHaveLength(1);
    expect(board.proposals[0]).toMatchObject({
      titleSlug: "medical-german",
      priorityScore: 92,
    });
  });

  it("returns an empty board rather than failing when there is nothing", async () => {
    const result = await database.db.query<{ board: unknown }>(
      `select public.product_ops_dashboard(20) as board`,
    );
    const board = result.rows[0].board as { proposals: readonly unknown[] };

    expect(board.proposals).toEqual([]);
  });
});
