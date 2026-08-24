import { z } from "zod";

import {
  synthesisRequestSchema,
  transcriptionRequestSchema,
  type SpeechToTextProvider,
  type SpeechVoice,
  type Synthesis,
  type TextToSpeechProvider,
  type Transcription,
} from "@/lib/ai/voice/providers";

/**
 * The OpenAI speech transports.
 *
 * Direct, because OpenRouter serves no speech-to-text or text-to-speech model
 * — chat, completion and embeddings all ride the router; speech alone cannot.
 * This is the one file outside the gateway allowed to open a connection to a
 * provider, and the CI gate names it.
 *
 * Everything vendor-shaped stops here: the voice names, the multipart body,
 * the response format. Nothing above this file knows any of it exists.
 */

const TRANSCRIBE_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";

export interface OpenAIVoiceOptions {
  readonly apiKey: string;
  readonly transcribeModelId: string;
  readonly speechModelId: string;
  readonly fetchImpl?: typeof fetch;
}

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

const transcriptionSchema = z.object({ text: z.string() }).loose();

class VoiceProviderError extends Error {
  constructor(readonly status: number) {
    super(`Speech request failed with status ${status}`);
    this.name = "VoiceProviderError";
  }
}

/** The registry states ids as `vendor/model`; this API wants the bare name. */
function bareModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

export function createOpenAISpeechToText(
  options: OpenAIVoiceOptions,
): SpeechToTextProvider {
  const call = options.fetchImpl ?? fetch;

  return {
    async transcribe(request): Promise<Transcription> {
      const input = transcriptionRequestSchema.parse(request);

      const form = new FormData();
      form.set("model", bareModelId(options.transcribeModelId));
      form.set("language", input.language);
      form.set(
        "file",
        new Blob([input.audio as BlobPart], { type: `audio/${input.format}` }),
        `speech.${input.format}`,
      );

      const response = await call(TRANSCRIBE_ENDPOINT, {
        method: "POST",
        // The key travels in the header and never in the body or a log line.
        headers: { authorization: `Bearer ${options.apiKey}` },
        body: form,
      });

      if (!response.ok) throw new VoiceProviderError(response.status);

      const parsed = transcriptionSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("the transcription provider returned a malformed response");
      }

      return {
        text: parsed.data.text,
        durationMs: input.durationMs,
        modelIdResolved: bareModelId(options.transcribeModelId),
      };
    },
  };
}

export function createOpenAITextToSpeech(
  options: OpenAIVoiceOptions,
): TextToSpeechProvider {
  const call = options.fetchImpl ?? fetch;

  return {
    async synthesize(request): Promise<Synthesis> {
      const input = synthesisRequestSchema.parse(request);

      const response = await call(SPEECH_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: bareModelId(options.speechModelId),
          input: input.text,
          voice: VOICES[input.voice][input.gender],
          speed: input.speed,
          response_format: input.format,
        }),
      });

      if (!response.ok) throw new VoiceProviderError(response.status);

      return {
        audio: new Uint8Array(await response.arrayBuffer()),
        format: input.format,
        // What this is billed on. Recorded so the ledger row means something.
        characters: input.text.length,
        modelIdResolved: bareModelId(options.speechModelId),
      };
    },
  };
}
