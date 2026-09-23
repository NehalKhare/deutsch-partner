/**
 * Form state shared between the login Server Actions and their forms.
 *
 * Outside actions.ts deliberately: a "use server" module may only export
 * async functions, so a constant or a type declared alongside the actions
 * breaks the whole module at runtime.
 */

export interface LoginFormState {
  readonly status: "idle" | "error";
  readonly message: string | null;
}

export const INITIAL_LOGIN_STATE: LoginFormState = { status: "idle", message: null };

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

/** One message for every way a sign-in can fail, so nothing is enumerable. */
export const GENERIC_SIGN_IN_FAILURE = "That email and password did not work.";
export const CODE_FAILURE = "That code did not work. Try the next one.";
export const TOO_MANY_ATTEMPTS = "Too many attempts. Wait a few minutes and try again.";
