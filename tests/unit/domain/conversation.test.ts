import { describe, expect, it } from "vitest";
import {
  CONVERSATION_MODES,
  HISTORY_WINDOW,
  MAX_MESSAGE_LENGTH,
  conversationThreadSchema,
  transcriptMessageSchema,
} from "@/domain/conversation";

const thread = {
  id: "55555555-5555-4555-8555-555555555555",
  learnerId: "11111111-1111-4111-8111-111111111111",
  title: "Weekend plans",
  topic: "daily life",
  cefr: "A2",
  miniLevel: 20,
  mode: "free_chat",
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:30:00.000Z",
};

describe("conversationThreadSchema", () => {
  it("accepts a valid thread", () => {
    expect(conversationThreadSchema.parse(thread).mode).toBe("free_chat");
  });

  it("supports the designed conversation modes", () => {
    expect(CONVERSATION_MODES).toEqual(
      expect.arrayContaining([
        "free_chat",
        "roleplay",
        "review",
        "assessment",
        "grammar_practice",
      ]),
    );
  });

  it("rejects an unknown mode", () => {
    expect(
      conversationThreadSchema.safeParse({ ...thread, mode: "banter" }).success,
    ).toBe(false);
  });

  it("rejects an update timestamp earlier than creation", () => {
    expect(
      conversationThreadSchema.safeParse({
        ...thread,
        updatedAt: "2026-08-19T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("transcriptMessageSchema", () => {
  /**
   * A transcript line is client memory being resent, not a stored record: the
   * schema is what stands between a network body and the prompt.
   */
  const line = { role: "user", content: "Ich gehe morgen ins Kino." };

  it.each(["user", "assistant"])("accepts role %s", (role) => {
    expect(transcriptMessageSchema.parse({ ...line, role }).role).toBe(role);
  });

  it("rejects a system role, so history cannot smuggle instructions", () => {
    expect(
      transcriptMessageSchema.safeParse({ ...line, role: "system" }).success,
    ).toBe(false);
  });

  it("rejects an empty line", () => {
    expect(
      transcriptMessageSchema.safeParse({ ...line, content: "   " }).success,
    ).toBe(false);
  });

  it("rejects a line beyond the message ceiling", () => {
    expect(
      transcriptMessageSchema.safeParse({
        ...line,
        content: "a".repeat(MAX_MESSAGE_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects any field beyond role and content", () => {
    // Ids, timestamps and corrections are client bookkeeping; a strict shape
    // means a request cannot carry anything the prompt would not render.
    expect(
      transcriptMessageSchema.safeParse({ ...line, id: "m-1" }).success,
    ).toBe(false);
  });

  it("keeps the window small enough to be a context budget", () => {
    expect(HISTORY_WINDOW).toBeGreaterThan(0);
    expect(HISTORY_WINDOW).toBeLessThanOrEqual(20);
  });
});
