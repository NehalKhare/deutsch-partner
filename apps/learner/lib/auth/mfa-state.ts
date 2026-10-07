/**
 * Form state shared between the second-factor Server Actions and their forms.
 *
 * Outside actions.ts deliberately: a "use server" module may only export
 * async functions, so a constant or a type declared alongside the actions
 * breaks the whole module at runtime.
 */

export interface CodeFormState {
  readonly status: "idle" | "error";
  readonly message: string | null;
}

export const INITIAL_CODE_STATE: CodeFormState = { status: "idle", message: null };

export interface EnrolmentFormState {
  readonly status: "idle" | "enrolling" | "error";
  readonly message: string | null;
  /** Present once enrolment has begun: what the authenticator app scans. */
  readonly factorId: string | null;
  readonly qrCode: string | null;
  readonly secret: string | null;
}

export const INITIAL_ENROLMENT_STATE: EnrolmentFormState = {
  status: "idle",
  message: null,
  factorId: null,
  qrCode: null,
  secret: null,
};

/**
 * What the authenticator app shows beside the code. Distinct from the
 * operator app's name, so a learner who is also an operator can tell the two
 * entries apart.
 */
export const FACTOR_NAME = "Deutsch Partner";

export const CODE_FAILURE = "That code did not work. Try the next one.";
export const ENROLMENT_FAILURE = "Could not start setting up your authenticator. Try again.";
export const TOO_MANY_ATTEMPTS = "Too many attempts. Wait a few minutes and try again.";
