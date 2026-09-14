import { describe, expect, it } from "vitest";

import { defaultCoachingProfile } from "@/domain/trainer-coaching";
import { createTrainerCoachingRepository } from "@/repositories/trainer-coaching-repository";
import { createFakeSupabase } from "../../support/fake-supabase";

const LEARNER = "11111111-1111-4111-8111-111111111111";
const VOTE_ID = "44444444-4444-4444-8444-444444444444";
const AT = new Date("2026-09-14T12:00:00.000Z");

const profileRow = {
  learner_id: LEARNER,
  explanation_depth: "brief",
  challenge: "standard",
  session_length: "short",
  focus: "balanced",
  news_enabled: true,
  disputed_corrections: 1,
  helpful_count: 3,
  unhelpful_count: 2,
  updated_at: "2026-09-14T12:00:00.000Z",
};

const feedbackRow = {
  id: VOTE_ID,
  learner_id: LEARNER,
  verdict: "unhelpful",
  reasons: ["too_long"],
  note: "shorter please",
  tools: ["get_review_session"],
  prompt_version: 11,
  created_at: "2026-09-14T12:00:00.000Z",
};

describe("reading the profile", () => {
  it("decodes the learner's row into the domain shape", async () => {
    const fake = createFakeSupabase({ trainer_coaching_profiles: { data: profileRow } });

    const result = await createTrainerCoachingRepository(fake.client).getProfile(LEARNER);

    expect(result).toMatchObject({
      ok: true,
      data: {
        learnerId: LEARNER,
        explanationDepth: "brief",
        sessionLength: "short",
        news: true,
        disputedCorrections: 1,
        helpfulCount: 3,
      },
    });
    expect(fake.methodArgs("trainer_coaching_profiles", "eq")).toEqual([["learner_id", LEARNER]]);
  });

  it("answers null, not an error, for a learner with no row yet", async () => {
    const fake = createFakeSupabase({ trainer_coaching_profiles: { data: null } });

    const result = await createTrainerCoachingRepository(fake.client).getProfile(LEARNER);

    expect(result).toEqual({ ok: true, data: null });
  });

  it("refuses a row that drifted from the closed sets", async () => {
    const fake = createFakeSupabase({
      trainer_coaching_profiles: { data: { ...profileRow, focus: "everything" } },
    });

    const result = await createTrainerCoachingRepository(fake.client).getProfile(LEARNER);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("invalid_data");
  });

  it("refuses a learner id that is not one", async () => {
    const fake = createFakeSupabase({});

    const result = await createTrainerCoachingRepository(fake.client).getProfile("me");

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("writing the profile", () => {
  it("upserts on the learner id and maps every dial to its column", async () => {
    const fake = createFakeSupabase({ trainer_coaching_profiles: { data: profileRow } });
    const profile = {
      ...defaultCoachingProfile(LEARNER, AT),
      explanationDepth: "brief" as const,
      sessionLength: "short" as const,
    };

    const result = await createTrainerCoachingRepository(fake.client).upsertProfile(profile);

    expect(result.ok).toBe(true);
    const [row, options] = fake.methodArgs("trainer_coaching_profiles", "upsert")[0];
    expect(row).toEqual({
      learner_id: LEARNER,
      explanation_depth: "brief",
      challenge: "standard",
      session_length: "short",
      focus: "balanced",
      news_enabled: true,
      disputed_corrections: 0,
      helpful_count: 0,
      unhelpful_count: 0,
    });
    expect(options).toEqual({ onConflict: "learner_id" });
  });

  it("validates before it writes", async () => {
    const fake = createFakeSupabase({});

    const result = await createTrainerCoachingRepository(fake.client).upsertProfile({
      ...defaultCoachingProfile(LEARNER, AT),
      disputedCorrections: -1,
    });

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("recording a vote", () => {
  const vote = {
    id: VOTE_ID,
    learnerId: LEARNER,
    verdict: "unhelpful" as const,
    reasons: ["too_long" as const],
    note: "shorter please",
    tools: ["get_review_session"],
    promptVersion: 11,
    createdAt: AT,
  };

  it("inserts the vote with its arrays and reads the row back", async () => {
    const fake = createFakeSupabase({ trainer_feedback: { data: feedbackRow } });

    const result = await createTrainerCoachingRepository(fake.client).recordFeedback(vote);

    expect(result).toMatchObject({ ok: true, data: { id: VOTE_ID, reasons: ["too_long"] } });
    expect(fake.methodArgs("trainer_feedback", "insert")[0][0]).toEqual({
      id: VOTE_ID,
      learner_id: LEARNER,
      verdict: "unhelpful",
      reasons: ["too_long"],
      note: "shorter please",
      tools: ["get_review_session"],
      prompt_version: 11,
    });
  });

  it("refuses a note that looks like a credential before any query", async () => {
    const fake = createFakeSupabase({});

    const result = await createTrainerCoachingRepository(fake.client).recordFeedback({
      ...vote,
      note: "use api key sk-live-abcdefghijklmnopqrstuvwxyz",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("invalid_input");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the recent notes", () => {
  it("reads only the note column, newest first, skipping empty ones", async () => {
    const fake = createFakeSupabase({
      trainer_feedback: { data: [{ note: "newest" }, { note: null }, { note: "older" }] },
    });

    const result = await createTrainerCoachingRepository(fake.client).listRecentNotes(LEARNER, 3);

    expect(result).toEqual({ ok: true, data: ["newest", "older"] });
    expect(fake.methodArgs("trainer_feedback", "select")).toEqual([["note"]]);
    expect(fake.methodArgs("trainer_feedback", "order")).toEqual([
      ["created_at", { ascending: false }],
    ]);
    expect(fake.methodArgs("trainer_feedback", "limit")).toEqual([[3]]);
  });
});

describe("forgetting", () => {
  it("deletes the votes and then the profile, both by learner id", async () => {
    const fake = createFakeSupabase({});

    const result = await createTrainerCoachingRepository(fake.client).reset(LEARNER);

    expect(result).toEqual({ ok: true, data: null });
    expect(fake.calls.map((call) => call.table)).toEqual([
      "trainer_feedback",
      "trainer_coaching_profiles",
    ]);
    expect(fake.methodArgs("trainer_feedback", "eq")).toEqual([["learner_id", LEARNER]]);
    expect(fake.methodArgs("trainer_coaching_profiles", "eq")).toEqual([["learner_id", LEARNER]]);
  });

  it("stops at the first failure and says the profile is still there", async () => {
    const fake = createFakeSupabase({
      trainer_feedback: { error: { code: "XX000", message: "boom" } },
    });

    const result = await createTrainerCoachingRepository(fake.client).reset(LEARNER);

    expect(result.ok).toBe(false);
    expect(fake.calls.map((call) => call.table)).toEqual(["trainer_feedback"]);
  });
});
