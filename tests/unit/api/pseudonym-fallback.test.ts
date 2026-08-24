import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The pseudonym a Server Action logs with.
 *
 * `serverEnv()` caches on first read, so each case gets a fresh module graph
 * rather than a shared one that already made up its mind about the salt.
 */
async function compositionWith(salt: string | undefined) {
  vi.resetModules();
  if (salt === undefined) vi.stubEnv("LOG_PSEUDONYM_SALT", "");
  else vi.stubEnv("LOG_PSEUDONYM_SALT", salt);

  return import("@/lib/api/composition");
}

const LEARNER = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the pseudonym a log line carries", () => {
  it("is a keyed digest when the salt is configured", async () => {
    const { pseudonymOrUnavailable, PSEUDONYM_UNAVAILABLE } =
      await compositionWith("a-real-salt");

    const hash = pseudonymOrUnavailable(LEARNER);

    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toBe(PSEUDONYM_UNAVAILABLE);
    expect(hash).not.toContain(LEARNER);
  });

  it("is stable, so two lines about one learner can be joined", async () => {
    const { pseudonymOrUnavailable } = await compositionWith("a-real-salt");

    expect(pseudonymOrUnavailable(LEARNER)).toBe(pseudonymOrUnavailable(LEARNER));
  });

  it("says it does not have one rather than failing the learner's request", async () => {
    // An unset observability salt must not be able to stop somebody deleting
    // their own conversation. The event is still written; the identity is not.
    const { pseudonymOrUnavailable, PSEUDONYM_UNAVAILABLE } =
      await compositionWith(undefined);

    expect(pseudonymOrUnavailable(LEARNER)).toBe(PSEUDONYM_UNAVAILABLE);
  });

  it("refuses a salt that is only whitespace, rather than hashing with it", async () => {
    // The failure this guards is quiet: a blank-looking salt that still passes
    // an is-it-set check produces digests anybody can reproduce.
    const { pseudonymOrUnavailable, PSEUDONYM_UNAVAILABLE } =
      await compositionWith("   ");

    expect(pseudonymOrUnavailable(LEARNER)).toBe(PSEUDONYM_UNAVAILABLE);
  });

  it("still fails loudly where a missing pseudonym would corrupt the ledger", async () => {
    // The strict version is what the gateway uses. A ledger row that cannot be
    // attributed is worth refusing to write.
    const { pseudonymFor } = await compositionWith(undefined);

    expect(() => pseudonymFor(LEARNER)).toThrow();
  });
});
