import {
  onboardingInputSchema,
  type OnboardingInput,
} from "@dp/domain/onboarding/input";

/**
 * A fixture learner for local development and manual testing.
 *
 * Nothing here is a secret and nothing here is real. The address sits on
 * example.com, which IANA reserves precisely so it can never be delivered to,
 * so the account cannot be used to mail anybody and cannot collide with a
 * person's address. The password is not defined here at all — the seeding
 * script generates one and prints it, so no working credential is ever
 * committed to the repository.
 *
 * The account is created through the ordinary sign-in and onboarding path
 * rather than by writing rows behind it, so seeding it also proves that path
 * still works.
 */
export const DUMMY_LEARNER_EMAIL = "dummy.learner@example.com";

/** The reserved domains an address may use, so no real inbox is ever hit. */
export const RESERVED_EMAIL_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
] as const;

export function usesReservedDomain(email: string): boolean {
  const domain = email.split("@").at(1)?.toLowerCase();

  return RESERVED_EMAIL_DOMAINS.some(
    (reserved) => domain === reserved || domain?.endsWith(`.${reserved}`),
  );
}

/**
 * What the fixture learner answered during onboarding.
 *
 * Parsed rather than merely typed: the option lists are closed sets, so a
 * fixture that drifts out of them should fail here rather than at the
 * database.
 */
export const DUMMY_LEARNER_ONBOARDING: OnboardingInput =
  onboardingInputSchema.parse({
    learningGoal:
      "Hold a relaxed conversation with my colleagues in Berlin without switching to English.",
    selectedLevel: "A2",
    targetTopics: ["daily_life", "work", "food"],
    interests: ["cooking", "cycling", "films"],
    inputPreference: "text",
    outputPreference: "text",
    correctionPreference: "gentle",
  });
