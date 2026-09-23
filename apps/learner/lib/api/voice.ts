import { z } from "zod";

import { SPEECH_RATES, speechRateFor } from "@dp/domain/speech";
import {
  MAX_AUDIO_BYTES,
  audioFormatSchema,
  checkAudio,
  type SpeechToTextProvider,
  type SpeechVoice,
  type TextToSpeechProvider,
} from "@dp/gateway/voice/providers";

/**
 * Speaking and being spoken to, as far as the framework is concerned.
 *
 * The routes are thin; this is where the rules live, so they can be tested
 * without standing up a server or reaching a provider.
 *
 * One thing is deliberately missing and worth saying out loud: voice calls do
 * not write a ledger row and are not counted against the euro budgets. That
 * was a decision, not an oversight, and it leaves the bounds below as the only
 * thing between a learner and unbounded spend — so they are tighter than the
 * provider's own limits rather than equal to them. Whisper is billed by the
 * minute, so the minute is what has to be bounded.
 */

/**
 * A spoken turn is a sentence or two.
 *
 * MAX_AUDIO_MS is the bound a provider would accept; this is the bound a
 * conversation needs. Five minutes of audio per request, at thirty requests a
 * minute, is a bill nobody authorised.
 */
export const MAX_TURN_AUDIO_MS = 60_000;

/** A tutor reply, not a chapter. The provider would take far more. */
export const MAX_SPOKEN_CHARACTERS = 1_000;

export const VOICE_FAILURES = [
  "unauthenticated",
  "rate_limited",
  "invalid_body",
  "audio_too_large",
  "audio_too_long",
  "unsupported_format",
  "no_audio",
  "voice_unavailable",
  "provider_error",
] as const;

export type VoiceFailure = (typeof VOICE_FAILURES)[number];

/**
 * What a learner is told, and the status it arrives with.
 *
 * A closed set of sentences. Nothing here repeats a provider's message, names
 * a model, or says which internal thing declined — a refusal that explains
 * itself to an attacker explains itself to an attacker.
 */
const RESPONSES: Readonly<Record<VoiceFailure, { status: number; message: string }>> = {
  unauthenticated: { status: 401, message: "Please sign in and try again." },
  rate_limited: {
    status: 429,
    message: "That is a lot of speaking at once. Give it a moment.",
  },
  invalid_body: { status: 400, message: "That recording could not be read." },
  audio_too_large: {
    status: 413,
    message: "That recording is too large. Try saying a little less.",
  },
  audio_too_long: {
    status: 413,
    message: `Recordings are limited to ${MAX_TURN_AUDIO_MS / 1000} seconds. Try saying a little less.`,
  },
  unsupported_format: {
    status: 415,
    message: "Your browser recorded a format we cannot read.",
  },
  no_audio: { status: 400, message: "We did not hear anything. Try again." },
  voice_unavailable: {
    status: 503,
    message: "Speaking is not available right now.",
  },
  provider_error: {
    status: 502,
    message: "We could not make that out. Please try again.",
  },
};

export function voiceErrorResponse(failure: VoiceFailure): {
  status: number;
  message: string;
} {
  return RESPONSES[failure];
}

/**
 * The format a browser recorded in, from what it labelled the blob.
 *
 * MediaRecorder reports a full media type with parameters —
 * "audio/webm;codecs=opus" — and a provider wants the container. Pulled out of
 * the route because it is string surgery on a value a caller controls, which
 * is exactly the kind of thing that breaks quietly.
 */
export function audioFormatFromMimeType(mimeType: string): string {
  const [type, rest] = mimeType.split("/");
  if (type?.trim().toLowerCase() !== "audio" || !rest) return "";

  return (rest.split(";")[0] ?? "").trim().toLowerCase();
}

export type VoiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: VoiceFailure };

const fail = <T = never>(error: VoiceFailure): VoiceResult<T> => ({ ok: false, error });
const ok = <T>(data: T): VoiceResult<T> => ({ ok: true, data });

// --- transcription ----------------------------------------------------------

export interface TranscriptionSubmission {
  readonly audio: Uint8Array;
  readonly format: string;
  readonly durationMs: number;
}

export interface Transcribed {
  readonly text: string;
}

/**
 * The learner's own audio, turned into their own words.
 *
 * Every bound is checked here, before a byte is forwarded. A provider refuses
 * an oversized clip too, but only after it has been uploaded — which is the
 * upload the abuse was.
 */
export async function handleTranscription(
  submission: TranscriptionSubmission,
  provider: SpeechToTextProvider | null,
): Promise<VoiceResult<Transcribed>> {
  if (!provider) return fail("voice_unavailable");

  const bounds = checkAudio({
    bytes: submission.audio.byteLength,
    durationMs: submission.durationMs,
    format: submission.format,
  });

  if (!bounds.ok) {
    return fail(
      bounds.reason === "empty"
        ? "no_audio"
        : bounds.reason === "too_large"
          ? "audio_too_large"
          : bounds.reason === "too_long"
            ? "audio_too_long"
            : "unsupported_format",
    );
  }

  // The turn's own bound, tighter than the provider's.
  if (submission.durationMs > MAX_TURN_AUDIO_MS) return fail("audio_too_long");

  try {
    const result = await provider.transcribe({
      audio: submission.audio,
      format: audioFormatSchema.parse(submission.format),
      durationMs: submission.durationMs,
      language: "de",
    });

    const text = result.text.trim();
    return text.length === 0 ? fail("no_audio") : ok({ text });
  } catch {
    // Never the provider's message: it can quote the learner's own audio back.
    return fail("provider_error");
  }
}

// --- synthesis --------------------------------------------------------------

export const spokenRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_SPOKEN_CHARACTERS),
  /** The learner's level decides the pace. A1 is spoken more slowly than B1. */
  cefr: z.enum(Object.keys(SPEECH_RATES) as [string, ...string[]]).default("A1"),
  /**
   * The learner's chosen voice, from their settings. Passed by the client
   * rather than read here because the read-aloud endpoint has no learner
   * lookup — and a wrong claim can only change which voice speaks.
   */
  voice: z.enum(["male", "female"]).default("male"),
});

export type SpokenRequest = z.input<typeof spokenRequestSchema>;

export interface Spoken {
  readonly audio: Uint8Array;
  readonly format: string;
}

/** Which named voice the tutor uses. Never a vendor's name. */
const TUTOR_VOICE: SpeechVoice = "tutor_warm";

export async function handleSynthesis(
  body: unknown,
  provider: TextToSpeechProvider | null,
): Promise<VoiceResult<Spoken>> {
  if (!provider) return fail("voice_unavailable");

  const parsed = spokenRequestSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_body");

  try {
    const result = await provider.synthesize({
      text: parsed.data.text,
      voice: TUTOR_VOICE,
      gender: parsed.data.voice,
      speed: speechRateFor(parsed.data.cefr as keyof typeof SPEECH_RATES),
      format: "mp3",
    });

    return result.audio.byteLength === 0
      ? fail("provider_error")
      : ok({ audio: result.audio, format: result.format });
  } catch {
    return fail("provider_error");
  }
}

/** Re-exported so a route can bound an upload before it reads the whole body. */
export { MAX_AUDIO_BYTES };
