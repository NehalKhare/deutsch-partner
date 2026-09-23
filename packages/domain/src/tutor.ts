/**
 * The tutor.
 *
 * A named person rather than "the assistant", because someone practising
 * conversation is practising it with somebody. Without a name the model
 * invented one every session — Anna in one thread, "dein Deutsch-Partner" in
 * the next — which is not a tutor a learner comes back to, it is a stranger
 * each time.
 *
 * Declared here, in the domain, because three layers need to agree about it:
 * the prompt that tells him who he is, the speech provider that chooses a
 * voice for him, and the interface that puts his name on screen. One constant
 * is what stops those three drifting into three different people.
 */
/**
 * The voices a learner may choose between.
 *
 * Owned by the tutor domain because both speech engines resolve against it:
 * the Web Speech API exposes no gender at all and a provider's voice names
 * carry none either, so this is the fact they are given rather than something
 * either can infer. The learner's own choice lives on their profile.
 */
export const VOICE_GENDERS = ["male", "female"] as const;

export type VoiceGender = (typeof VOICE_GENDERS)[number];

export const TUTOR = {
  name: "Jonas",
  /** The persona as shipped, and the default until a learner chooses. */
  voice: "male",
} as const;

export type TutorVoiceKind = (typeof TUTOR)["voice"];
