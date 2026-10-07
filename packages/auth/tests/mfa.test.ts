import { describe, expect, it, vi } from "vitest";

import {
  beginTotpEnrolment,
  ownsFactor,
  totpCodeSchema,
  verifiedTotpFactor,
  verifyTotp,
  type MfaClient,
  type MfaFactor,
} from "../src/mfa";

/**
 * The slice of Supabase's MFA client both apps sign in through. The flows
 * are tested in each app; here is only what the helpers promise them: which
 * factor is challenged, what enrolment clears away first, and that nothing
 * but six digits ever reaches the provider.
 */

function fakeClient(factors: MfaFactor[]) {
  const mfa = {
    listFactors: vi.fn(async () => ({ data: { totp: factors, all: factors }, error: null })),
    enroll: vi.fn(async () => ({
      data: { id: "new-factor", totp: { qr_code: "data:image/svg+xml,", secret: "SECRET", uri: "otpauth://" } },
      error: null,
    })),
    challengeAndVerify: vi.fn(async () => ({ data: {}, error: null })),
    unenroll: vi.fn(async () => ({ error: null })),
  };
  return { client: { auth: { mfa } } as unknown as MfaClient, mfa };
}

const VERIFIED: MfaFactor = { id: "f-verified", status: "verified", factor_type: "totp" };
const ABANDONED: MfaFactor = { id: "f-abandoned", status: "unverified", factor_type: "totp" };

describe("totpCodeSchema", () => {
  it("accepts six digits, with the spaces an app may show between them", () => {
    expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
  });

  it.each(["12345", "1234567", "abcdef", "", "12 34 5"])("refuses %j before the provider sees it", (code) => {
    expect(totpCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("verifiedTotpFactor", () => {
  it("picks the verified factor and ignores an abandoned enrolment", async () => {
    const { client } = fakeClient([ABANDONED, VERIFIED]);
    expect(await verifiedTotpFactor(client)).toEqual(VERIFIED);
  });

  it("is null for an account with nothing enrolled", async () => {
    const { client } = fakeClient([]);
    expect(await verifiedTotpFactor(client)).toBeNull();
  });

  it("is null when the factors cannot be listed, rather than guessing", async () => {
    const { client, mfa } = fakeClient([VERIFIED]);
    mfa.listFactors.mockResolvedValueOnce({ data: null, error: { message: "down" } } as never);
    expect(await verifiedTotpFactor(client)).toBeNull();
  });
});

describe("beginTotpEnrolment", () => {
  it("clears an abandoned enrolment first, since it would block a new one", async () => {
    const { client, mfa } = fakeClient([ABANDONED]);

    const begun = await beginTotpEnrolment(client, "Deutsch Partner");

    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: ABANDONED.id });
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Deutsch Partner" });
    expect(begun).toEqual({ factorId: "new-factor", qrCode: "data:image/svg+xml,", secret: "SECRET" });
  });

  it("leaves a verified factor alone", async () => {
    const { client, mfa } = fakeClient([VERIFIED]);
    await beginTotpEnrolment(client, "Deutsch Partner");
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it("is null when the provider refuses", async () => {
    const { client, mfa } = fakeClient([]);
    mfa.enroll.mockResolvedValueOnce({ data: null, error: { message: "no" } } as never);
    expect(await beginTotpEnrolment(client, "Deutsch Partner")).toBeNull();
  });
});

describe("ownsFactor", () => {
  it("is true only for a factor on the signed-in account", async () => {
    const { client } = fakeClient([VERIFIED]);
    expect(await ownsFactor(client, VERIFIED.id)).toBe(true);
    expect(await ownsFactor(client, "someone-elses")).toBe(false);
  });
});

describe("verifyTotp", () => {
  it("is true when the challenge is answered", async () => {
    const { client, mfa } = fakeClient([VERIFIED]);
    expect(await verifyTotp(client, VERIFIED.id, "123456")).toBe(true);
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: VERIFIED.id, code: "123456" });
  });

  it("is false when it is not", async () => {
    const { client, mfa } = fakeClient([VERIFIED]);
    mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { message: "wrong" } } as never);
    expect(await verifyTotp(client, VERIFIED.id, "000000")).toBe(false);
  });
});
