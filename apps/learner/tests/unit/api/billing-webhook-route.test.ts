import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockBillingProvider, type MockBillingProvider } from "@dp/billing/mock";
import { createMemoryBillingStore } from "@dp/billing/testing/memory-store";

import type { BillingWebhookDeps } from "@/lib/api/billing-webhook";

/**
 * The route itself: what it reads from the request and what it answers.
 * The rules are in lib/api/billing-webhook.ts and tested there; here is only
 * that the raw body and the header reach them untouched, that payments being
 * off is a 503, and that an unsigned or oversized body is refused without
 * being buffered — this endpoint has no session in front of it.
 */

const graph = vi.hoisted(() => ({ current: null as BillingWebhookDeps | null }));

vi.mock("@/lib/api/composition", () => ({
  createBillingWebhookGraph: () => graph.current,
}));

const { POST, runtime } = await import("@/app/api/billing/webhook/route");

let provider: MockBillingProvider;

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("https://deutschpartner.example/api/billing/webhook", { method: "POST", body, headers }));

beforeEach(() => {
  provider = createMockBillingProvider();
  graph.current = {
    provider,
    repo: createMemoryBillingStore(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date("2026-10-01T12:00:00Z"),
    pseudonymFor: () => "0123456789abcdef0123456789abcdef",
  };
});

describe("POST /api/billing/webhook", () => {
  it("runs on Node, where the signature check's crypto lives", () => {
    expect(runtime).toBe("nodejs");
  });

  it("hands the raw body and the stripe-signature header to verification", async () => {
    const { body, signature } = provider.sign({ id: "evt_1", type: "customer.created" });

    const response = await post(body, { "stripe-signature": signature });

    expect(response.status).toBe(200);
    expect(provider.calls[0]).toEqual({ method: "verifyWebhook", input: { signed: true } });
  });

  it("answers a bad signature 400, with an empty body", async () => {
    const response = await post("{}", { "stripe-signature": "t=1,v1=forged" });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
  });

  it("answers 503 when payments are off, so Stripe keeps the event for later", async () => {
    graph.current = null;

    const response = await post("{}", { "stripe-signature": "t=1,v1=x" });

    expect(response.status).toBe(503);
  });

  it("refuses a body that declares itself larger than any event, unread", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const response = await POST(
      new Request("https://deutschpartner.example/api/billing/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": "t=1,v1=x", "content-length": String(1_048_577) },
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    expect(provider.calls).toHaveLength(0);
    // The declared length alone refused it; at most what a stream buffers
    // ahead of any read was pulled.
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("stops reading a body that declares no length once it passes the cap", async () => {
    // A chunked request carries no Content-Length. It is counted as it
    // arrives and abandoned at the cap, not buffered whole and then measured.
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });

    const response = await POST(
      new Request("https://deutschpartner.example/api/billing/webhook", {
        method: "POST",
        body: endless,
        headers: { "stripe-signature": "t=1,v1=x" },
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    expect(provider.calls).toHaveLength(0);
    expect(sent).toBeLessThan(2 * 1_048_576);
  });

  it("counts bytes, not characters", async () => {
    // 600k two-byte characters: under the cap as a string length, over it as bytes.
    const response = await post("é".repeat(600_000), { "stripe-signature": "t=1,v1=x" });

    expect(response.status).toBe(413);
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses an unsigned request with 400 before reading its body", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const response = await POST(
      new Request("https://deutschpartner.example/api/billing/webhook", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
    expect(provider.calls).toHaveLength(0);
    expect(pulled).toBeLessThanOrEqual(1);
    expect(graph.current?.logger.warn).toHaveBeenCalledWith("billing.webhook_rejected", { audit: true, signed: false });
  });

  it("refuses a body that is not UTF-8, which no Stripe event is", async () => {
    const response = await POST(
      new Request("https://deutschpartner.example/api/billing/webhook", {
        method: "POST",
        body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
        headers: { "stripe-signature": "t=1,v1=x" },
      }),
    );

    expect(response.status).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it("is never cached", async () => {
    const { body, signature } = provider.sign({ id: "evt_2", type: "customer.created" });

    const response = await post(body, { "stripe-signature": signature });

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
