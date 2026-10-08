import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createLearnerNotificationSink,
  createLearnerNotificationsRepository,
  createLearnerNotifier,
  createOpsNotificationSink,
  createOpsNotificationsRepository,
} from "../../src/notifications-repository";
import { ALICE, BOB, createTestDatabase, type TestDatabase } from "../../src/testing/harness";
import { createPgliteClient } from "../../src/testing/pglite-client";

/**
 * Notifications against a real engine.
 *
 * What only Postgres can confirm: that a learner reads their own rows and
 * nobody else's, can mark them read and change nothing else, and can neither
 * write one nor reach the operators' table at all; that the same event
 * twice is one row; and that the purge keeps what is still news.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await database.seedLearner(ALICE);
  await database.seedLearner(BOB);
});

afterAll(async () => {
  await database?.close();
});

beforeEach(async () => {
  await database.db.exec(`delete from public.learner_notifications; delete from public.ops_notifications;`);
});

const secret = () => createPgliteClient(database.db);

const level = (to: number) =>
  ({
    kind: "level.advanced" as const,
    severity: "success" as const,
    title: `Moved on to mini-level ${to}`,
    body: "You are now one level on.",
    href: "/curriculum",
    dedupeKey: null,
  });

describe("writing a learner's notification", () => {
  it("records it unread, and reads it back newest first as the learner", async () => {
    const notifier = createLearnerNotifier(secret());
    await notifier.record(ALICE, level(27));
    const second = await notifier.record(ALICE, level(28));

    expect(second).toMatchObject({ ok: true, data: { created: true } });

    await database.asLearner(ALICE, async () => {
      const repo = createLearnerNotificationsRepository(secret());
      const recent = await repo.recent();
      expect(recent.ok).toBe(true);
      if (!recent.ok) return;
      expect(recent.data.map((item) => item.title)).toEqual([
        "Moved on to mini-level 28",
        "Moved on to mini-level 27",
      ]);
      expect(recent.data[0]?.readAt).toBeNull();
      expect(recent.data[0]?.createdAt).toMatch(/T.*Z$/);
      expect(await repo.unreadCount()).toEqual({ ok: true, data: 2 });
    });
  });

  it("collapses the same event under its dedupe key, per learner", async () => {
    const notifier = createLearnerNotifier(secret());
    const notice = { ...level(1), kind: "account.withdrawal_received" as const, dedupeKey: "withdrawal:REF1" };

    const first = await notifier.record(ALICE, notice);
    const again = await notifier.record(ALICE, notice);
    const bobs = await notifier.record(BOB, notice);

    expect(first).toMatchObject({ ok: true, data: { created: true } });
    expect(again).toMatchObject({ ok: true, data: { created: false } });
    if (first.ok && again.ok) expect(again.data.id).toBe(first.data.id);
    expect(bobs).toMatchObject({ ok: true, data: { created: true } });
  });

  it("refuses a kind, a link or a title the table does not accept, before any query", async () => {
    const notifier = createLearnerNotifier(secret());

    const kind = await notifier.record(ALICE, { ...level(1), kind: "productops.run_failed" as never });
    const link = await notifier.record(ALICE, { ...level(1), href: "https://evil.example" });
    const title = await notifier.record(ALICE, { ...level(1), title: "x".repeat(121) });

    for (const refused of [kind, link, title]) {
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.kind).toBe("invalid_input");
    }
  });

  it("through the sink, composes the sentence and never throws", async () => {
    const warnings: unknown[] = [];
    const sink = createLearnerNotificationSink(secret(), {
      logger: { warn: (event, fields) => warnings.push([event, fields]) },
    });

    await sink.notify(ALICE, { kind: "billing.pass_granted", plan: "plus", days: 30, endsAt: new Date("2026-11-07T00:00:00Z") });
    // A learner that does not exist: the foreign key refuses, the sink logs.
    await sink.notify("99999999-9999-4999-8999-999999999999", { kind: "billing.pass_granted", plan: "plus", days: 30, endsAt: new Date() });

    const rows = await database.db.query<{ title: string }>(`select title from public.learner_notifications`);
    expect(rows.rows.map((row) => row.title)).toEqual(["Your Plus pass is active"]);
    expect(warnings).toEqual([["notifications.learner_write_failed", { kind: "billing.pass_granted", code: "invalid_reference", userIdHash: undefined }]]);
  });
});

describe("what a learner's session can do", () => {
  beforeEach(async () => {
    const notifier = createLearnerNotifier(secret());
    await notifier.record(ALICE, level(27));
    await notifier.record(ALICE, level(28));
    await notifier.record(BOB, level(5));
  });

  it("reads its own rows and never another learner's", async () => {
    await database.asLearner(BOB, async () => {
      const recent = await createLearnerNotificationsRepository(secret()).recent();
      expect(recent.ok).toBe(true);
      if (!recent.ok) return;
      expect(recent.data.map((item) => item.title)).toEqual(["Moved on to mini-level 5"]);
    });
  });

  it("marks some of its own read, then the rest, and counts as it goes", async () => {
    await database.asLearner(ALICE, async () => {
      const repo = createLearnerNotificationsRepository(secret());
      const recent = await repo.recent();
      if (!recent.ok) throw new Error("unreadable");
      const [newest] = recent.data;

      expect(await repo.markRead([newest!.id])).toEqual({ ok: true, data: 1 });
      expect(await repo.unreadCount()).toEqual({ ok: true, data: 1 });
      // Idempotent: the same id again marks nothing.
      expect(await repo.markRead([newest!.id])).toEqual({ ok: true, data: 0 });
      expect(await repo.markRead("all")).toEqual({ ok: true, data: 1 });
      expect(await repo.unreadCount()).toEqual({ ok: true, data: 0 });
    });
  });

  it("cannot mark another learner's row read, whatever id it names", async () => {
    const bobs = await database.db.query<{ id: string }>(`select id from public.learner_notifications where learner_id = $1`, [BOB]);
    const bobsId = bobs.rows[0]!.id;

    await database.asLearner(ALICE, async () => {
      expect(await createLearnerNotificationsRepository(secret()).markRead([bobsId])).toEqual({ ok: true, data: 0 });
    });

    const after = await database.db.query<{ read_at: string | null }>(`select read_at from public.learner_notifications where id = $1`, [bobsId]);
    expect(after.rows[0]!.read_at).toBeNull();
  });

  // One statement per session: a refused statement aborts the transaction
  // the harness wraps a session in, so a second would fail for that reason.
  const refusedAs = (learnerId: string, sql: string, params: unknown[] = []) =>
    database.asLearner(learnerId, () => expect(database.db.query(sql, params)).rejects.toThrow(/permission denied/i));

  it("cannot write one, nor change what one says, nor remove it", async () => {
    await refusedAs(
      ALICE,
      `insert into public.learner_notifications (learner_id, kind, severity, title, body)
       values ($1, 'billing.pass_granted', 'success', 'Free Premium', 'forged')`,
      [ALICE],
    );
    await refusedAs(ALICE, `update public.learner_notifications set title = 'forged' where learner_id = $1`, [ALICE]);
    await refusedAs(ALICE, `delete from public.learner_notifications where learner_id = $1`, [ALICE]);
  });

  it("cannot reach the operators' notifications at all", async () => {
    await createOpsNotificationsRepository(secret()).record({
      kind: "jobs.dead_lettered",
      severity: "critical",
      title: "A job gave up",
      body: "Job 1 failed for good.",
      href: null,
      subject: "1",
      dedupeKey: "jobs:dead:1",
    });

    await refusedAs(ALICE, `select * from public.ops_notifications`);
    await refusedAs(ALICE, `select * from public.ops_notifications_list(5, false)`);
    await refusedAs(ALICE, `select public.record_ops_notification('account.deleted', 'info', 'x', 'y')`);
  });

  it("cannot write a learner's notification through the secret-key function", async () => {
    await refusedAs(
      ALICE,
      `select public.record_learner_notification($1, 'billing.pass_granted', 'success', 'Free Premium', 'forged')`,
      [ALICE],
    );
  });
});

describe("the operators' inbox", () => {
  const dead = (jobId: number) => ({
    kind: "jobs.dead_lettered" as const,
    severity: "critical" as const,
    title: `Job ${jobId} gave up`,
    body: "It will not be retried on its own.",
    href: null,
    subject: String(jobId),
    dedupeKey: `jobs:dead:${jobId}`,
  });

  it("lists unread first, then the rest, newest first", async () => {
    const repo = createOpsNotificationsRepository(secret());
    await repo.record(dead(1));
    const second = await repo.record(dead(2));
    await repo.record(dead(3));
    if (!second.ok) throw new Error("unwritten");

    expect(await repo.markRead([second.data.id], "operator-hash")).toEqual({ ok: true, data: 1 });

    const listed = await repo.list({ limit: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.map((item) => [item.title, item.readAt === null])).toEqual([
      ["Job 3 gave up", true],
      ["Job 1 gave up", true],
      ["Job 2 gave up", false],
    ]);
    expect(typeof listed.data[0]?.id).toBe("string");

    const unread = await repo.list({ unreadOnly: true });
    expect(unread.ok && unread.data.map((item) => item.title)).toEqual(["Job 3 gave up", "Job 1 gave up"]);
    expect(await repo.unreadCount()).toEqual({ ok: true, data: 2 });
  });

  it("records who read it, as a pseudonym, and reads everything at once", async () => {
    const repo = createOpsNotificationsRepository(secret());
    await repo.record(dead(1));
    await repo.record(dead(2));

    expect(await repo.markRead("all", "operator-hash")).toEqual({ ok: true, data: 2 });

    const rows = await database.db.query<{ read_by_hash: string }>(`select read_by_hash from public.ops_notifications`);
    expect(rows.rows.map((row) => row.read_by_hash)).toEqual(["operator-hash", "operator-hash"]);
  });

  it("collapses the same event under its dedupe key, even after it was read", async () => {
    const repo = createOpsNotificationsRepository(secret());
    const first = await repo.record(dead(1));
    await repo.markRead("all", "operator-hash");
    const again = await repo.record(dead(1));

    expect(again).toMatchObject({ ok: true, data: { created: false } });
    if (first.ok && again.ok) expect(again.data.id).toBe(first.data.id);
  });

  it("through the sink, composes the sentence and never throws", async () => {
    const warnings: unknown[] = [];
    const sink = createOpsNotificationSink(secret(), { logger: { warn: (event, fields) => warnings.push([event, fields]) } });

    await sink.notify({ kind: "productops.review_needed", runId: "run-1", stage: "human_review" });
    await sink.notify({ kind: "productops.review_needed", runId: "run-1", stage: "human_review" });

    const rows = await database.db.query<{ title: string; subject: string }>(`select title, subject from public.ops_notifications`);
    expect(rows.rows).toEqual([{ title: "A proposal is waiting on you", subject: "run-1" }]);
    expect(warnings).toEqual([]);
  });
});

describe("retention", () => {
  it("removes read rows after ninety days and unread ones after a year, for both audiences", async () => {
    await createLearnerNotifier(secret()).record(ALICE, level(1));
    await createLearnerNotifier(secret()).record(ALICE, level(2));
    await createLearnerNotifier(secret()).record(ALICE, level(3));
    await createOpsNotificationsRepository(secret()).record({
      kind: "account.deleted",
      severity: "info",
      title: "A learner deleted their account",
      body: "Gone.",
      href: null,
      subject: null,
      dedupeKey: null,
    });

    await database.db.query(
      `update public.learner_notifications set read_at = now() - interval '91 days' where title = 'Moved on to mini-level 1'`,
    );
    await database.db.query(
      `update public.learner_notifications set created_at = now() - interval '366 days' where title = 'Moved on to mini-level 2'`,
    );
    await database.db.query(`update public.ops_notifications set read_at = now() - interval '10 days'`);

    const purged = await database.db.query<{ purge_notifications: number }>(`select public.purge_notifications()`);
    expect(purged.rows[0]!.purge_notifications).toBe(2);

    const left = await database.db.query<{ title: string }>(`select title from public.learner_notifications`);
    expect(left.rows.map((row) => row.title)).toEqual(["Moved on to mini-level 3"]);
    const ops = await database.db.query(`select 1 from public.ops_notifications`);
    expect(ops.rows).toHaveLength(1);
  });
});
