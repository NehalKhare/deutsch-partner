import { createDevicePreference } from "@dp/ui/device-preference";

/**
 * The device-scoped preferences this app keeps.
 *
 * The primitive itself moved to `@dp/ui/device-preference` when the theme
 * became one of these: it is the same kind of answer, and the operator app
 * needs it too. Re-exported here so the call sites that already knew where to
 * find it still do.
 */

export {
  createDevicePreference,
  useDevicePreference,
} from "@dp/ui/device-preference";
export type { DevicePreference } from "@dp/ui/device-preference";

/** Whether the chat's mastery strip is in view. */
export const masteryStripStore = createDevicePreference(
  "deutsch-partner.mastery-strip",
  ["shown", "hidden"] as const,
  "shown",
);

/**
 * Which voice reads replies aloud.
 *
 * "ai" is the speech model — it sounds like a person, costs money per line,
 * and needs the server; the device's own voice remains its fallback. "browser"
 * is the Web Speech API alone: instant, free, and offline, at whatever quality
 * this device ships.
 */
export const VOICE_ENGINES = ["ai", "browser"] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];

export const voiceEngineStore = createDevicePreference<VoiceEngine>(
  "deutsch-partner.voice-engine",
  VOICE_ENGINES,
  "ai",
);

/**
 * Whether the note about the AI voice is still wanted on this device.
 *
 * Said once when the server declines to speak — the plan has no AI voice, or
 * today's voice lines are spent — and the device's own voice reads instead.
 * Put away, it stays away here: a line nobody lost anything to is not worth
 * repeating on every visit (billing-and-plans-spec.md S4).
 */
export const voicePlanNoteStore = createDevicePreference(
  "deutsch-partner.voice-plan-note",
  ["shown", "dismissed"] as const,
  "shown",
);
