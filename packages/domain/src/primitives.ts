import { z } from "zod";

/** Shared value types used across the domain. */

export const uuidSchema = z.uuid();

/**
 * Accepts either a Date or an ISO-8601 string and always yields a Date, so
 * domain code never has to care whether a value arrived from the database, a
 * JSON request body, or a model response.
 */
export const timestampSchema = z.union([
  z.date(),
  z.iso.datetime().transform((value) => new Date(value)),
]);

/** A normalised score. Every proportion in the domain uses this scale. */
export const unitIntervalSchema = z.number().min(0).max(1);

export const nonEmptyTextSchema = (max: number) =>
  z.string().trim().min(1).max(max);

export type Timestamp = z.infer<typeof timestampSchema>;
