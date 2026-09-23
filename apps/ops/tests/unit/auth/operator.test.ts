import { describe, expect, it } from "vitest";

import { parseOperatorIds } from "@dp/auth/operator";

import { isOperator, operatorIds } from "@/lib/auth/operator";

describe("who counts as an operator", () => {
  it("is nobody when the allowlist is unset", () => {
    // The safe reading of an absent allowlist.
    expect(operatorIds()).toEqual([]);
    expect(isOperator("11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("is nobody for a null caller", () => {
    expect(isOperator(null)).toBe(false);
  });

  it("reads a well-formed allowlist", () => {
    expect(
      parseOperatorIds(
        " 11111111-1111-4111-8111-111111111111 , 22222222-2222-4222-8222-222222222222 ",
      ),
    ).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("is nobody when one entry is malformed", () => {
    // Not a partial allowlist. Guessing which half was meant is how an
    // operator route quietly opens.
    expect(
      parseOperatorIds("11111111-1111-4111-8111-111111111111,not-a-uuid"),
    ).toEqual([]);
  });

  it("is nobody for an empty or absent allowlist", () => {
    expect(parseOperatorIds(undefined)).toEqual([]);
    expect(parseOperatorIds("")).toEqual([]);
    expect(parseOperatorIds("   ")).toEqual([]);
  });

  it("treats a wildcard as malformed rather than as everybody", () => {
    expect(parseOperatorIds("*")).toEqual([]);
  });
});
