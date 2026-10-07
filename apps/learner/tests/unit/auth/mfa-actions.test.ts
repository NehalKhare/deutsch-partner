import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INITIAL_CODE_STATE,
  INITIAL_ENROLMENT_STATE,
  type EnrolmentFormState,
} from "@/lib/auth/mfa-state";

/**
 * The second step, as the server sees it. The forms are tested on their own;
 * here is who may submit them, which factor is challenged, and where a
 * learner goes afterwards.
 */

const getClaims = vi.fn();
const listFactors = vi.fn();
const enroll = vi.fn();
const challengeAndVerify = vi.fn();
const unenroll = vi.fn();
const check = vi.fn();
const warn = vi.fn();
const info = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getClaims, mfa: { listFactors, enroll, challengeAndVerify, unenroll } },
  }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ limiterFor: () => ({ check }) }));
vi.mock("@/lib/api/composition", () => ({
  actionLogger: () => ({ warn, info }),
  pseudonymOrUnavailable: (id: string) => `pseudo:${id}`,
}));

const { enrolmentAction, verifyMfaAction } = await import("@/app/auth/mfa/actions");

const LEARNER = "11111111-1111-4111-8111-111111111111";
const VERIFIED = { id: "f-verified", status: "verified", factor_type: "totp" };

function session(aal: "aal1" | "aal2" | null) {
  getClaims.mockResolvedValue(
    aal ? { data: { claims: { sub: LEARNER, aal } }, error: null } : { data: null, error: null },
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  for (const mock of [getClaims, listFactors, enroll, challengeAndVerify, unenroll, check, warn, info]) {
    mock.mockReset();
  }
  redirect.mockClear();
  session("aal1");
  listFactors.mockResolvedValue({ data: { totp: [VERIFIED], all: [VERIFIED] }, error: null });
  challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  check.mockResolvedValue({ allowed: true });
});

describe("verifyMfaAction", () => {
  it("sends a learner with no session to sign in", async () => {
    session(null);
    await expect(verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123456" }))).rejects.toThrow(
      "NEXT_REDIRECT /auth/login",
    );
  });

  it("sends a learner who already has both factors on their way", async () => {
    session("aal2");
    await expect(
      verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123456", next: "/chat" })),
    ).rejects.toThrow("NEXT_REDIRECT /chat");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("challenges the account's verified factor, never one named by the form", async () => {
    await expect(
      verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123 456", factorId: "forged" })),
    ).rejects.toThrow("NEXT_REDIRECT /dashboard");

    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: VERIFIED.id, code: "123456" });
    expect(info).toHaveBeenCalledWith("auth.mfa_verified", expect.objectContaining({ audit: true }));
  });

  it("goes where the learner was heading, and only to a same-site path", async () => {
    await expect(
      verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123456", next: "/billing/trial" })),
    ).rejects.toThrow("NEXT_REDIRECT /billing/trial");
    await expect(
      verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123456", next: "//evil.example" })),
    ).rejects.toThrow("NEXT_REDIRECT /dashboard");
  });

  it("says a wrong code did not work and logs the attempt against a pseudonym", async () => {
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "wrong" } });

    const state = await verifyMfaAction(INITIAL_CODE_STATE, form({ code: "000000" }));

    expect(state.status).toBe("error");
    expect(state.message).toMatch(/did not work/);
    expect(warn).toHaveBeenCalledWith("auth.mfa_failed", { audit: true, userIdHash: `pseudo:${LEARNER}` });
  });

  it("refuses a code that is not six digits before the provider sees it", async () => {
    const state = await verifyMfaAction(INITIAL_CODE_STATE, form({ code: "12345" }));

    expect(state.status).toBe("error");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("stops guessing after the quota", async () => {
    check.mockResolvedValue({ allowed: false });

    const state = await verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123456" }));

    expect(state.message).toMatch(/too many attempts/i);
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("sends an account with nothing to answer to enrolment, keeping the destination", async () => {
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });

    await expect(
      verifyMfaAction(INITIAL_CODE_STATE, form({ code: "123456", next: "/chat" })),
    ).rejects.toThrow("NEXT_REDIRECT /auth/mfa/enrol?next=%2Fchat");
  });
});

describe("enrolmentAction", () => {
  const BEGUN: EnrolmentFormState = {
    status: "enrolling",
    message: null,
    factorId: "f-new",
    qrCode: "data:image/svg+xml,",
    secret: "SECRET",
  };

  beforeEach(() => {
    listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
    enroll.mockResolvedValue({
      data: { id: "f-new", totp: { qr_code: "data:image/svg+xml,", secret: "SECRET", uri: "otpauth://" } },
      error: null,
    });
  });

  it("begins by minting a factor named for the product", async () => {
    const state = await enrolmentAction(INITIAL_ENROLMENT_STATE, form({ intent: "begin" }));

    expect(state).toEqual(BEGUN);
    expect(enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Deutsch Partner" });
  });

  it("sends an account that already has an authenticator to answer it instead", async () => {
    listFactors.mockResolvedValue({ data: { totp: [VERIFIED], all: [VERIFIED] }, error: null });

    await expect(
      enrolmentAction(INITIAL_ENROLMENT_STATE, form({ intent: "begin", next: "/chat" })),
    ).rejects.toThrow("NEXT_REDIRECT /auth/mfa?next=%2Fchat");
  });

  it("treats a confirm with nothing minted yet as a begin", async () => {
    const state = await enrolmentAction(INITIAL_ENROLMENT_STATE, form({ intent: "confirm", code: "123456" }));

    expect(state.status).toBe("enrolling");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("confirms the factor the begin step minted, if it is this account's", async () => {
    const minted = { id: "f-new", status: "unverified", factor_type: "totp" };
    listFactors.mockResolvedValue({ data: { totp: [minted], all: [minted] }, error: null });

    await expect(
      enrolmentAction(BEGUN, form({ intent: "confirm", code: "123456", next: "/onboarding" })),
    ).rejects.toThrow("NEXT_REDIRECT /onboarding");

    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "f-new", code: "123456" });
    expect(info).toHaveBeenCalledWith("auth.mfa_enrolled", expect.objectContaining({ audit: true }));
  });

  it("starts over when the factor in the form's state is not this account's", async () => {
    await expect(enrolmentAction(BEGUN, form({ intent: "confirm", code: "123456" }))).rejects.toThrow(
      "NEXT_REDIRECT /auth/mfa/enrol",
    );
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("keeps the QR code on screen when the first code is wrong", async () => {
    const minted = { id: "f-new", status: "unverified", factor_type: "totp" };
    listFactors.mockResolvedValue({ data: { totp: [minted], all: [minted] }, error: null });
    challengeAndVerify.mockResolvedValue({ data: null, error: { message: "wrong" } });

    const state = await enrolmentAction(BEGUN, form({ intent: "confirm", code: "000000" }));

    expect(state).toEqual({ ...BEGUN, status: "error", message: expect.stringMatching(/did not work/) });
    expect(warn).toHaveBeenCalledWith(
      "auth.mfa_failed",
      expect.objectContaining({ audit: true, enrolling: true }),
    );
  });

  it("says so when the provider will not start enrolment", async () => {
    enroll.mockResolvedValue({ data: null, error: { message: "no" } });

    const state = await enrolmentAction(INITIAL_ENROLMENT_STATE, form({ intent: "begin" }));

    expect(state.status).toBe("error");
    expect(state.message).toMatch(/try again/i);
  });

  it("asks a learner with no session to sign in first", async () => {
    session(null);
    await expect(enrolmentAction(INITIAL_ENROLMENT_STATE, form({ intent: "begin" }))).rejects.toThrow(
      "NEXT_REDIRECT /auth/login",
    );
  });
});
