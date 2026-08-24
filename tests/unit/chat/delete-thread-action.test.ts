import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE_THREAD_MESSAGES } from "@/lib/chat/delete-thread";
import { repositoryError } from "@/repositories/errors";

/**
 * The delete action.
 *
 * Worth testing on its own rather than only through the browser, because the
 * things that matter here are the ones that leave no trace on screen: that it
 * refuses to run without a session, that it never puts a learner id into the
 * query, that a refusal says the same thing whether the thread belonged to
 * somebody else or never existed, and that the audit line carries no title.
 */

const requireAuthenticatedUserId = vi.fn();
const deleteThread = vi.fn();
const revalidatePath = vi.fn();
const warn = vi.fn();
const pseudonymOrUnavailable = vi.fn((_learnerId: string) => PSEUDONYM);

/** Opaque on purpose: a fake that echoes the id cannot catch a leak of it. */
const PSEUDONYM = "0123456789abcdef0123456789abcdef";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: async () => ({}),
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireAuthenticatedUserId: () => requireAuthenticatedUserId(),
}));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
  pseudonymOrUnavailable: (id: string) => pseudonymOrUnavailable(id),
}));
vi.mock("@/repositories/conversation-repository", () => ({
  createConversationRepository: () => ({ deleteThread }),
}));

const { deleteThreadAction } = await import("@/app/(app)/chat/actions");

const LEARNER = "11111111-1111-4111-8111-111111111111";
const THREAD = "1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
const IDLE = { message: null, status: "idle" } as const;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  requireAuthenticatedUserId.mockResolvedValue(LEARNER);
  deleteThread.mockResolvedValue({ ok: true, data: null });
  revalidatePath.mockClear();
  warn.mockClear();
  pseudonymOrUnavailable.mockClear();
});

describe("deleting a conversation", () => {
  it("asks who is asking before it does anything", async () => {
    requireAuthenticatedUserId.mockRejectedValue(new Error("NEXT_REDIRECT:/auth/login"));

    await expect(
      deleteThreadAction(IDLE, form({ threadId: THREAD })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(deleteThread).not.toHaveBeenCalled();
  });

  it("deletes the thread the form named", async () => {
    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(deleteThread).toHaveBeenCalledWith(THREAD);
  });

  it("never passes a learner id to the query", async () => {
    // Row Level Security is the filter. A learner id in the call would be a
    // second, weaker one that a bug could get wrong.
    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(deleteThread).toHaveBeenCalledTimes(1);
    expect(deleteThread.mock.calls[0]).toEqual([THREAD]);
  });

  it("refreshes the page the row was on", async () => {
    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("says nothing when it worked", async () => {
    await expect(deleteThreadAction(IDLE, form({ threadId: THREAD }))).resolves.toEqual(
      IDLE,
    );
  });
});

describe("when it does not work", () => {
  it("refuses a malformed id without touching the database", async () => {
    const result = await deleteThreadAction(IDLE, form({ threadId: "not-an-id" }));

    expect(deleteThread).not.toHaveBeenCalled();
    expect(result.message).toBe(DELETE_THREAD_MESSAGES.not_found);
  });

  it("does not refresh a page nothing changed on", async () => {
    deleteThread.mockResolvedValue({ ok: false, error: repositoryError("not_found") });

    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the same thing for somebody else's thread as for no thread", async () => {
    deleteThread.mockResolvedValue({ ok: false, error: repositoryError("not_found") });
    const missing = await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    deleteThread.mockResolvedValue({ ok: false, error: repositoryError("forbidden") });
    const forbidden = await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    // "Forbidden" would confirm the row exists to whoever guessed its id.
    expect(missing.message).toBe(DELETE_THREAD_MESSAGES.not_found);
    expect(forbidden.message).not.toMatch(/forbidden|permission|not yours/i);
  });

  it("tells a learner to try again when the database was simply unreachable", async () => {
    deleteThread.mockResolvedValue({
      ok: false,
      error: repositoryError("unavailable"),
    });

    const result = await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(result).toEqual({
      status: "error",
      message: DELETE_THREAD_MESSAGES.unavailable,
    });
  });
});

describe("the audit line", () => {
  it("records the deletion as an audit event", async () => {
    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(warn).toHaveBeenCalledWith(
      "chat.thread_deleted",
      expect.objectContaining({ audit: true, outcome: "deleted" }),
    );
  });

  it("records a refusal too, because a run of them is the interesting shape", async () => {
    deleteThread.mockResolvedValue({ ok: false, error: repositoryError("not_found") });

    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    expect(warn).toHaveBeenCalledWith(
      "chat.thread_deleted",
      expect.objectContaining({ outcome: "not_found" }),
    );
  });

  it("carries a pseudonym and never the learner's id", async () => {
    await deleteThreadAction(IDLE, form({ threadId: THREAD }));

    const fields = warn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(pseudonymOrUnavailable).toHaveBeenCalledWith(LEARNER);
    expect(fields.userIdHash).toBe(PSEUDONYM);
    expect(JSON.stringify(fields)).not.toContain(LEARNER);
  });

  it("carries no title and nothing anybody wrote", async () => {
    await deleteThreadAction(IDLE, form({ threadId: THREAD, title: "Im Café" }));

    expect(JSON.stringify(warn.mock.calls[0]?.[1])).not.toMatch(/Café|title/i);
  });
});
