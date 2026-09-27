import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { createVoiceProviders, pseudonymFor } from "@/lib/api/composition";
import { consumeQuota } from "@/lib/api/quota";
import { limiterFor } from "@/lib/api/rate-limit";
import {
  MAX_AUDIO_BYTES,
  audioFormatFromMimeType,
  handleTranscription,
  voiceErrorResponse,
  type VoiceFailure,
} from "@/lib/api/voice";
import { planForRequest } from "@/lib/billing/entitlement";
import { planRefusalBody, retryAfterSeconds, upgradeOffered } from "@/lib/billing/refusal";

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

/** A plan's refusal: the upgrade prompt's body, and when the window reopens. */
function refuseForPlan(
  failure: "plan_required" | "quota_exhausted",
  resetAt: Date | null,
  upgrade: boolean,
): Response {
  const { status, message } = voiceErrorResponse(failure);
  return json(
    planRefusalBody(failure, message, { resetAt, upgrade }),
    status,
    resetAt ? { "retry-after": retryAfterSeconds(resetAt) } : {},
  );
}

export async function POST(request: Request): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return refuse("unauthenticated");

  const userIdHash = pseudonymFor(learnerId);
  const decision = await limiterFor("transcribe").check(userIdHash);
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

  // The plan, from the learner's own rows. One transcription is counted
  // against its daily allowance, and only once the clip has passed every
  // check of its own: a recording in a format nobody reads has used nothing.
  const { plan, readable } = await planForRequest(learnerId);

  const result = await handleTranscription(
    {
      audio: new Uint8Array(await file.arrayBuffer()),
      format: audioFormatFromMimeType(file.type),
      durationMs: Math.round(durationMs),
    },
    createVoiceProviders()?.speechToText ?? null,
    () => consumeQuota(plan, "transcriptions", userIdHash),
  );

  if (result.ok) return json({ text: result.data.text }, 200, { "cache-control": "no-store" });
  if (result.error === "plan_required" || result.error === "quota_exhausted") {
    return refuseForPlan(result.error, result.resetAt ?? null, upgradeOffered(plan, readable));
  }
  return refuse(result.error);
}
