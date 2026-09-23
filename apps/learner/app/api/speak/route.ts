import { getAuthenticatedUserId } from "@/lib/auth/current-user";
import { createVoiceProviders, pseudonymFor } from "@/lib/api/composition";
import { limiterFor } from "@/lib/api/rate-limit";
import { handleSynthesis, voiceErrorResponse, type VoiceFailure } from "@/lib/api/voice";

/**
 * POST /api/speak
 *
 * Text in, audio out. The text is what the tutor already said to this learner,
 * so nothing new is disclosed by speaking it — but it is still bounded and
 * still rate limited, because the cost is per character and the caller decides
 * the characters.
 */
export const runtime = "nodejs";

function refuse(failure: VoiceFailure, headers: HeadersInit = {}): Response {
  const { status, message } = voiceErrorResponse(failure);
  return new Response(JSON.stringify({ error: failure, message }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function POST(request: Request): Promise<Response> {
  const learnerId = await getAuthenticatedUserId();
  if (!learnerId) return refuse("unauthenticated");

  const decision = await limiterFor("synthesize").check(pseudonymFor(learnerId));
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

  const result = await handleSynthesis(body, createVoiceProviders()?.textToSpeech ?? null);
  if (!result.ok) return refuse(result.error);

  return new Response(result.data.audio as BlobPart, {
    status: 200,
    headers: {
      "content-type": `audio/${result.data.format}`,
      "cache-control": "no-store",
      "content-length": String(result.data.audio.byteLength),
    },
  });
}
