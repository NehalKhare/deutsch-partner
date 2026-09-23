/**
 * How fast a level should be spoken.
 *
 * A1 needs slower speech than B1. A lookup, never a model call, and part of the
 * domain rather than of the speech provider because the prompt that asks a
 * voice model for "a learner's pace" and the provider that sets the playback
 * rate must agree on what that pace is.
 */
export const SPEECH_RATES = { A1: 0.85, A2: 0.95, B1: 1 } as const;

export type SpeechRateLevel = keyof typeof SPEECH_RATES;

/** The speed a level should be spoken at. */
export function speechRateFor(cefr: SpeechRateLevel): number {
  return SPEECH_RATES[cefr];
}
