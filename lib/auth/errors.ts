/**
 * Auth error mapping.
 *
 * Provider messages are never shown to a learner: they leak internals, and in
 * the sign-in path they can leak whether an account exists. Every failure is
 * translated into a closed set of codes with messages written for a person.
 */

export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "weak_password"
  | "signup_disabled"
  | "unknown";

export const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  invalid_input: "Please check the details you entered and try again.",
  // Identical for a wrong password and an address with no account.
  invalid_credentials: "That email and password combination did not work.",
  email_not_confirmed:
    "Please confirm your email address first. Check your inbox for the link.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  weak_password: "Please choose a longer or less predictable password.",
  signup_disabled: "New accounts are not being accepted at the moment.",
  unknown: "Something went wrong. Please try again.",
};

const CODE_MAP: Readonly<Record<string, AuthErrorCode>> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  over_email_send_rate_limit: "rate_limited",
  over_request_rate_limit: "rate_limited",
  over_sms_send_rate_limit: "rate_limited",
  weak_password: "weak_password",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
};

export interface AuthProviderError {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

export interface AuthFailure {
  readonly code: AuthErrorCode;
  readonly message: string;
}

export function authFailure(code: AuthErrorCode): AuthFailure {
  return { code, message: AUTH_ERROR_MESSAGES[code] };
}

export function mapAuthError(error: AuthProviderError | null | undefined): AuthFailure {
  const code = (error?.code && CODE_MAP[error.code]) || "unknown";

  return authFailure(code);
}
