import { z } from "zod";

import { VOICE_GENDERS } from "@/domain/tutor";

/**
 * Speech, behind an interface.
 *
 * The build spec's rule for this phase is the whole design: no provider
 * detail may leak into the domain layer. So what the rest of the application
 * sees is audio in, text out and text in, audio out — no model ids, no
 * response formats, no vendor-shaped options — and swapping Whisper for
 * anything else is a new file in this directory.
 *
 * Both providers go direct rather than through OpenRouter, which serves no
 * speech model. They are still model calls: routed by tier, budgeted,
 * and written to the same ledger.
 */

/** What a browser can realistically record, and what a provider will take. */
export const AUDIO_FORMATS = ["webm", "mp4", "mp3", "wav", "ogg"] as const;
export const audioFormatSchema = z.enum(AUDIO_FORMATS);
export type AudioFormat = z.infer<typeof audioFormatSchema>;

/**
 * Fifteen megabytes and five minutes, whichever comes first.
 *
 * A transcription endpoint with no size bound is a way to impose cost by
 * uploading, which the guardrails name as audio abuse. Both bounds are checked
 * before anything is sent.
 */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_MS = 5 * 60 * 1000;

/**
 * A byte array, checked by shape rather than by constructor identity.
 *
 * `instanceof Uint8Array` is a realm test: the same bytes crossing a realm
 * boundary — a worker, a polyfilled encoder, a test environment — fail it
 * while being perfectly good audio. Rejecting a recording because of where
 * its constructor came from is a refusal the caller cannot act on, so the
 * check is the tag instead, which every realm agrees about.
 */
const audioBytesSchema = z
  .custom<Uint8Array>(
    (value) => Object.prototype.toString.call(value) === "[object Uint8Array]",
    { error: "audio must be a byte array" },
  )
  .refine((bytes) => bytes.byteLength > 0, {
    error: "there is no audio here",
  });

export const transcriptionRequestSchema = z.strictObject({
  audio: audioBytesSchema,
  format: audioFormatSchema,
  /** Told, not detected: a German lesson's audio is German. */
  language: z.enum(["de", "en"]).default("de"),
  durationMs: z.number().int().min(1).max(MAX_AUDIO_MS),
});

export type TranscriptionRequest = z.input<typeof transcriptionRequestSchema>;

export interface Transcription {
  readonly text: string;
  /** Billed duration, for the ledger. Providers charge by the second. */
  readonly durationMs: number;
  readonly modelIdResolved: string;
}

export interface SpeechToTextProvider {
  transcribe(request: TranscriptionRequest): Promise<Transcription>;
}

/**
 * Voices are named rather than enumerated per provider.
 *
 * The domain asks for "a warm voice at a learner's pace"; which vendor voice
 * that is, is the provider's business. A domain that names `alloy` is a domain
 * that cannot change vendor.
 */
export const SPEECH_VOICES = ["tutor_warm", "tutor_neutral"] as const;
export const speechVoiceSchema = z.enum(SPEECH_VOICES);
export type SpeechVoice = z.infer<typeof speechVoiceSchema>;

/** A1 needs slower speech than B1. Configuration, like everything else. */
export const SPEECH_RATES = { A1: 0.85, A2: 0.95, B1: 1 } as const;

export const synthesisRequestSchema = z.strictObject({
  text: z.string().min(1).max(4000),
  voice: speechVoiceSchema.default("tutor_warm"),
  /**
   * The learner's chosen voice. A separate axis from the role on purpose:
   * "warm, at a learner's pace" is the product's ask, male or female is the
   * learner's, and the provider resolves the pair to a vendor voice.
   */
  gender: z.enum(VOICE_GENDERS).default("male"),
  /** 0.5 to 1.5. Anything outside that is unintelligible rather than useful. */
  speed: z.number().min(0.5).max(1.5).default(1),
  format: audioFormatSchema.default("mp3"),
});

export type SynthesisRequest = z.input<typeof synthesisRequestSchema>;

export interface Synthesis {
  readonly audio: Uint8Array;
  readonly format: AudioFormat;
  readonly characters: number;
  readonly modelIdResolved: string;
}

export interface TextToSpeechProvider {
  synthesize(request: SynthesisRequest): Promise<Synthesis>;
}

export type VoiceFailure = "too_large" | "too_long" | "unsupported_format" | "empty";

export type VoiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: VoiceFailure; readonly detail: string };

/**
 * Checked before a byte is uploaded.
 *
 * A provider will refuse an oversized file too, but only after it has been
 * sent — which is the upload the abuse was, and the bandwidth already paid for.
 */
export function checkAudio(input: {
  readonly bytes: number;
  readonly durationMs: number;
  readonly format: string;
}): VoiceResult<null> {
  if (input.bytes <= 0) {
    return { ok: false, reason: "empty", detail: "there is no audio here" };
  }
  if (input.bytes > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      detail: `audio is larger than ${MAX_AUDIO_BYTES} bytes`,
    };
  }
  if (input.durationMs > MAX_AUDIO_MS) {
    return {
      ok: false,
      reason: "too_long",
      detail: `audio is longer than ${MAX_AUDIO_MS / 1000} seconds`,
    };
  }
  if (!audioFormatSchema.safeParse(input.format).success) {
    return {
      ok: false,
      reason: "unsupported_format",
      detail: `${input.format} is not a format this accepts`,
    };
  }

  return { ok: true, data: null };
}

/** The speed a level should be spoken at. A lookup, never a model call. */
export function speechRateFor(cefr: keyof typeof SPEECH_RATES): number {
  return SPEECH_RATES[cefr];
}
