import { describe, expect, it } from "vitest";

import { createLearnerRepository } from "../src/learner-repository";
import { createFakeSupabase } from "@dp/test-support/fake-supabase";

const LEARNER = "11111111-1111-4111-8111-111111111111";

const profileRow = {
  id: LEARNER,
  learning_goal: "Hold a conversation in Berlin",
  selected_level: "A2",
  target_topics: ["travel"],
  interests: ["cycling"],
  input_preference: "text",
  output_preference: "text",
  correction_preference: "gentle",
  voice_preference: "male",
  trainer_personality: "strict",
};

const stateRow = {
  learner_id: LEARNER,
  selected_level: "B1",
  estimated_level: "A2",
  effective_cefr: "A2",
  effective_plus: true,
  mini_level: 20,
  furthest_mini_level: 20,
  skipped_mini_levels: [],
  fluency: "0.400",
  comprehension: "0.600",
  confidence: "0.500",
  updated_at: "2026-08-21T10:00:00.000Z",
};

describe("getProfile", () => {
  it("returns a domain profile", async () => {
    const fake = createFakeSupabase({ profiles: { data: profileRow } });
    const repo = createLearnerRepository(fake.client);

    const result = await repo.getProfile(LEARNER);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: LEARNER, selectedLevel: "A2" }),
    });
  });

  it("queries the profile by its own id", async () => {
    const fake = createFakeSupabase({ profiles: { data: profileRow } });

    await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(fake.methodArgs("profiles", "eq")).toEqual([["id", LEARNER]]);
  });

  it("reports a missing profile as not_found rather than throwing", async () => {
    const fake = createFakeSupabase({
      profiles: { error: { code: "PGRST116", message: "no rows" } },
    });

    const result = await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  it("surfaces an RLS denial as forbidden", async () => {
    const fake = createFakeSupabase({
      profiles: {
        error: { code: "42501", message: "row-level security policy" },
      },
    });

    const result = await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });

  it("rejects a row that does not satisfy the domain schema", async () => {
    // The database drifted, or something bypassed a constraint. Either way the
    // repository must not hand a malformed profile to the rest of the app.
    const fake = createFakeSupabase({
      profiles: { data: { ...profileRow, selected_level: "C1" } },
    });

    const result = await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_data" } });
  });

  it("never leaks the database error text into the result", async () => {
    const fake = createFakeSupabase({
      profiles: {
        error: {
          code: "42P01",
          message: 'relation "learner_secrets" does not exist',
        },
      },
    });

    const result = await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(JSON.stringify(result)).not.toContain("learner_secrets");
  });
});

describe("getState", () => {
  it("maps numeric columns and timestamps into domain types", async () => {
    const fake = createFakeSupabase({ learner_states: { data: stateRow } });

    const result = await createLearnerRepository(fake.client).getState(LEARNER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fluency).toBe(0.4);
    expect(result.data.updatedAt).toBeInstanceOf(Date);
  });

  it("reassembles the effective level from its two columns", async () => {
    const fake = createFakeSupabase({ learner_states: { data: stateRow } });

    const result = await createLearnerRepository(fake.client).getState(LEARNER);

    expect(result.ok && result.data.effectiveLevel).toEqual({
      cefr: "A2",
      plus: true,
    });
  });

  it("keeps selected, estimated and effective level distinct", async () => {
    const fake = createFakeSupabase({ learner_states: { data: stateRow } });

    const result = await createLearnerRepository(fake.client).getState(LEARNER);

    expect(result.ok && result.data.selectedLevel).toBe("B1");
    expect(result.ok && result.data.estimatedLevel).toBe("A2");
  });
});

describe("the trainer personality column", () => {
  it("reads the stored choice", async () => {
    const fake = createFakeSupabase({ profiles: { data: profileRow } });

    const result = await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(result.ok && result.data.trainerPersonality).toBe("strict");
  });

  it("reads a row from before the column as the trainer as shipped", async () => {
    // A deployment with the new code but not yet the new column must keep
    // reading profiles: the default is friendly, in the mapper as in the database.
    const { trainer_personality: _dropped, ...older } = profileRow;
    const fake = createFakeSupabase({ profiles: { data: older } });

    const result = await createLearnerRepository(fake.client).getProfile(LEARNER);

    expect(result.ok && result.data.trainerPersonality).toBe("friendly");
  });
});

describe("upsertProfile", () => {
  it("writes the snake_case row the schema expects", async () => {
    const fake = createFakeSupabase({ profiles: { data: profileRow } });

    await createLearnerRepository(fake.client).upsertProfile({
      id: LEARNER,
      learningGoal: "Hold a conversation in Berlin",
      selectedLevel: "A2",
      targetTopics: ["travel"],
      interests: ["cycling"],
      inputPreference: "text",
      outputPreference: "text",
      correctionPreference: "gentle",
      voicePreference: "male",
      trainerPersonality: "strict",
      masteryThreshold: 80,
    });

    const [[payload]] = fake.methodArgs("profiles", "upsert");
    expect(payload).toMatchObject({
      id: LEARNER,
      correction_preference: "gentle",
      voice_preference: "male",
      trainer_personality: "strict",
      selected_level: "A2",
    });
  });

  it("validates its input before touching the database", async () => {
    const fake = createFakeSupabase({ profiles: { data: profileRow } });

    const result = await createLearnerRepository(fake.client).upsertProfile({
      id: "not-a-uuid",
      learningGoal: "x",
      selectedLevel: "A2",
      targetTopics: [],
      interests: [],
      inputPreference: "text",
      outputPreference: "text",
      correctionPreference: "gentle",
      voicePreference: "male",
  masteryThreshold: 80,
    } as never);

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });

  it("reports a duplicate as a conflict", async () => {
    const fake = createFakeSupabase({
      profiles: { error: { code: "23505", message: "duplicate key" } },
    });

    const result = await createLearnerRepository(fake.client).upsertProfile({
      id: LEARNER,
      learningGoal: "x",
      trainerPersonality: "friendly",
      selectedLevel: "A2",
      targetTopics: [],
      interests: [],
      inputPreference: "text",
      outputPreference: "text",
      correctionPreference: "gentle",
      voicePreference: "male",
  masteryThreshold: 80,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });
});

describe("upsertState", () => {
  it("splits the effective level back into its two columns", async () => {
    const fake = createFakeSupabase({ learner_states: { data: stateRow } });

    await createLearnerRepository(fake.client).upsertState({
      learnerId: LEARNER,
      selectedLevel: "B1",
      estimatedLevel: "A2",
      effectiveLevel: { cefr: "A2", plus: true },
      miniLevel: 20,
      furthestMiniLevel: 20,
      skippedMiniLevels: [],
      fluency: 0.4,
      comprehension: 0.6,
      confidence: 0.5,
      updatedAt: new Date("2026-08-21T10:00:00.000Z"),
    });

    const [[payload]] = fake.methodArgs("learner_states", "upsert");
    expect(payload).toMatchObject({
      effective_cefr: "A2",
      effective_plus: true,
    });
    expect(payload).not.toHaveProperty("effectiveLevel");
  });

  it("refuses a state whose mini-level contradicts its level", async () => {
    const fake = createFakeSupabase({ learner_states: { data: stateRow } });

    const result = await createLearnerRepository(fake.client).upsertState({
      learnerId: LEARNER,
      selectedLevel: "B1",
      estimatedLevel: "A2",
      effectiveLevel: { cefr: "A2", plus: false },
      miniLevel: 60,
      furthestMiniLevel: 60,
      skippedMiniLevels: [],
      fluency: 0.4,
      comprehension: 0.6,
      confidence: 0.5,
      updatedAt: new Date(),
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    expect(fake.calls).toEqual([]);
  });
});
