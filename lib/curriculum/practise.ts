import { z } from "zod";

import { miniLevelSchema } from "@/domain/cefr";

/**
 * Picking a mini-level off the syllabus.
 *
 * Schema and parsing live here rather than beside the actions, because a
 * "use server" module may export only async functions. The value arrives from
 * a form a learner can edit, so it is coerced and then held to the same
 * schema the domain uses — anything off the path parses as a refusal, not as
 * a clamp.
 */

export const miniLevelFormSchema = z.strictObject({
  miniLevel: z.coerce.number().pipe(miniLevelSchema),
});

export type MiniLevelParseResult =
  | { readonly success: true; readonly miniLevel: number }
  | { readonly success: false };

export function parseMiniLevelForm(formData: FormData): MiniLevelParseResult {
  const parsed = miniLevelFormSchema.safeParse({
    miniLevel: formData.get("miniLevel"),
  });

  return parsed.success
    ? { success: true, miniLevel: parsed.data.miniLevel }
    : { success: false };
}
