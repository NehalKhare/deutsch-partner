import { SPEECH_RATES } from "@/lib/ai/voice/providers";

/**
 * What a speech model is told.
 *
 * A dedicated speech endpoint needs no instruction: text goes in, the same
 * text comes out spoken. OpenRouter serves speech through *chat* models
 * instead, and a chat model asked to read a sentence will read it and then
 * remark on having read it — the first version of this said the learner's
 * sentence and added «Das ist der Satz, den ich laut vorlesen soll», out loud,
 * in the tutor's voice. So the instruction is the thing that makes the model
 * behave like a transport, and it lives here with the rest of the prompt text
 * rather than buried in a fetch call.
 *
 * Pace is part of it for the same reason. A speech endpoint takes a `speed`
 * number; a chat model does not, so the learner's level arrives as words.
 */

export function speechReadingInstruction(speed: number): string {
  // Anything below the top of the ladder is a learner who was given a slower
  // pace on purpose. Read from the ladder rather than written down again here,
  // so changing what A1 gets changes what A1 hears.
  const pace =
    speed < SPEECH_RATES.B1
      ? "Speak slowly and clearly, the way you would to someone learning the language."
      : "Speak at a natural, unhurried pace.";

  return [
    "You are a speech engine, not an assistant.",
    "Read the user's message aloud in German, word for word, exactly as written.",
    pace,
    "Output nothing of your own: no greeting, no comment, no acknowledgement, no explanation of what you are doing. If the message is already in German, do not translate it. If it contains English words, read them as they are.",
  ].join(" ");
}

export function transcriptionInstruction(language: "de" | "en"): string {
  const spoken = language === "de" ? "German" : "English";

  return [
    `Transcribe the attached audio. It is a language learner speaking ${spoken}.`,
    "Return only the words they said, with ordinary punctuation and nothing else — no translation, no correction of their grammar, no commentary, and no quotation marks around it.",
    "If you cannot make out any words at all, return an empty response rather than a guess.",
  ].join(" ");
}
