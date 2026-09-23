import { describe, expect, it } from "vitest";

import {
  TRAILER_DELIMITER,
  encodeChatTrailer,
  splitChatStream,
} from "@/lib/api/chat-trailer";

/**
 * The stream's one piece of framing.
 *
 * The property that matters most: whatever arrives — no trailer, half a
 * trailer, a mangled trailer — the reply comes back intact. The tally is a
 * nicety; the tutor's German is the product.
 */

const TALLY = { miniLevel: 26, turns: 3, strongTurns: 2 };

describe("a round trip", () => {
  it("returns the reply and the tally it was sent with", () => {
    const raw = `Guten Tag!${encodeChatTrailer({ tally: TALLY })}`;

    expect(splitChatStream(raw)).toEqual({
      reply: "Guten Tag!",
      trailer: { tally: TALLY },
    });
  });

  it("refuses to encode a tally the schema would not accept", () => {
    expect(() =>
      encodeChatTrailer({
        tally: { miniLevel: 26, turns: -1, strongTurns: 0 },
      }),
    ).toThrow();
  });
});

describe("streams that are not finished or not well-formed", () => {
  it("treats a stream with no delimiter as all reply", () => {
    expect(splitChatStream("Guten Tag!")).toEqual({
      reply: "Guten Tag!",
      trailer: null,
    });
  });

  it("keeps the reply when the trailer has only half arrived", () => {
    // Mid-stream the delimiter can be in and the JSON still coming. The
    // learner's text must already be clean of both.
    const raw = `Guten Tag!${TRAILER_DELIMITER}{"tally":{"miniLev`;

    expect(splitChatStream(raw)).toEqual({ reply: "Guten Tag!", trailer: null });
  });

  it("drops a trailer that parses but is not the expected shape", () => {
    const raw = `Guten Tag!${TRAILER_DELIMITER}{"anything":"else"}`;

    expect(splitChatStream(raw)).toEqual({ reply: "Guten Tag!", trailer: null });
  });

  it("splits at the first delimiter, whatever follows", () => {
    const raw = `Hallo${TRAILER_DELIMITER}garbage${TRAILER_DELIMITER}more`;

    expect(splitChatStream(raw).reply).toBe("Hallo");
    expect(splitChatStream(raw).trailer).toBeNull();
  });

  it("handles an empty stream", () => {
    expect(splitChatStream("")).toEqual({ reply: "", trailer: null });
  });
});
