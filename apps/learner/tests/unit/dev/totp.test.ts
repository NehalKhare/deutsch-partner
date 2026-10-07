import { describe, expect, it } from "vitest";

import { base32Decode, totpCode } from "@/lib/dev/totp";

/**
 * RFC 6238's own test vectors, appendix B: the ASCII secret
 * "12345678901234567890" in base32, SHA-1, truncated to six digits.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32Decode", () => {
  it("decodes the RFC's secret back to its ASCII bytes", () => {
    expect(base32Decode(RFC_SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it("is indifferent to case, padding and the spaces an app may show", () => {
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==")).toEqual(
      base32Decode(RFC_SECRET),
    );
  });

  it("refuses a character outside the alphabet rather than guessing", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow(/base32/);
  });
});

describe("totpCode", () => {
  it.each([
    [59_000, "287082"],
    [1_111_111_109_000, "081804"],
    [1_234_567_890_000, "005924"],
    [2_000_000_000_000, "279037"],
  ])("at %d ms reads %s, as RFC 6238 says it should", (atMs, expected) => {
    expect(totpCode(RFC_SECRET, atMs)).toBe(expected);
  });

  it("holds a code steady within its thirty-second step", () => {
    expect(totpCode(RFC_SECRET, 30_000)).toBe(totpCode(RFC_SECRET, 59_999));
    expect(totpCode(RFC_SECRET, 30_000)).not.toBe(totpCode(RFC_SECRET, 60_000));
  });

  it("keeps leading zeros, which an authenticator shows and a form needs", () => {
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toHaveLength(6);
  });
});
