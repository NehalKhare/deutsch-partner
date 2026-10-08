import { describe, expect, it, vi } from "vitest";

import type { ContractNotice, ContractNoticesRepository } from "@dp/db/contract-notices-repository";

import {
  INITIAL_NOTICE_STATE,
  mintReference,
  parseNoticeForm,
  sendNotice,
  type NoticeDeps,
} from "@/lib/legal/notices";

/**
 * Cancelling and withdrawing (§312k, §356a BGB): what the form must hold,
 * what is refused, what is recorded, and what the consumer is told back.
 */

function recorded(over: Partial<ContractNotice> = {}): ContractNotice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "ABCDEFGH23",
    kind: "cancellation",
    email: "lea@example.com",
    contract: "subscription",
    detail: null,
    learnerId: null,
    receivedAt: new Date("2026-10-07T09:00:00Z"),
    confirmedAt: null,
    ...over,
  };
}

function deps(over: Partial<NoticeDeps> = {}): NoticeDeps & { readonly notices: ContractNoticesRepository } {
  const notices: ContractNoticesRepository = {
    record: vi.fn(async (input) => ({
      ok: true as const,
      data: recorded({ reference: input.reference, kind: input.kind, email: input.email }),
    })),
    markConfirmed: vi.fn(async () => ({ ok: true as const, data: true })),
    forLearner: vi.fn(async () => ({ ok: true as const, data: [] })),
  };
  return {
    notices,
    confirmer: { send: async () => ({ sent: false }) },
    limiter: { check: async () => ({ allowed: true, remaining: 4, resetAt: new Date() }) } as never,
    keyFor: (email) => `hash:${email}`,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never,
    now: () => new Date("2026-10-07T09:00:01Z"),
    ...over,
  };
}

describe("the form", () => {
  it("needs a valid address, lower-cased, and defaults to 'not sure'", () => {
    expect(parseNoticeForm({ email: " Lea@Example.com ", contract: undefined, detail: null })).toEqual({
      ok: true,
      data: { email: "lea@example.com", contract: "unknown", detail: "" },
    });
  });

  it("refuses a missing or malformed address, because the confirmation goes to it", () => {
    expect(parseNoticeForm({ email: "", contract: "pass", detail: "" })).toEqual({ ok: false, error: "invalid_email" });
    expect(parseNoticeForm({ email: "not an address", contract: "pass", detail: "" })).toEqual({
      ok: false,
      error: "invalid_email",
    });
  });

  it("refuses a contract kind it does not know, and a description too long to be one", () => {
    expect(parseNoticeForm({ email: "a@b.de", contract: "lease", detail: "" })).toEqual({
      ok: false,
      error: "invalid_contract",
    });
    expect(parseNoticeForm({ email: "a@b.de", contract: "pass", detail: "x".repeat(501) })).toEqual({
      ok: false,
      error: "detail_too_long",
    });
  });
});

describe("the reference", () => {
  it("is ten characters from an alphabet without 0, O, 1 or I", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(mintReference()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    }
  });

  it("maps bytes to the alphabet deterministically", () => {
    expect(mintReference(() => new Uint8Array(10))).toBe("AAAAAAAAAA");
  });
});

describe("sending a notice", () => {
  const form = { email: "lea@example.com", contract: "subscription", detail: "" } as const;

  it("records it and hands back a receipt that says the page is the confirmation", async () => {
    const d = deps();

    const state = await sendNotice("cancellation", form, null, d);

    expect(state.status).toBe("done");
    expect(state.receipt).toMatchObject({
      kind: "cancellation",
      email: "lea@example.com",
      contract: "subscription",
      receivedAt: "2026-10-07T09:00:00.000Z",
      emailed: false,
    });
    expect(state.receipt?.reference).toMatch(/^[A-Z0-9]{10}$/);
    expect(d.notices.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cancellation", email: "lea@example.com", detail: null, learnerId: null }),
    );
    expect(d.notices.markConfirmed).not.toHaveBeenCalled();
  });

  it("attaches the learner when there is one, so Plan & billing can show it back", async () => {
    const d = deps();

    await sendNotice("withdrawal", form, "22222222-2222-4222-8222-222222222222", d);

    expect(d.notices.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "withdrawal", learnerId: "22222222-2222-4222-8222-222222222222" }),
    );
  });

  it("marks the confirmation sent when a sender sends it, and says so on the receipt", async () => {
    const d = deps({ confirmer: { send: async () => ({ sent: true }) } });

    const state = await sendNotice("cancellation", form, null, d);

    expect(state.receipt?.emailed).toBe(true);
    expect(d.notices.markConfirmed).toHaveBeenCalledWith(expect.any(String), new Date("2026-10-07T09:00:01Z"));
  });

  it("still counts the notice when the sender throws: the record is the point", async () => {
    const d = deps({
      confirmer: {
        send: async () => {
          throw new Error("smtp down");
        },
      },
    });

    const state = await sendNotice("cancellation", form, null, d);

    expect(state.status).toBe("done");
    expect(state.receipt?.emailed).toBe(false);
  });

  it("refuses when the address has sent too many, keyed by its hash and never logged", async () => {
    const d = deps({ limiter: { check: async () => ({ allowed: false, remaining: 0, resetAt: new Date() }) } as never });

    const state = await sendNotice("cancellation", form, null, d);

    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/wait/i), receipt: null });
    expect(d.notices.record).not.toHaveBeenCalled();
  });

  it("says plainly when the record could not be written, and that the first attempt's date counts", async () => {
    const d = deps();
    (d.notices.record as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: { kind: "unavailable" } });

    const state = await sendNotice("cancellation", form, null, d);

    expect(state.status).toBe("error");
    expect(state.message).toMatch(/the date you first tried counts/i);
    expect(d.logger.error).toHaveBeenCalledWith("legal.notice_failed", expect.not.objectContaining({ email: expect.anything() }));
  });

  it("starts idle", () => {
    expect(INITIAL_NOTICE_STATE).toEqual({ status: "idle", message: null, receipt: null });
  });
});

describe("who else hears about a notice", () => {
  const form = { email: "lea@example.com", contract: "subscription", detail: "" } as const;
  const LEARNER = "22222222-2222-4222-8222-222222222222";

  function listening() {
    const learner = vi.fn(async (_learnerId: string, _event: unknown) => {});
    const ops = vi.fn(async (_event: unknown) => {});
    return { learner, ops, notify: { learner: { notify: learner }, ops: { notify: ops } } };
  }

  it("the operators always, by reference and never by address", async () => {
    const { ops, notify } = listening();

    await sendNotice("cancellation", form, null, deps({ notify }));

    expect(ops).toHaveBeenCalledTimes(1);
    const event = ops.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(event).toMatchObject({ kind: "contract_notice.received", noticeKind: "cancellation", contract: "subscription" });
    expect(JSON.stringify(event)).not.toContain("lea@example.com");
  });

  it("the learner too, for a withdrawal sent while signed in", async () => {
    const { learner, notify } = listening();

    await sendNotice("withdrawal", form, LEARNER, deps({ notify }));

    expect(learner).toHaveBeenCalledWith(LEARNER, {
      kind: "account.withdrawal_received",
      reference: expect.stringMatching(/^[A-Z0-9]{10}$/),
    });
  });

  it("not the learner for a cancellation, which is confirmed to the address and may be somebody else's account", async () => {
    const { learner, notify } = listening();

    await sendNotice("cancellation", form, LEARNER, deps({ notify }));

    expect(learner).not.toHaveBeenCalled();
  });

  it("and the receipt still stands when a sink is broken", async () => {
    const notify = {
      ops: { notify: async () => { throw new Error("down"); } },
      learner: { notify: async () => { throw new Error("down"); } },
    };

    const state = await sendNotice("withdrawal", form, LEARNER, deps({ notify }));

    expect(state.status).toBe("done");
    expect(state.receipt?.reference).toMatch(/^[A-Z0-9]{10}$/);
  });
});
