import { describe, expect, it } from "vitest";

import { collectGuarded, guardStream } from "@/lib/ai/gateway/stream-guard";
import { estimateTokens } from "@/lib/ai/prompts/tokens";

async function* chunks(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}

/** A provider that ignores max_tokens and keeps going. */
async function* runaway(chunk: string, times: number): AsyncGenerator<string> {
  for (let index = 0; index < times; index += 1) yield chunk;
}

describe("stream guard", () => {
  it("passes a stream inside the ceiling through unchanged", async () => {
    const guard = guardStream(chunks("Guten ", "Tag, ", "wie geht es dir?"), {
      maxOutputTokens: 100,
    });

    const emitted: string[] = [];
    for await (const chunk of guard.stream) emitted.push(chunk);

    expect(emitted.join("")).toBe("Guten Tag, wie geht es dir?");
    expect(guard.result().truncated).toBe(false);
    expect(guard.result().outputTokens).toBe(
      estimateTokens("Guten Tag, wie geht es dir?"),
    );
  });

  it("aborts a provider that overruns the ceiling", async () => {
    const abort = new AbortController();
    const guard = guardStream(runaway("wort wort wort ", 500), {
      maxOutputTokens: 20,
      abort,
    });

    const result = await collectGuarded(guard);

    expect(result.truncated).toBe(true);
    expect(result.outputTokens).toBeLessThanOrEqual(20);
    expect(abort.signal.aborted).toBe(true);
  });

  it("stops pulling from the source once the ceiling is reached", async () => {
    let pulled = 0;
    async function* counted(): AsyncGenerator<string> {
      for (let index = 0; index < 1000; index += 1) {
        pulled += 1;
        yield "wort wort wort wort ";
      }
    }

    await collectGuarded(guardStream(counted(), { maxOutputTokens: 15 }));

    expect(pulled).toBeGreaterThan(0);
    expect(pulled).toBeLessThan(20);
  });

  it("keeps what the model did produce rather than discarding the whole reply", async () => {
    const guard = guardStream(chunks("Ich heiße Anna. ", "Und du? ".repeat(200)), {
      maxOutputTokens: 12,
    });

    const result = await collectGuarded(guard);

    expect(result.text).toContain("Ich heiße Anna.");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("keeps the part that fits when the whole reply arrives as one chunk", async () => {
    // A provider that streams in one large piece is the case where dropping
    // the overrunning chunk loses the entire reply rather than its tail.
    const guard = guardStream(chunks("Wort für Wort. ".repeat(200)), {
      maxOutputTokens: 15,
    });

    const result = await collectGuarded(guard);

    expect(result.truncated).toBe(true);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.text).toContain("Wort für Wort.");
  });

  it("emits exactly the text it reports", async () => {
    const guard = guardStream(runaway("Satz mit mehreren Wörtern. ", 100), {
      maxOutputTokens: 25,
    });

    const emitted: string[] = [];
    for await (const chunk of guard.stream) emitted.push(chunk);

    expect(emitted.join("")).toBe(guard.result().text);
  });

  it("does not flag a stream that ends on the ceiling", async () => {
    const text = "wort ".repeat(10).trim();
    const guard = guardStream(chunks(text), {
      maxOutputTokens: estimateTokens(text),
    });

    const result = await collectGuarded(guard);

    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });

  it("handles an empty stream without claiming truncation", async () => {
    const result = await collectGuarded(guardStream(chunks(), { maxOutputTokens: 50 }));

    expect(result).toMatchObject({ text: "", outputTokens: 0, truncated: false });
  });

  it("reports nothing until the stream has been consumed", () => {
    const guard = guardStream(chunks("hallo"), { maxOutputTokens: 10 });

    expect(guard.result()).toMatchObject({ text: "", truncated: false });
  });
});
