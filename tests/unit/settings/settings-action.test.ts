import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LearnerProfile } from "@/domain/learner";

/**
 * The settings action.
 *
 * The part worth testing without a browser is the merge: the form owns seven
 * fields and the profile's identity and level are read from the row being
 * changed. Written the wrong way round, the action would quietly save the old
 * values and report success — a settings page that lies.
 */

const requireAuthenticatedUserId = vi.fn();
const getProfile = vi.fn();
const upsertProfile = vi.fn();
const revalidatePath = vi.fn();
const refresh = vi.fn();
const info = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
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
  createLearnerRepository: () => ({ getProfile, upsertProfile }),
}));

const { updateSettingsAction } = await import("@/app/(app)/settings/actions");

const LEARNER = "11111111-1111-4111-8111-111111111111";

const STORED: LearnerProfile = {
  id: LEARNER,
  nativeLanguage: "en",
  learningGoal: "Old goal",
  selectedLevel: "A2",
  targetTopics: ["travel"],
  interests: ["cooking"],
  inputPreference: "text",
  outputPreference: "text",
  correctionPreference: "gentle",
  voicePreference: "male",
  trainerPersonality: "friendly",
  masteryThreshold: 80,
};

const IDLE = { message: null, status: "idle" } as const;

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    nativeLanguage: "en",
    learningGoal: "Hold a job interview in German",
    inputPreference: "voice",
    outputPreference: "voice",
    correctionPreference: "explicit",
    voicePreference: "female",
    trainerPersonality: "strict",
    masteryThreshold: "50",
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("targetTopics", "work");
  data.append("interests", "technology");
  return data;
}

beforeEach(() => {
  requireAuthenticatedUserId.mockResolvedValue(LEARNER);
  getProfile.mockResolvedValue({ ok: true, data: STORED });
  upsertProfile.mockImplementation(async (profile: LearnerProfile) => ({
    ok: true,
    data: profile,
  }));
  revalidatePath.mockClear();
  refresh.mockClear();
  info.mockClear();
  upsertProfile.mockClear();
});

describe("saving settings", () => {
  it("writes what the form said, not what was already stored", async () => {
    const state = await updateSettingsAction(IDLE, form());

    expect(state.status).toBe("saved");
    expect(upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        learningGoal: "Hold a job interview in German",
        correctionPreference: "explicit",
        voicePreference: "female",
        trainerPersonality: "strict",
        targetTopics: ["work"],
        interests: ["technology"],
        inputPreference: "voice",
        outputPreference: "voice",
      }),
    );
  });

  it("keeps the identity and the level from the stored row", async () => {
    // The form has no field for either; the merge must not lose them.
    await updateSettingsAction(IDLE, form());

    expect(upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: LEARNER, selectedLevel: "A2" }),
    );
  });

  it("refuses a malformed submission without touching the database", async () => {
    const state = await updateSettingsAction(
      IDLE,
      form({ correctionPreference: "brutal" }),
    );

    expect(state.status).toBe("error");
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it("says so plainly when the profile cannot be read", async () => {
    getProfile.mockResolvedValue({
      ok: false,
      error: { kind: "unavailable", message: "down", name: "RepositoryError" },
    });

    const state = await updateSettingsAction(IDLE, form());

    expect(state.status).toBe("error");
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it("says so plainly when the write fails, without pretending it saved", async () => {
    upsertProfile.mockResolvedValue({
      ok: false,
      error: { kind: "unavailable", message: "down", name: "RepositoryError" },
    });

    const state = await updateSettingsAction(IDLE, form());

    expect(state.status).toBe("error");
  });

  it("refreshes the page the learner is looking at, so it shows what was saved", async () => {
    // The settings page holds no cached data, so invalidating it achieved
    // nothing: the form kept rendering the profile from before the save.
    await updateSettingsAction(IDLE, form());

    expect(refresh).toHaveBeenCalled();
  });

  it("refreshes the pages that render these values", async () => {
    await updateSettingsAction(IDLE, form());

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("logs counts and choices, never the goal's words", async () => {
    await updateSettingsAction(IDLE, form());

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("learner.settings_changed");
    expect(logged).not.toContain("job interview");
    // The personality is a closed-set choice that shapes every trainer
    // prompt, so which one was chosen is worth the audit line.
    expect(logged).toContain('"trainerPersonality":"strict"');
  });
});
