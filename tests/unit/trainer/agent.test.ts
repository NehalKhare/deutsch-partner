import { describe, expect, it } from "vitest";

import { AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { runTrainerTurn } from "@/lib/trainer/agent";
import {
  FakeToolCallingModel,
  toolCallMessage,
} from "../../support/fake-tool-calling-model";

/**
 * The agent loop's prompt-cache marks.
 *
 * OpenRouter forwards cache_control content marks to Anthropic models, and the
 * loop re-sends the same prefix on every one of its up-to-seven invocations,
 * so the marks are where most of the Trainer's input spend comes back from.
 * They are keyed on the candidate's provider: a mark sent to another vendor
 * would at best be ignored and at worst refused, so the same turn against a
 * fallback model must produce plain string content.
 */

const HISTORY = [
  { role: "user" as const, content: "Hallo!" },
  { role: "assistant" as const, content: "Guten Tag! Bereit für die Übung?" },
];

const markOf = (message: BaseMessage): unknown =>
  Array.isArray(message.content)
    ? (message.content[0] as { cache_control?: unknown }).cache_control
    : undefined;

const textOf = (message: BaseMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
        .join("");

describe("prompt-cache marks on an anthropic candidate", () => {
  async function run() {
    const model = new FakeToolCallingModel([new AIMessage("Gern!")]);
    const outcome = await runTrainerTurn(
      { models: [{ model, cacheMarks: true }], tools: [] },
      { message: "Weiter bitte", history: HISTORY },
    );
    return { model, outcome };
  }

  it("still runs the turn to a reply", async () => {
    const { outcome } = await run();

    expect(outcome).toMatchObject({ ok: true, data: { reply: "Gern!" } });
  });

  it("marks the system prompt without changing what it says", async () => {
    const { model } = await run();

    const [system] = model.seen[0];
    expect(system).toBeInstanceOf(SystemMessage);
    expect(markOf(system)).toEqual({ type: "ephemeral" });
    expect(textOf(system)).toContain("Deutsch Partner");
  });

  it("marks the last history message and the current one, nothing between", async () => {
    const { model } = await run();

    // What the model saw: system, both history lines, the current message.
    const seen = model.seen[0];
    const [firstHistory, lastHistory, current] = seen.slice(1);

    expect(markOf(firstHistory)).toBeUndefined();
    expect(typeof firstHistory.content).toBe("string");
    expect(markOf(lastHistory)).toEqual({ type: "ephemeral" });
    expect(textOf(lastHistory)).toBe("Guten Tag! Bereit für die Übung?");
    expect(markOf(current)).toEqual({ type: "ephemeral" });
    expect(textOf(current)).toBe("Weiter bitte");
  });

  it("survives a first turn, when there is no history to mark", async () => {
    const model = new FakeToolCallingModel([new AIMessage("Hallo!")]);
    const outcome = await runTrainerTurn(
      { models: [{ model, cacheMarks: true }], tools: [] },
      { message: "Hallo", history: [] },
    );

    expect(outcome.ok).toBe(true);
    expect(model.seen[0]).toHaveLength(2);
  });
});

describe("the review receipt", () => {
  it("says what was recorded when one call closed an item and advanced", async () => {
    const review = tool(
      async () =>
        JSON.stringify({
          record: { recorded: true, subject: "fahren", outcome: "correct" },
          completed: 1,
          remaining: 3,
          next: null,
          sessionComplete: false,
        }),
      { name: "get_review_session", description: "scripted", schema: z.object({}) },
    );
    const model = new FakeToolCallingModel([
      toolCallMessage("get_review_session", {}),
      new AIMessage("Richtig!"),
    ]);

    const outcome = await runTrainerTurn(
      { models: [{ model, cacheMarks: false }], tools: [review] },
      { message: "fahren", history: [] },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.steps[0]).toEqual({
      tool: "get_review_session",
      summary: "“fahren” — correct · 3 items to go, 1 done",
    });
  });
});

describe("any other vendor", () => {
  it("sees no cache mark anywhere in the turn", async () => {
    const model = new FakeToolCallingModel([new AIMessage("Gern!")]);
    const outcome = await runTrainerTurn(
      { models: [{ model, cacheMarks: false }], tools: [] },
      { message: "Weiter bitte", history: HISTORY },
    );

    expect(outcome.ok).toBe(true);
    for (const message of model.seen[0]) {
      // The agent framework may re-shape content into blocks on its own; what
      // must never appear for a non-Anthropic model is the marker itself.
      expect(markOf(message)).toBeUndefined();
    }
    // And the conversation itself stays in the plain string form it arrived in.
    const [, ...conversation] = model.seen[0];
    for (const message of conversation) {
      expect(typeof message.content).toBe("string");
    }
  });
});
