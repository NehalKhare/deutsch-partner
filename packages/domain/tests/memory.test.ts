import { describe, expect, it } from "vitest";
import {
  isSafeToStoreAsMemory,
  learnerMemorySchema,
} from "../src/memory";

const base = {
  id: "77777777-7777-4777-8777-777777777777",
  learnerId: "11111111-1111-4111-8111-111111111111",
  salience: 0.7,
  createdAt: "2026-08-20T10:00:00.000Z",
};

describe("learnerMemorySchema", () => {
  it.each([
    ["interest", { content: "Enjoys cycling in the Alps" }],
    ["goal", { content: "Wants to work in Vienna" }],
    ["preference", { content: "Prefers correction after the sentence" }],
    ["achievement", { content: "First full conversation without English" }],
    ["fact", { content: "Has a sister in Hamburg" }],
  ])("accepts a %s memory", (kind, extra) => {
    expect(learnerMemorySchema.parse({ ...base, kind, ...extra }).kind).toBe(
      kind,
    );
  });

  it("links a recurring-error memory to the structured error record", () => {
    const parsed = learnerMemorySchema.parse({
      ...base,
      kind: "recurring_error",
      content: "Keeps putting the verb third",
      learnerErrorId: "33333333-3333-4333-8333-333333333333",
    });

    if (parsed.kind !== "recurring_error") throw new Error("wrong kind");
    expect(parsed.learnerErrorId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("rejects a recurring-error memory with no linked error record", () => {
    expect(
      learnerMemorySchema.safeParse({
        ...base,
        kind: "recurring_error",
        content: "Keeps putting the verb third",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown memory kind", () => {
    expect(
      learnerMemorySchema.safeParse({
        ...base,
        kind: "gossip",
        content: "something",
      }).success,
    ).toBe(false);
  });

  it("rejects salience outside the unit interval", () => {
    expect(
      learnerMemorySchema.safeParse({
        ...base,
        kind: "fact",
        content: "x",
        salience: 2,
      }).success,
    ).toBe(false);
  });
});

describe("isSafeToStoreAsMemory", () => {
  /**
   * The prompt tells the model not to propose credentials as memories. This is
   * the independent application-side filter that does not trust it, per
   * security-observability-guardrails.md S15.
   */
  it("accepts ordinary learning content", () => {
    expect(isSafeToStoreAsMemory("Enjoys cycling in the Alps")).toBe(true);
  });

  it.each([
    "My password is hunter2",
    "sk_live_51H8xQ2abcdefghijklmnop",
    "sb_secret_abc123def456ghijkl",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig",
    "Card 4111 1111 1111 1111",
    "Mein PIN ist 4321",
    "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
  ])("refuses to store %o", (content) => {
    expect(isSafeToStoreAsMemory(content)).toBe(false);
  });

  it("is not fooled by casing", () => {
    expect(isSafeToStoreAsMemory("My PASSWORD is hunter2")).toBe(false);
  });

  it("does not reject a legitimate mention of a number", () => {
    expect(isSafeToStoreAsMemory("Lives at number 12, learning since 2024")).toBe(
      true,
    );
  });
});
