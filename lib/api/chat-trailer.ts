import { z } from "zod";

import { miniLevelSchema } from "@/domain/cefr";

/**
 * The chat stream's one piece of framing.
 *
 * The reply streams as plain UTF-8 prose, and that stays true: this module
 * adds a single trailer after the last word — a NUL byte and one JSON object —
 * carrying the level tally the turn just wrote. The tally exists only once the
 * after-stream work has run, which is after the headers are long gone, so it
 * has to ride the stream itself.
 *
 * NUL as the delimiter because it is the one byte German prose cannot contain:
 * it is not printable, no keyboard writes it, and the stream strips it from
 * model text anyway before this trailer is appended. A client that predates
 * the trailer renders an invisible character and some JSON at worst; one that
 * knows it splits at the first NUL and never shows the learner either.
 *
 * Shared by the route and the page on purpose, and kept a leaf so the client
 * bundle gets a schema and two functions rather than the server's graph.
 */

export const TRAILER_DELIMITER = "\u0000";

export const chatTrailerSchema = z.strictObject({
  /** The tally after this turn, exactly as the mastery gate will read it. */
  tally: z.strictObject({
    miniLevel: miniLevelSchema,
    turns: z.number().int().min(0),
    strongTurns: z.number().int().min(0),
  }),
});

export type ChatTrailer = z.infer<typeof chatTrailerSchema>;

export function encodeChatTrailer(trailer: ChatTrailer): string {
  return TRAILER_DELIMITER + JSON.stringify(chatTrailerSchema.parse(trailer));
}

/**
 * The reply and the trailer, from however much of the stream has arrived.
 *
 * Safe to call mid-stream: before the delimiter arrives the whole text is
 * reply, and a half-arrived trailer parses as nothing rather than as an error.
 * A trailer that is not valid JSON in the expected shape is dropped the same
 * way — the reply is the part a learner must never lose to bad framing.
 */
export function splitChatStream(raw: string): {
  readonly reply: string;
  readonly trailer: ChatTrailer | null;
} {
  const at = raw.indexOf(TRAILER_DELIMITER);
  if (at === -1) return { reply: raw, trailer: null };

  const reply = raw.slice(0, at);
  try {
    const parsed = chatTrailerSchema.safeParse(JSON.parse(raw.slice(at + 1)));
    return { reply, trailer: parsed.success ? parsed.data : null };
  } catch {
    return { reply, trailer: null };
  }
}
