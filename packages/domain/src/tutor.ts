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
 * the prompt that tells the tutor who they are, the speech provider that
 * chooses a voice for them, and the interface that puts their name on screen.
 * One table is what stops those three drifting into three different people.
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

export interface TutorPersona {
  readonly name: string;
  readonly voice: VoiceGender;
}

/**
 * One tutor per voice.
 *
 * A learner who picks the female voice is not asking for Jonas read out by a
 * woman; they are asking for a different person. So the name goes with the
 * voice, and the prompt, the speech provider and the screen all resolve the
 * learner's one choice to the same persona.
 */
export const TUTOR_PERSONAS: Readonly<Record<VoiceGender, TutorPersona>> = {
  male: { name: "Jonas", voice: "male" },
  female: { name: "Alex", voice: "female" },
};

/** The persona as shipped, and the default until a learner chooses. */
export const TUTOR: TutorPersona = TUTOR_PERSONAS.male;

export type TutorVoiceKind = VoiceGender;

export function tutorFor(voice: VoiceGender): TutorPersona {
  return TUTOR_PERSONAS[voice];
}
