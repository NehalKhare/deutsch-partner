import { applyBillingEvent, type BillingEventDeps } from "@dp/billing/webhook";
import type { BillingProvider } from "@dp/billing/provider";

/**
 * POST /api/billing/webhook, below the framework.
 *
 * billing-and-plans-spec.md S8. There is no session on this endpoint: the
 * Stripe signature is its authentication. So the signature is checked
 * before anything else happens — before the event is claimed, before Stripe
 * is asked about it, before any log line says what arrived — and a body that
 * fails it gets 400 and no detail. What passes is a doorbell, handed to the
 * billing package, which reads the object fresh and decides the status.
 */

/**
 * Above any event Stripe sends this endpoint, with room to spare. A body
 * larger than this is refused without being held: the signature check is an
 * HMAC over the whole thing, and an unauthenticated sender should not get to
 * choose how much of it there is.
 */
export const MAX_WEBHOOK_BYTES = 1_048_576;

export type WebhookBody =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly status: 400 | 413 };

/**
 * The raw body, read to at most `limit` bytes.
 *
 * A declared Content-Length over the limit is refused before a byte is read.
 * A body that declares none — a chunked request — is counted as it arrives
 * and abandoned the moment it passes the limit, rather than buffered whole
 * and measured afterwards; before the signature is checked, the sender is
 * anyone. Bytes, not characters: the limit is what is held in memory. A body
 * that is not UTF-8 is no Stripe event, and is refused rather than repaired —
 * a repaired body would fail the signature anyway.
 */
export async function readWebhookBody(request: Request, limit: number = MAX_WEBHOOK_BYTES): Promise<WebhookBody> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > limit) {
    await request.body?.cancel().catch(() => undefined);
    return { ok: false, status: 413 };
  }
  if (request.body === null) return { ok: true, body: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    // The connection broke mid-body: nothing whole arrived to verify.
    return { ok: false, status: 400 };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, status: 400 };
  }
}

export interface BillingWebhookDeps extends BillingEventDeps {
  readonly provider: BillingProvider;
}

export interface WebhookDelivery {
  /** The raw body, exactly as it arrived: the signature is over these bytes. */
  readonly body: string;
  /** The stripe-signature header, or null when there was none. */
  readonly signature: string | null;
}

/** An unsigned request: refused, and audited, without reading what it brought. */
export function rejectUnsigned(deps: Pick<BillingWebhookDeps, "logger">): { readonly status: 400 } {
  deps.logger.warn("billing.webhook_rejected", { audit: true, signed: false });
  return { status: 400 };
}

export async function handleBillingWebhook(
  delivery: WebhookDelivery,
  deps: BillingWebhookDeps,
): Promise<{ readonly status: number }> {
  if (delivery.signature === null) return rejectUnsigned(deps);

  const event = await deps.provider.verifyWebhook(delivery.body, delivery.signature).catch(() => null);
  if (event === null) {
    // Whether a header was there at all, and nothing about what came with it.
    deps.logger.warn("billing.webhook_rejected", { audit: true, signed: delivery.signature !== null });
    return { status: 400 };
  }

  const outcome = await applyBillingEvent(event, deps);
  return { status: outcome.httpStatus };
}
