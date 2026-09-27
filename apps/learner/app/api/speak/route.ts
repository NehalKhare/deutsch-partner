import { PLAN_CATALOGUE } from "@dp/domain/plans";

import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { createVoiceProviders, pseudonymFor } from "@/lib/api/composition";
import { consumeQuota, type QuotaDecision } from "@/lib/api/quota";
import { limiterFor } from "@/lib/api/rate-limit";
import { handleSynthesis, voiceErrorResponse, type VoiceFailure } from "@/lib/api/voice";
import { planForRequest } from "@/lib/billing/entitlement";
import { planRefusalBody, retryAfterSeconds, upgradeOffered } from "@/lib/billing/refusal";

/**
 * POST /api/speak
 *
 * Text in, audio out. The text is what the tutor already said to this learner,
 * so nothing new is disclosed by speaking it — but it is still bounded and
 * still rate limited, because the cost is per character and the caller decides
 * the characters.
 *
 * The model voice is a paid feature (billing-and-plans-spec.md S2), and in
 * the Trainer a Premium one. A plan without it where the line is read is
 * answered 402, and the page reads the line in the device's own voice instead
 * — which never reaches this route, and is unlimited on every plan. A plan
 * with it counts one voice line against its daily allowance.
 */
export const runtime = "nodejs";

function respond(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function refuse(failure: VoiceFailure, headers: HeadersInit = {}): Response {
  const { status, message } = voiceErrorResponse(failure);
  return respond({ error: failure, message }, status, headers);
}

const NO_MODEL_VOICE: QuotaDecision = { allowed: false, refusal: "plan_required", resetAt: null };

export async function POST(request: Request): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return refuse("unauthenticated");

  const userIdHash = pseudonymFor(learnerId);
  const decision = await limiterFor("synthesize").check(userIdHash);
  if (!decision.allowed) {
    return refuse("rate_limited", {
      "retry-after": String(
        Math.max(1, Math.ceil((decision.resetAt.getTime() - Date.now()) / 1000)),
      ),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("invalid_body");
  }

  const { plan, readable } = await planForRequest(learnerId);

  // The feature first, then the allowance: a plan without the model voice
  // where this line is read has nothing to count against.
  const { features } = PLAN_CATALOGUE[plan];
  const result = await handleSynthesis(
    body,
    createVoiceProviders()?.textToSpeech ?? null,
    async ({ surface }) =>
      features.modelVoice && (surface !== "trainer" || features.trainerVoice)
        ? consumeQuota(plan, "voice_lines", userIdHash)
        : NO_MODEL_VOICE,
  );
  if (!result.ok) {
    if (result.error === "plan_required" || result.error === "quota_exhausted") {
      const { status, message } = voiceErrorResponse(result.error);
      const resetAt = result.resetAt ?? null;
      return respond(
        planRefusalBody(result.error, message, { resetAt, upgrade: upgradeOffered(plan, readable) }),
        status,
        resetAt ? { "retry-after": retryAfterSeconds(resetAt) } : {},
      );
    }
    return refuse(result.error);
  }

  return new Response(result.data.audio as BlobPart, {
    status: 200,
    headers: {
      "content-type": `audio/${result.data.format}`,
      "cache-control": "no-store",
      "content-length": String(result.data.audio.byteLength),
    },
  });
}
