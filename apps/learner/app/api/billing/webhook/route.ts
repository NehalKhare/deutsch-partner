import { handleBillingWebhook, readWebhookBody, rejectUnsigned } from "@/lib/api/billing-webhook";
import { createBillingWebhookGraph } from "@/lib/api/composition";

/**
 * POST /api/billing/webhook — Stripe's events.
 *
 * Thin on purpose, like every route here: read the raw body and the
 * signature header, hand them over, answer the status. No session is read:
 * the Stripe signature is this endpoint's authentication, and the proxy
 * matcher leaves the path alone so a server-to-server call is not charged a
 * session refresh (billing-and-plans-spec.md S8).
 *
 * Node runtime: the signature is an HMAC checked with node:crypto, over the
 * body exactly as it arrived — which is why it is read as text and never
 * parsed here.
 */
export const runtime = "nodejs";

const answer = (status: number) =>
  new Response(null, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  // Payments off: 503 rather than 200, so Stripe keeps retrying the event
  // until they are on, instead of it being acknowledged into nowhere.
  const deps = createBillingWebhookGraph();
  if (!deps) return answer(503);

  // No signature, no reading: this endpoint has no session in front of it,
  // so what an unsigned sender brings is not held even briefly.
  const signature = request.headers.get("stripe-signature");
  if (signature === null) {
    await request.body?.cancel().catch(() => undefined);
    return answer(rejectUnsigned(deps).status);
  }

  const read = await readWebhookBody(request);
  if (!read.ok) return answer(read.status);

  const { status } = await handleBillingWebhook({ body: read.body, signature }, deps);
  return answer(status);
}
