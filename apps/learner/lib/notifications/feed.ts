import { markReadTargetSchema, type MarkReadTarget } from "@dp/domain/notifications";

/**
 * The feed's helpers, as this app names them: the shape comes from the
 * repository (both products build it the same way), and the form on the
 * full page is read here.
 */
export { EMPTY_FEED, feedFrom } from "@dp/db/notifications-repository";

export const markTargetSchema = markReadTargetSchema;
export type MarkTarget = MarkReadTarget;

/** The form on the full page: `all`, or one id per `id` field. */
export function markTargetFromForm(formData: FormData): MarkTarget | null {
  if (formData.get("all") === "1") return "all";
  const ids = formData.getAll("id").filter((value): value is string => typeof value === "string");
  const parsed = markTargetSchema.safeParse(ids);
  return parsed.success ? parsed.data : null;
}
