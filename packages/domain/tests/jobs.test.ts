import { describe, expect, it } from "vitest";

import {
  JOB_KINDS,
  dedupeKeyFor,
  jobPayloadSchema,
  queueFor,
  retryDelaySeconds,
} from "../src/jobs";

const CORRELATION = "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const RUN = "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f";

describe("the job envelope", () => {
  it("accepts every kind with its defaults filled in", () => {
    const drive = jobPayloadSchema.parse({
      kind: "productops.drive",
      runId: RUN,
      correlationId: CORRELATION,
      source: "ops",
    });
    const fx = jobPayloadSchema.parse({ kind: "fx.refresh", correlationId: CORRELATION, source: "scheduler" });
    const prune = jobPayloadSchema.parse({ kind: "checkpoints.prune", correlationId: CORRELATION, source: "scheduler" });

    expect(drive).toMatchObject({ review: null });
    expect(fx).toMatchObject({ force: false });
    expect(prune).toMatchObject({ olderThanDays: 30 });
  });

  it("rejects an unknown kind, a missing correlation id and an extra field", () => {
    expect(jobPayloadSchema.safeParse({ kind: "rm.rf", correlationId: CORRELATION, source: "ops" }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ kind: "fx.refresh", source: "ops" }).success).toBe(false);
    expect(
      jobPayloadSchema.safeParse({ kind: "fx.refresh", correlationId: CORRELATION, source: "ops", shell: "sh" }).success,
    ).toBe(false);
  });

  it("puts the implementation job on its own queue", () => {
    for (const kind of JOB_KINDS) {
      expect(queueFor(kind)).toBe(kind === "productops.implement" ? "coder" : "jobs");
    }
  });

  it("dedupes per run, per proposal, or per kind", () => {
    expect(
      dedupeKeyFor(jobPayloadSchema.parse({ kind: "productops.drive", runId: RUN, correlationId: CORRELATION, source: "ops" })),
    ).toBe(`productops.drive:${RUN}`);
    expect(
      dedupeKeyFor(jobPayloadSchema.parse({ kind: "fx.refresh", correlationId: CORRELATION, source: "scheduler" })),
    ).toBe("fx.refresh");
  });

  it("backs off exponentially and stops growing", () => {
    expect([1, 2, 3, 4, 5, 10].map(retryDelaySeconds)).toEqual([15, 30, 60, 120, 240, 600]);
  });
});
