import { z } from "zod";

/**
 * A Trainer session's memory of itself.
 *
 * The trainer endpoint is stateless by design — the transcript lives in the
 * browser, and so does the session's progress. What the client sends back up
 * each turn is therefore not content but keys: the subjects the trainer has
 * already worked through in this sitting.
 *
 * Keys are what makes that safe to accept from a client. The server uses them
 * to *exclude* items from the agenda and never to build a prompt, so the only
 * thing a tampered list can do is shorten someone's own practice, and every
 * word the model reads is still one the database just handed it.
 *
 * Lives in the domain because both sides of the wire hold it, exactly like
 * HISTORY_WINDOW: the client caps what it sends and the server refuses a body
 * that claims more.
 */

/** How many items one agenda offers. A session, not a syllabus. */
export const MAX_AGENDA_ITEMS = 8;

/**
 * How many subjects a session may remember as finished.
 *
 * Bounds the request body, and with it how long one sitting can run before
 * the agenda starts again from whatever is still due — several agendas' worth,
 * which is more practice than a sitting holds.
 */
export const MAX_COVERED_SUBJECTS = 40;

/** A subject is a key: a word as the learner sees it, or an error type. */
export const coveredSubjectSchema = z.string().trim().min(1).max(96);

export const coveredSubjectsSchema = z
  .array(coveredSubjectSchema)
  .max(MAX_COVERED_SUBJECTS)
  .default([]);

/**
 * The agenda the session opened with, sent back up each turn.
 *
 * Keys again, exactly like the covered list: the server resolves each subject
 * against what the database holds right now and drops what no longer resolves,
 * so a tampered pin can only rearrange or shorten someone's own practice. What
 * pinning buys is a promise kept — the plan announced in the first reply is
 * the plan the session works through, instead of being recomposed from the
 * whole backlog every call, which refilled finished items' slots with new
 * words and pushed the closing news item forever out of reach.
 */
export const pinnedAgendaSchema = z
  .array(
    z.strictObject({
      /** A display kind, never resolved server-side. Bounded, slug-shaped. */
      kind: z
        .string()
        .trim()
        .min(1)
        .max(32)
        .regex(/^[a-z][a-z0-9_]*$/u),
      subject: coveredSubjectSchema,
    }),
  )
  .max(MAX_AGENDA_ITEMS);
