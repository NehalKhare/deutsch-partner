import {
  synthesisRequestSchema,
  transcriptionRequestSchema,
  type AudioFormat,
  type SpeechToTextProvider,
  type Synthesis,
  type TextToSpeechProvider,
  type Transcription,
} from "./providers";

/**
 * The two speech providers, in memory.
 *
 * The build spec asks for provider mocks alongside the abstractions, and the
 * reason is the abstraction itself: an interface nobody has implemented twice
 * is a guess about what a second implementation would need. Writing the second
 * one is what proves the first is not shaped around one vendor.
 *
 * They live here rather than under tests/ deliberately. This directory is
 * scanned by the CI boundary tests, so the same rules that hold the real
 * transports honest — no provider SDK, no endpoint, no model id outside the
 * registry — hold these too. A double that is allowed to cheat is a double
 * that stops proving anything. A second gate keeps them out of the product:
 * nothing under app/ or lib/ may import this file.
 *
 * Two properties are worth naming:
 *
 *   - They validate with the same schemas as the real providers, so a request
 *     the real one would refuse is refused here as well. A permissive double
 *     hides exactly the bug it exists to catch.
 *   - They round-trip. Synthesised audio carries its own text, so a test can
 *     speak a line, hand the bytes back and get the line — an end-to-end voice
 *     path with no network, no key and no recording.
 */

/** What the transcriber returns for audio it did not produce itself. */
export const MOCK_TRANSCRIPT = "Guten Tag, ich lerne Deutsch.";

/**
 * Model ids reported by the mocks.
 *
 * `mock/` rather than a real vendor prefix, and not by accident: this string
 * reaches the usage ledger and the log line, which are the only places anyone
 * would later ask "where did this come from". A fake call recorded against a
 * real model id is a lie in the audit trail.
 */
export const MOCK_STT_MODEL_ID = "mock/speech-to-text";
export const MOCK_TTS_MODEL_ID = "mock/text-to-speech";

/**
 * Marks bytes this module produced. Anything else is treated as opaque audio
 * and gets the stated transcript, so a caller feeding real recordings still
 * gets a deterministic answer rather than a decoding accident.
 */
const MAGIC = "dp-mock-audio:v1\n";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC_BYTES = encoder.encode(MAGIC);

function carriesMockPayload(audio: Uint8Array): boolean {
  if (audio.byteLength < MAGIC_BYTES.byteLength) return false;
  return MAGIC_BYTES.every((byte, index) => audio[index] === byte);
}

/** The requests as the provider actually received them, defaults applied. */
export type ReceivedTranscription = ReturnType<
  typeof transcriptionRequestSchema.parse
>;
export type ReceivedSynthesis = ReturnType<typeof synthesisRequestSchema.parse>;

export interface MockVoiceOptions {
  /**
   * Thrown by every call. The failure path of a caller is the half that never
   * gets exercised unless a double can be told to fail.
   */
  readonly failWith?: Error;
}

export interface MockSpeechToTextOptions extends MockVoiceOptions {
  /** Returned for audio this module did not synthesise. */
  readonly transcript?: string;
}

export interface MockSpeechToText extends SpeechToTextProvider {
  /** Every request that got past validation, in order. */
  readonly calls: readonly ReceivedTranscription[];
}

export interface MockTextToSpeech extends TextToSpeechProvider {
  readonly calls: readonly ReceivedSynthesis[];
}

export function createMockSpeechToText(
  options: MockSpeechToTextOptions = {},
): MockSpeechToText {
  const calls: ReceivedTranscription[] = [];
  const fallback = options.transcript ?? MOCK_TRANSCRIPT;

  return {
    calls,

    async transcribe(request): Promise<Transcription> {
      // Parsed before it is recorded: a request the real provider would refuse
      // is not a call anybody made.
      const input = transcriptionRequestSchema.parse(request);
      calls.push(input);

      if (options.failWith) throw options.failWith;

      return {
        text: carriesMockPayload(input.audio)
          ? decoder.decode(input.audio.subarray(MAGIC_BYTES.byteLength))
          : fallback,
        // Echoed, not measured — the real providers bill on what they are told.
        durationMs: input.durationMs,
        modelIdResolved: MOCK_STT_MODEL_ID,
      };
    },
  };
}

export function createMockTextToSpeech(
  options: MockVoiceOptions = {},
): MockTextToSpeech {
  const calls: ReceivedSynthesis[] = [];

  return {
    calls,

    async synthesize(request): Promise<Synthesis> {
      const input = synthesisRequestSchema.parse(request);
      calls.push(input);

      if (options.failWith) throw options.failWith;

      return {
        // Copied into the ambient realm, exactly as the real transport does
        // with `new Uint8Array(await response.arrayBuffer())`. A double that
        // hands back a foreign-realm array is a double with a different
        // contract from the thing it stands in for.
        audio: new Uint8Array(encoder.encode(`${MAGIC}${input.text}`)),
        format: input.format as AudioFormat,
        characters: input.text.length,
        modelIdResolved: MOCK_TTS_MODEL_ID,
      };
    },
  };
}
