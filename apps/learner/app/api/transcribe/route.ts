import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { createVoiceProviders, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import {
  MAX_AUDIO_BYTES,
  audioFormatFromMimeType,
  handleTranscription,
  voiceErrorResponse,
  type VoiceFailure,
} from "@/lib/api/voice";

/**
 * POST /api/transcribe
 *
 * Multipart: an `audio` file and the `durationMs` the browser recorded. The
 * duration is told rather than measured, because decoding audio server-side to
 * find out how long it is means decoding audio a caller controls — and it is
 * only ever used to refuse, never to bill, so a caller who lies about it can
 * only make their own request smaller.
 *
 * Node runtime: the transcription transport reads a byte stream.
 */
export const runtime = "nodejs";

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function refuse(failure: VoiceFailure, headers: HeadersInit = {}): Response {
  const { status, message } = voiceErrorResponse(failure);
  return json({ error: failure, message }, status, headers);
}

export async function POST(request: Request): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return refuse("unauthenticated");

  const decision = await limiterFor("transcribe").check(pseudonymFor(learnerId));
  if (!decision.allowed) {
    return refuse("rate_limited", {
      "retry-after": String(
        Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000)),
      ),
    });
  }

  // Checked from the declared length before the body is read, so an oversized
  // upload is refused rather than buffered.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) return refuse("audio_too_large");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse("invalid_body");
  }

  const file = form.get("audio");
  const durationMs = Number(form.get("durationMs"));
  if (!(file instanceof Blob) || !Number.isFinite(durationMs)) {
    return refuse("invalid_body");
  }
  if (file.size > MAX_AUDIO_BYTES) return refuse("audio_too_large");

  const result = await handleTranscription(
    {
      audio: new Uint8Array(await file.arrayBuffer()),
      format: audioFormatFromMimeType(file.type),
      durationMs: Math.round(durationMs),
    },
    createVoiceProviders()?.speechToText ?? null,
  );

  return result.ok
    ? json({ text: result.data.text }, 200, { "cache-control": "no-store" })
    : refuse(result.error);
}
