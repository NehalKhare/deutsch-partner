/**
 * Shared between the onboarding Server Action and its form. Kept out of the
 * action module because "use server" files may export only async functions.
 */
export interface OnboardingFormState {
  readonly message: string | null;
  readonly status: "idle" | "error";
}

export const INITIAL_ONBOARDING_STATE: OnboardingFormState = {
  message: null,
  status: "idle",
};
