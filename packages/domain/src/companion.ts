import { z } from "zod";

import {
  MAX_MINI_LEVEL,
  MIN_MINI_LEVEL,
  miniLevelSchema,
} from "./cefr";

/**
 * The learning companion.
 *
 * A single character that grows alongside the learner and reacts to what is
 * happening in the conversation. Its state is derived from learner progress,
 * so it lives in the domain: the component that draws it should render this
 * state, not compute it.
 */

export const COMPANION_EMOTIONS = ["smiling", "sad", "listening"] as const;
export const companionEmotionSchema = z.enum(COMPANION_EMOTIONS);
export type CompanionEmotion = z.infer<typeof companionEmotionSchema>;

export const COMPANION_ACTIVITIES = [
  "idle",
  "listening",
  "speaking",
  "struggling",
] as const;
export const companionActivitySchema = z.enum(COMPANION_ACTIVITIES);
export type CompanionActivity = z.infer<typeof companionActivitySchema>;

export const MAX_GROWTH_STAGE = 5;

export const companionStateSchema = z.object({
  emotion: companionEmotionSchema,
  /**
   * What the companion is doing, carried through to the drawing.
   *
   * The emotion says how the face is set; the activity says which ambient
   * performance is running. Idle gets its own — glances, a quirked smile, a
   * slow sway — because a tutor that sits perfectly still while the learner
   * thinks reads as a screenshot, not as somebody waiting with them.
   */
  activity: companionActivitySchema,
  /** Discrete size step, for silhouette and feature changes. */
  stage: z.number().int().min(1).max(MAX_GROWTH_STAGE),
  /** Continuous progress along the whole path, for smooth scaling. */
  progress: z.number().min(0).max(1),
  /** Whether the companion should be animating right now. */
  animated: z.boolean(),
});

export type CompanionState = z.infer<typeof companionStateSchema>;

/**
 * Progress from the first mini-level (0) to the last (1). Deliberately linear:
 * the learner should see the companion move after every mini-level, not sit
 * still through a long plateau.
 */
export function growthProgress(miniLevel: number): number {
  const parsed = miniLevelSchema.parse(miniLevel);
  return (parsed - MIN_MINI_LEVEL) / (MAX_MINI_LEVEL - MIN_MINI_LEVEL);
}

/**
 * The discrete growth step: five equal bands of fourteen mini-levels. Equal
 * bands mean the silhouette changes at a predictable rhythm, and the learner
 * spends the final stretch with a fully grown companion rather than glimpsing
 * it once at the very end.
 */
export function growthStageForMiniLevel(miniLevel: number): number {
  const parsed = miniLevelSchema.parse(miniLevel);
  const bandSize = MAX_MINI_LEVEL / MAX_GROWTH_STAGE;

  return Math.floor((parsed - MIN_MINI_LEVEL) / bandSize) + 1;
}

const EMOTION_BY_ACTIVITY: Readonly<Record<CompanionActivity, CompanionEmotion>> =
  {
    idle: "smiling",
    listening: "listening",
    speaking: "smiling",
    struggling: "sad",
  };

/** The companion animates only while it is the one talking. */
const ANIMATED_ACTIVITIES = new Set<CompanionActivity>(["speaking"]);

/**
 * What is happening in the turn, in the product's terms rather than the
 * component's.
 */
export interface CompanionSituation {
  /** The tutor's words are arriving. With voice this will be audio playing. */
  readonly replying: boolean;
  /** The learner has sent something and nothing has come back yet. */
  readonly sending: boolean;
  /** The learner is composing a message. */
  readonly composing: boolean;
}

/**
 * The companion's activity, derived from the turn.
 *
 * A function rather than a ternary at the call site, because the precedence
 * matters and is not obvious: a reply arriving wins over a learner who has
 * started typing their next line, so the companion is never cut off
 * mid-sentence by the person it is talking to.
 *
 * It is also the seam voice plugs into. Spoken output will set `replying` from
 * audio playback rather than from arriving text, and nothing below this line
 * changes.
 */
export function companionActivityFor(
  situation: CompanionSituation,
): CompanionActivity {
  if (situation.replying) return "speaking";
  if (situation.sending || situation.composing) return "listening";
  return "idle";
}

export function companionStateFor(input: {
  miniLevel: number;
  activity: CompanionActivity;
}): CompanionState {
  const activity = companionActivitySchema.parse(input.activity);

  return {
    emotion: EMOTION_BY_ACTIVITY[activity],
    activity,
    stage: growthStageForMiniLevel(input.miniLevel),
    progress: growthProgress(input.miniLevel),
    animated: ANIMATED_ACTIVITIES.has(activity),
  };
}
