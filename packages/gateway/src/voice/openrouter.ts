import { z } from "zod";

import {
  speechReadingInstruction,
  transcriptionInstruction,
} from "@dp/prompts/voice";
import {
  synthesisRequestSchema,
  transcriptionRequestSchema,
  type SpeechToTextProvider,
  type SpeechVoice,
  type Synthesis,
  type TextToSpeechProvider,
  type Transcription,
} from "./providers";

/**
 * Speech, over OpenRouter.
 *
 * One key for every model call this product makes, which is the whole point of
 * routing through OpenRouter in the first place — a second provider account is
 * a second thing to fund, rotate and explain.
 *
 * It costs a shape, though. OpenRouter has no `/audio/speech` or
 * `/audio/transcriptions` endpoint; what it has is chat models whose input and
 * output modalities include audio. So both directions are chat completions
 * here: text in and audio back for speaking, audio in and text back for
 * listening. Three consequences worth knowing about, all of them handled below
 * and none of them obvious from the interface:
 *
 *   - Audio output arrives only when `stream: true`, and only as `pcm16`. The
 *     provider says so in as many words if you ask for anything else.
 *   - Raw PCM is not something a browser will play. The samples are wrapped in
 *     a WAV header here, at the edge, so nothing above this file learns that
 *     the audio arrived headerless.
 *   - A chat model has opinions. Left to itself it reads the sentence and then
 *     says something about having read it, in the tutor's voice, to a learner
 *     who asked to hear one line of German. The instruction that stops it is
 *     prompt text and lives in lib/ai/prompts/voice.ts.
 *
 * Everything vendor-shaped stops at this file: the voice names, the streaming
 * envelope, the sample rate. Nothing above it knows any of this exists.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * What `pcm16` means: 24 kHz, one channel, signed 16-bit little-endian.
 *
 * Not negotiable and not announced — the stream carries samples and no header,
 * so the container written below has to assert the rate the provider used. Get
 * it wrong and the tutor sounds like a chipmunk or a ghost, which is the kind
 * of bug that is obvious the moment anybody listens and invisible until then.
 */
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS = 16;

/**
 * The domain's named voices, mapped to this vendor's — one per gender,
 * because which voice reads aloud is the learner's setting.
 *
 * The domain asks for a warm voice or a level one, and for the learner's
 * chosen gender; it never names a vendor's voice — a caller that could name
 * `ash` is a caller that would have to be found and edited the day this
 * product changes provider.
 */
const VOICES: Readonly<
  Record<SpeechVoice, Readonly<Record<"male" | "female", string>>>
> = {
  tutor_warm: { male: "ash", female: "shimmer" },
  tutor_neutral: { male: "onyx", female: "nova" },
};

export interface OpenRouterVoiceOptions {
  readonly apiKey: string;
  readonly transcribeModelId: string;
  readonly speechModelId: string;
  readonly fetchImpl?: typeof fetch;
}

class VoiceProviderError extends Error {
  constructor(readonly status: number) {
    super(`Speech request failed with status ${status}`);
    this.name = "VoiceProviderError";
  }
}

const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
});

/** One SSE frame's worth of what we came for. */
const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({ audio: z.object({ data: z.string().optional() }).loose().optional() })
          .loose(),
      }),
    )
    .optional(),
});

/**
 * A RIFF/WAVE container around raw samples.
 *
 * Forty-four bytes of header and then the samples untouched: the cheapest way
 * to turn something no browser will play into something every browser will.
 */
export function wavFromPcm16(samples: Uint8Array): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS) / 8;

  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(at + index, text.charCodeAt(index));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // the size of this subchunk
  view.setUint16(20, 1, true); // 1 is uncompressed PCM
  view.setUint16(22, PCM_CHANNELS, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, (PCM_CHANNELS * PCM_BITS) / 8, true); // block align
  view.setUint16(34, PCM_BITS, true);
  ascii(36, "data");
  view.setUint32(40, samples.byteLength, true);

  const wav = new Uint8Array(44 + samples.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(samples, 44);

  return wav;
}

/** Base64 to bytes, without reaching for a Node-only Buffer. */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The audio out of a streamed completion.
 *
 * Line-buffered rather than chunk-buffered: a network read can end anywhere,
 * including halfway through a base64 payload, and a JSON.parse of half a frame
 * is a dropped syllable. An unparseable frame is skipped rather than fatal —
 * OpenRouter interleaves comments and keep-alives, and neither is audio.
 */
async function collectAudio(response: Response): Promise<Uint8Array> {
  const body = response.body;
  if (!body) throw new Error("the speech provider returned no stream");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: Uint8Array[] = [];
  let buffered = "";

  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload.length === 0 || payload === "[DONE]") return;

    let frame: unknown;
    try {
      frame = JSON.parse(payload);
    } catch {
      return;
    }

    const parsed = chunkSchema.safeParse(frame);
    if (!parsed.success) return;

    for (const choice of parsed.data.choices ?? []) {
      const data = choice.delta.audio?.data;
      if (data) parts.push(decodeBase64(data));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    // The last element is whatever arrived after the final newline: a partial
    // line, kept for the next read rather than parsed as a whole one.
    buffered = lines.pop() ?? "";
    for (const line of lines) take(line.trim());
  }
  take(buffered.trim());

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total === 0) throw new Error("the speech provider returned no audio");

  const samples = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    samples.set(part, at);
    at += part.byteLength;
  }

  return samples;
}

export function createOpenRouterTextToSpeech(
  options: OpenRouterVoiceOptions,
): TextToSpeechProvider {
  const call = options.fetchImpl ?? fetch;

  return {
    async synthesize(request): Promise<Synthesis> {
      const input = synthesisRequestSchema.parse(request);

      const response = await call(ENDPOINT, {
        method: "POST",
        headers: {
          // The key travels in the header and never in the body or a log line.
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.speechModelId,
          modalities: ["text", "audio"],
          audio: { voice: VOICES[input.voice][input.gender], format: "pcm16" },
          // Audio comes back only from a stream, and only as PCM.
          stream: true,
          // A transport should not be creative about what it is reading.
          temperature: 0,
          messages: [
            { role: "system", content: speechReadingInstruction(input.speed) },
            { role: "user", content: input.text },
          ],
        }),
      });

      if (!response.ok) throw new VoiceProviderError(response.status);

      return {
        audio: wavFromPcm16(await collectAudio(response)),
        // What was produced, not what was asked for: the caller sets the
        // response's content type from this, and PCM in a WAV wrapper is a WAV.
        format: "wav",
        // What this is billed on. Recorded so the ledger row means something.
        characters: input.text.length,
        modelIdResolved: options.speechModelId,
      };
    },
  };
}

export function createOpenRouterSpeechToText(
  options: OpenRouterVoiceOptions,
): SpeechToTextProvider {
  const call = options.fetchImpl ?? fetch;

  return {
    async transcribe(request): Promise<Transcription> {
      const input = transcriptionRequestSchema.parse(request);

      const response = await call(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.transcribeModelId,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: transcriptionInstruction(input.language) },
                {
                  type: "input_audio",
                  input_audio: {
                    data: encodeBase64(input.audio),
                    format: input.format,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) throw new VoiceProviderError(response.status);

      const parsed = completionSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("the transcription provider returned a malformed response");
      }

      return {
        text: (parsed.data.choices[0]!.message.content ?? "").trim(),
        durationMs: input.durationMs,
        modelIdResolved: options.transcribeModelId,
      };
    },
  };
}
