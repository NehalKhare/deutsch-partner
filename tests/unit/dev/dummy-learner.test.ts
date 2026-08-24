import { describe, expect, it } from "vitest";

import {
  DUMMY_LEARNER_EMAIL,
  DUMMY_LEARNER_ONBOARDING,
  usesReservedDomain,
} from "@/lib/dev/dummy-learner";
import { onboardingInputSchema } from "@/lib/onboarding/input";
import {
  MAX_SELECTED_INTERESTS,
  MAX_SELECTED_TOPICS,
} from "@/lib/onboarding/defaults";

describe("the fixture learner", () => {
  it("uses an address that can never reach a real inbox", () => {
    expect(usesReservedDomain(DUMMY_LEARNER_EMAIL)).toBe(true);
  });

  it("recognises an address that would reach a real inbox", () => {
    expect(usesReservedDomain("someone@gmail.com")).toBe(false);
    expect(usesReservedDomain("someone@notexample.com")).toBe(false);
    expect(usesReservedDomain("no-at-sign")).toBe(false);
  });

  it("allows a subdomain of a reserved domain", () => {
    expect(usesReservedDomain("a@mail.example.com")).toBe(true);
  });

  it("answers onboarding with choices the form actually offers", () => {
    expect(onboardingInputSchema.safeParse(DUMMY_LEARNER_ONBOARDING).success).toBe(
      true,
    );
  });

  it("stays inside the caps the form enforces", () => {
    expect(DUMMY_LEARNER_ONBOARDING.targetTopics.length).toBeLessThanOrEqual(
      MAX_SELECTED_TOPICS,
    );
    expect(DUMMY_LEARNER_ONBOARDING.interests.length).toBeLessThanOrEqual(
      MAX_SELECTED_INTERESTS,
    );
  });

  it("carries no password, so nothing usable is committed", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/dev/dummy-learner.ts", "utf8"),
    );

    expect(source.toLowerCase()).not.toMatch(/password\s*[:=]\s*["'`]/);
  });
});
