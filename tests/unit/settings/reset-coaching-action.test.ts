import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reset action: the learner's door out of what the trainer learned.
 * Runs as the signed-in learner, audits the act and never the words.
 */

const requireAuthenticatedUserId = vi.fn();
const reset = vi.fn();
const refresh = vi.fn();
const info = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  refresh: () => refresh(),
}));
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: async () => ({}),
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireAuthenticatedUserId: () => requireAuthenticatedUserId(),
}));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => ({ debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() }),
  pseudonymOrUnavailable: () => "0123456789abcdef0123456789abcdef",
}));
vi.mock("@/repositories/learner-repository", () => ({
  createLearnerRepository: () => ({}),
}));
vi.mock("@/repositories/trainer-coaching-repository", () => ({
  createTrainerCoachingRepository: () => ({ reset }),
}));

const { resetTrainerCoachingAction } = await import("@/app/(app)/settings/actions");

const LEARNER = "11111111-1111-4111-8111-111111111111";
const IDLE = { message: null, status: "idle" } as const;

beforeEach(() => {
  requireAuthenticatedUserId.mockResolvedValue(LEARNER);
  reset.mockResolvedValue({ ok: true, data: null });
});

describe("forgetting the trainer's feedback", () => {
  it("resets the signed-in learner's coaching and refreshes the page", async () => {
    const state = await resetTrainerCoachingAction(IDLE, new FormData());

    expect(reset).toHaveBeenCalledWith(LEARNER);
    expect(state.status).toBe("saved");
    expect(state.message).toMatch(/forgotten/i);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("audits the act under the pseudonym", async () => {
    await resetTrainerCoachingAction(IDLE, new FormData());

    expect(info).toHaveBeenCalledWith(
      "trainer.coaching_reset",
      expect.objectContaining({ audit: true, userIdHash: expect.any(String) }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(LEARNER);
  });

  it("says so plainly when the repository refuses", async () => {
    reset.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });

    const state = await resetTrainerCoachingAction(IDLE, new FormData());

    expect(state.status).toBe("error");
    expect(refresh).not.toHaveBeenCalled();
  });
});
