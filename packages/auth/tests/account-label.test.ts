import { describe, expect, it } from "vitest";

import { ANONYMOUS_LABEL, accountLabel } from "../src/account";

/**
 * What the shell calls the person signed into it.
 *
 * The product holds no name — a profile records how somebody learns, never who
 * they are — so this is the address, shortened to what fits. The rule worth
 * testing is the one it refuses to break: it never invents a name.
 */

describe("the label on the account button", () => {
  it("is the local part of the address", () => {
    expect(accountLabel("nehal.khare@gmail.com")).toBe("nehal.khare");
  });

  it("leaves the local part exactly as the person wrote it", () => {
    // No capitalising, no splitting on the dot, no "N Khare". Being addressed
    // by a name the product guessed at is worse than being addressed by your
    // own handle, and there is nothing here to guess from.
    expect(accountLabel("n.khare@example.com")).toBe("n.khare");
    expect(accountLabel("jonas+de@example.com")).toBe("jonas+de");
  });

  it("keeps the last @ as the separator, so an odd address survives", () => {
    expect(accountLabel('"a@b"@example.com')).toBe('"a@b"');
  });

  it("shows something that is not an address rather than hiding it", () => {
    expect(accountLabel("operator")).toBe("operator");
  });

  it("falls back to a neutral word when there is no address at all", () => {
    // Not every sign-in method carries one, and the shell still has to render.
    expect(accountLabel(null)).toBe(ANONYMOUS_LABEL);
    expect(accountLabel(undefined)).toBe(ANONYMOUS_LABEL);
    expect(accountLabel("   ")).toBe(ANONYMOUS_LABEL);
  });

  it("is never empty, which would leave a button with no name", () => {
    expect(accountLabel("@example.com")).toBe("@example.com");
  });
});
