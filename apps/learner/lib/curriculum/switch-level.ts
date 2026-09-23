import { z } from "zod";

import { cefrLevelSchema } from "@dp/domain/cefr";

/**
 * Choosing a level.
 *
 * Schema, state and messages live here rather than beside the action, because
 * a "use server" module may export only async functions.
 */

export const switchLevelSchema = z.strictObject({ level: cefrLevelSchema });

export const SWITCH_LEVEL_MESSAGES = {
  invalid_input: "That is not a level this teaches.",
  unavailable: "We could not move you just now. Please try again.",
} as const;

export interface SwitchLevelState {
  readonly message: string | null;
  readonly status: "idle" | "error";
}

export const INITIAL_SWITCH_LEVEL_STATE: SwitchLevelState = {
  message: null,
  status: "idle",
};

export function switchLevelError(
  kind: keyof typeof SWITCH_LEVEL_MESSAGES,
): SwitchLevelState {
  return { status: "error", message: SWITCH_LEVEL_MESSAGES[kind] };
}

export type SwitchLevelAction = (
  state: SwitchLevelState,
  formData: FormData,
) => Promise<SwitchLevelState>;

export type SwitchLevelParseResult =
  | { readonly success: true; readonly level: "A1" | "A2" | "B1" }
  | { readonly success: false };

export function parseSwitchLevelForm(formData: FormData): SwitchLevelParseResult {
  const parsed = switchLevelSchema.safeParse({ level: formData.get("level") });

  return parsed.success
    ? { success: true, level: parsed.data.level }
    : { success: false };
}
