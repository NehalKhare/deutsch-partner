import { describe, expect, it } from "vitest";

import { createConversationRepository } from "@/repositories/conversation-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const threadRow = {
  id: THREAD,
  learner_id: LEARNER,
  title: "Weekend plans",
  topic: "daily life",
  cefr: "A2",
  mini_level: 20,
  mode: "free_chat",
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-20T10:30:00.000Z",
};

describe("listThreads", () => {
  it("returns the learner's threads, newest first", async () => {
    const fake = createFakeSupabase({
      conversation_threads: { data: [threadRow] },
    });

    const result = await createConversationRepository(fake.client).listThreads(
      LEARNER,
    );

    expect(result.ok && result.data).toHaveLength(1);
    expect(fake.methodArgs("conversation_threads", "eq")).toEqual([
      ["learner_id", LEARNER],
    ]);
    expect(fake.methodArgs("conversation_threads", "order")[0]?.[0]).toBe(
      "updated_at",
    );
  });

  it("bounds the page rather than fetching every thread ever opened", async () => {
    const fake = createFakeSupabase({ conversation_threads: { data: [] } });

    await createConversationRepository(fake.client).listThreads(LEARNER);

    const [[limit]] = fake.methodArgs("conversation_threads", "limit");
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(200);
  });

  it("refuses a page size beyond what a single request should carry", async () => {
    const fake = createFakeSupabase({ conversation_threads: { data: [] } });

    const result = await createConversationRepository(fake.client).listThreads(
      LEARNER,
      5000,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });

  it("returns an empty list rather than an error when there are none", async () => {
    const fake = createFakeSupabase({ conversation_threads: { data: [] } });

    const result = await createConversationRepository(fake.client).listThreads(
      LEARNER,
    );

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("fails the whole read if any row is malformed", async () => {
    // Returning a partial list would show the learner an incomplete history
    // and hide the drift that caused it.
    const fake = createFakeSupabase({
      conversation_threads: {
        data: [threadRow, { ...threadRow, mode: "banter" }],
      },
    });

    const result = await createConversationRepository(fake.client).listThreads(
      LEARNER,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_data" } });
  });
});

describe("getThread", () => {
  it("maps the row into a domain thread", async () => {
    const fake = createFakeSupabase({ conversation_threads: { data: threadRow } });

    const result = await createConversationRepository(fake.client).getThread(
      THREAD,
    );

    expect(result.ok && result.data.miniLevel).toBe(20);
    expect(result.ok && result.data.createdAt).toBeInstanceOf(Date);
  });

  it("reports a thread belonging to someone else as not found", async () => {
    // RLS filters it out, so the query simply returns no row. The repository
    // must not distinguish "does not exist" from "not yours".
    const fake = createFakeSupabase({
      conversation_threads: { error: { code: "PGRST116", message: "no rows" } },
    });

    const result = await createConversationRepository(fake.client).getThread(
      THREAD,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});

describe("createThread", () => {
  it("opens the thread through the database function", async () => {
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: threadRow, error: null });

    const result = await createConversationRepository(fake.client).createThread({
      title: "Weekend plans",
      topic: "daily life",
      mode: "free_chat",
    });

    expect(result.ok && result.data.title).toBe("Weekend plans");
    expect(fake.rpcCalls[0]?.fn).toBe("start_conversation_thread");
  });

  it("sends no learner id and no level, so neither can be claimed", async () => {
    // The function reads both from the session and the learner's own record.
    // Accepting them here would let a caller open an A1 learner a B1 thread.
    const fake = createFakeSupabase({});
    fake.setRpcResult({ data: threadRow, error: null });

    await createConversationRepository(fake.client).createThread({
      title: "Weekend plans",
      topic: "daily life",
      mode: "free_chat",
    });

    expect(Object.keys(fake.rpcCalls[0]?.args ?? {})).toEqual([
      "p_title",
      "p_topic",
      "p_mode",
    ]);
  });

  it("refuses a level smuggled in alongside the request", async () => {
    const fake = createFakeSupabase({});

    const result = await createConversationRepository(fake.client).createThread({
      title: "Weekend plans",
      topic: "daily life",
      mode: "free_chat",
      cefr: "B1",
      miniLevel: 60,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a mode outside the closed set", async () => {
    const fake = createFakeSupabase({});

    const result = await createConversationRepository(fake.client).createThread({
      title: "Weekend plans",
      topic: "daily life",
      mode: "banter",
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("updateThread", () => {
  it("changes only what the learner asked to change", async () => {
    const fake = createFakeSupabase({
      conversation_threads: { data: { ...threadRow, title: "Am Bahnhof" } },
    });

    const result = await createConversationRepository(fake.client).updateThread(
      THREAD,
      { title: "Am Bahnhof" },
    );

    expect(result.ok && result.data.title).toBe("Am Bahnhof");
    expect(fake.methodArgs("conversation_threads", "update")).toEqual([
      [{ title: "Am Bahnhof" }],
    ]);
  });

  it("filters on the id alone and lets RLS decide ownership", async () => {
    const fake = createFakeSupabase({ conversation_threads: { data: threadRow } });

    await createConversationRepository(fake.client).updateThread(THREAD, {
      mode: "roleplay",
    });

    expect(fake.methodArgs("conversation_threads", "eq")).toEqual([["id", THREAD]]);
  });

  it("refuses to reassign the owner", async () => {
    // Not merely unsupported: a learner handing a thread to someone else is
    // exactly what the update policy's WITH CHECK exists to stop, and the
    // request should never reach the database.
    const fake = createFakeSupabase({ conversation_threads: { data: threadRow } });

    // Sent alongside a legitimate change, so the request is not rejected
    // merely for being empty. A non-strict schema would quietly strip it and
    // report success, which reads as though the rename worked.
    const result = await createConversationRepository(fake.client).updateThread(
      THREAD,
      { title: "Meins", learnerId: "22222222-2222-4222-8222-222222222222" },
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });

  it("refuses an update that changes nothing", async () => {
    const fake = createFakeSupabase({ conversation_threads: { data: threadRow } });

    const result = await createConversationRepository(fake.client).updateThread(
      THREAD,
      {},
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });
});

describe("deleteThread", () => {
  it("reports success when a row was removed", async () => {
    const fake = createFakeSupabase({
      conversation_threads: { data: [{ id: THREAD }] },
    });

    const result = await createConversationRepository(fake.client).deleteThread(
      THREAD,
    );

    expect(result).toEqual({ ok: true, data: null });
    expect(fake.methodArgs("conversation_threads", "delete")).toEqual([[]]);
  });

  it("reports not found when nothing matched", async () => {
    // Someone else's thread is invisible to the delete, so it removes nothing.
    // Saying so as not_found rather than as a permission error avoids
    // confirming the row exists to a learner who cannot see it.
    const fake = createFakeSupabase({ conversation_threads: { data: [] } });

    const result = await createConversationRepository(fake.client).deleteThread(
      THREAD,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  it("passes a database failure through without leaking its message", async () => {
    const fake = createFakeSupabase({
      conversation_threads: {
        error: { code: "42501", message: 'permission denied for table "x"' },
      },
    });

    const result = await createConversationRepository(fake.client).deleteThread(
      THREAD,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).not.toMatch(/permission denied/);
  });
});
