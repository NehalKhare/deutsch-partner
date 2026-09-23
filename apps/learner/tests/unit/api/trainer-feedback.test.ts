import { describe, expect, it } from "vitest";

import {
  defaultCoachingProfile,
  type TrainerCoachingProfile,
  type TrainerFeedback,
} from "@dp/domain/trainer-coaching";
import { TRAINER_PROMPT_VERSION } from "@dp/prompts/trainer";
import {
  TRAINER_FEEDBACK_ERRORS,
  handleTrainerFeedback,
  trainerFeedbackErrorResponse,
  trainerFeedbackRequestSchema,
  type TrainerFeedbackDeps,
} from "@/lib/api/trainer-feedback";
import { createLogger } from "@dp/observability/logger";
import type { TrainerCoachingRepository } from "@dp/db/trainer-coaching-repository";

/**
 * The feedback endpoint's logic.
 *
 * What is asserted is the composition: a vote reads the profile, folds in by
 * the rules, writes the profile back, records the vote, and tells the learner
 * what moved — with no model anywhere, no learner id in the payload, and the
 * learner's words kept out of every log line.
 */

const IDENTITY = {
  learnerId: "11111111-1111-4111-8111-111111111111",
  userIdHash: "hash-alice",
  requestId: "33333333-3333-4333-8333-333333333333",
};
const VOTE_ID = "44444444-4444-4444-8444-444444444444";
const AT = new Date("2026-09-14T12:00:00.000Z");

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = () => ({
  ok: false as const,
  error: { kind: "unavailable" as const, message: "no", name: "RepositoryError" },
});

function fakeDeps(options: {
  profile?: Partial<TrainerCoachingProfile> | null;
  upsertFails?: boolean;
  recordFails?: boolean;
  getThrows?: boolean;
} = {}) {
  const saved: TrainerCoachingProfile[] = [];
  const recorded: TrainerFeedback[] = [];
  const logged: Array<Record<string, unknown>> = [];

  const coaching = {
    getProfile: async () => {
      if (options.getThrows) throw new Error("down");
      return ok(
        options.profile === null || options.profile === undefined
          ? null
          : { ...defaultCoachingProfile(IDENTITY.learnerId, AT), ...options.profile },
      );
    },
    upsertProfile: async (profile: TrainerCoachingProfile) => {
      if (options.upsertFails) return fail();
      saved.push(profile);
      return ok(profile);
    },
    recordFeedback: async (feedback: TrainerFeedback) => {
      if (options.recordFails) return fail();
      recorded.push(feedback);
      return ok(feedback);
    },
  } as unknown as TrainerCoachingRepository;

  const deps: TrainerFeedbackDeps = {
    coaching,
    newId: () => VOTE_ID,
    now: () => AT,
    logger: createLogger({
      sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
    }),
  };

  return { deps, saved, recorded, logged };
}

describe("the request body", () => {
  it("accepts a bare verdict and defaults the rest", () => {
    expect(trainerFeedbackRequestSchema.parse({ verdict: "helpful" })).toEqual({
      verdict: "helpful",
      reasons: [],
      note: null,
      tools: [],
    });
  });

  it("turns an empty note into no note", () => {
    expect(trainerFeedbackRequestSchema.parse({ verdict: "unhelpful", note: "   " }).note).toBeNull();
  });

  it("refuses an unknown reason, a repeated one, and a stray field", () => {
    expect(
      trainerFeedbackRequestSchema.safeParse({ verdict: "unhelpful", reasons: ["rude"] }).success,
    ).toBe(false);
    expect(
      trainerFeedbackRequestSchema.safeParse({
        verdict: "unhelpful",
        reasons: ["too_long", "too_long"],
      }).success,
    ).toBe(false);
    expect(
      trainerFeedbackRequestSchema.safeParse({ verdict: "helpful", learnerId: "x" }).success,
    ).toBe(false);
  });

  it("refuses a tool name that is not a slug, and a note past the cap", () => {
    expect(
      trainerFeedbackRequestSchema.safeParse({ verdict: "helpful", tools: ["<script>"] }).success,
    ).toBe(false);
    expect(
      trainerFeedbackRequestSchema.safeParse({ verdict: "helpful", note: "x".repeat(241) })
        .success,
    ).toBe(false);
  });
});

describe("a vote", () => {
  it("folds into a new profile, records itself, and says what moved", async () => {
    const { deps, saved, recorded } = fakeDeps({ profile: null });

    const result = await handleTrainerFeedback(
      {
        verdict: "unhelpful",
        reasons: ["too_long", "skip_news"],
        note: "Shorter, please",
        tools: ["get_review_session", "record_review_outcome"],
      },
      IDENTITY,
      deps,
    );

    expect(result).toEqual({
      ok: true,
      payload: {
        coaching: {
          explanationDepth: "brief",
          challenge: "standard",
          sessionLength: "standard",
          focus: "balanced",
          news: false,
        },
        changed: [
          { dial: "explanationDepth", from: "standard", to: "brief" },
          { dial: "news", from: true, to: false },
        ],
        noteDropped: false,
      },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ learnerId: IDENTITY.learnerId, unhelpfulCount: 1 });
    expect(recorded).toEqual([
      {
        id: VOTE_ID,
        learnerId: IDENTITY.learnerId,
        verdict: "unhelpful",
        reasons: ["too_long", "skip_news"],
        note: "Shorter, please",
        tools: ["get_review_session", "record_review_outcome"],
        promptVersion: TRAINER_PROMPT_VERSION,
        createdAt: AT,
      },
    ]);
  });

  it("builds on the profile the learner already has", async () => {
    const { deps, saved } = fakeDeps({ profile: { explanationDepth: "brief" } });

    const result = await handleTrainerFeedback(
      { verdict: "unhelpful", reasons: ["too_long"] },
      IDENTITY,
      deps,
    );

    // Already brief: the end of the scale holds, and the response says so.
    expect(result.ok && result.payload.changed).toEqual([]);
    expect(saved[0]?.explanationDepth).toBe("brief");
    expect(saved[0]?.unhelpfulCount).toBe(1);
  });

  it("keeps a helpful vote as a count and nothing else", async () => {
    const { deps, saved, recorded } = fakeDeps({ profile: {} });

    const result = await handleTrainerFeedback({ verdict: "helpful" }, IDENTITY, deps);

    expect(result.ok && result.payload.changed).toEqual([]);
    expect(saved[0]).toMatchObject({ helpfulCount: 1, unhelpfulCount: 0 });
    expect(recorded[0]).toMatchObject({ verdict: "helpful", reasons: [], note: null });
  });

  it("drops a note that looks like a secret and says so, keeping the vote", async () => {
    const { deps, recorded, logged } = fakeDeps({ profile: {} });

    const result = await handleTrainerFeedback(
      { verdict: "unhelpful", reasons: ["unclear"], note: "my password is hunter2" },
      IDENTITY,
      deps,
    );

    expect(result.ok && result.payload.noteDropped).toBe(true);
    expect(recorded[0]?.note).toBeNull();
    expect(JSON.stringify(logged)).not.toContain("hunter2");
  });

  it("audits the verdict and the dials, never the note", async () => {
    const { deps, logged } = fakeDeps({ profile: {} });

    await handleTrainerFeedback(
      { verdict: "unhelpful", reasons: ["too_hard"], note: "the dative example lost me" },
      IDENTITY,
      deps,
    );

    const audit = logged.find((line) => line.event === "trainer.feedback_recorded");
    expect(audit).toMatchObject({
      audit: true,
      verdict: "unhelpful",
      reasons: ["too_hard"],
      changed: ["challenge"],
      noted: true,
      userIdHash: IDENTITY.userIdHash,
    });
    expect(JSON.stringify(logged)).not.toContain("dative example");
    expect(JSON.stringify(logged)).not.toContain(IDENTITY.learnerId);
  });

  it("carries no learner id in the payload", async () => {
    const { deps } = fakeDeps({ profile: {} });

    const result = await handleTrainerFeedback({ verdict: "helpful" }, IDENTITY, deps);

    expect(JSON.stringify(result)).not.toContain(IDENTITY.learnerId);
  });
});

describe("when something fails", () => {
  it("rejects a body that is not a vote without touching the repository", async () => {
    const { deps, saved } = fakeDeps({ profile: {} });

    const result = await handleTrainerFeedback({ verdict: "meh" }, IDENTITY, deps);

    expect(result).toEqual({ ok: false, error: "invalid_body" });
    expect(saved).toHaveLength(0);
  });

  it("is unavailable when the profile cannot be read", async () => {
    const { deps } = fakeDeps({ getThrows: true });

    expect(await handleTrainerFeedback({ verdict: "helpful" }, IDENTITY, deps)).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("is unavailable when the profile cannot be written, and records no vote", async () => {
    const { deps, recorded } = fakeDeps({ profile: {}, upsertFails: true });

    expect(
      await handleTrainerFeedback({ verdict: "unhelpful", reasons: ["too_long"] }, IDENTITY, deps),
    ).toEqual({ ok: false, error: "unavailable" });
    expect(recorded).toHaveLength(0);
  });

  it("still answers with the adjusted dials when only the record fails, and says so in the log", async () => {
    const { deps, logged } = fakeDeps({ profile: {}, recordFails: true });

    const result = await handleTrainerFeedback(
      { verdict: "unhelpful", reasons: ["too_long"] },
      IDENTITY,
      deps,
    );

    expect(result.ok && result.payload.coaching.explanationDepth).toBe("brief");
    expect(logged.some((line) => line.event === "trainer.feedback_unrecorded")).toBe(true);
  });
});

describe("what a learner is told", () => {
  it.each(TRAINER_FEEDBACK_ERRORS)("gives %s a status and a plain message", (error) => {
    const response = trainerFeedbackErrorResponse(error);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.message.length).toBeGreaterThan(10);
    expect(response.message).not.toMatch(/repository|postgres|rls|token/i);
  });
});
