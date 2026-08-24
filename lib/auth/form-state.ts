/**
 * Form state shared between the auth Server Actions and the form component.
 *
 * This lives outside actions.ts deliberately: a "use server" module may only
 * export async functions, so a constant or a type declared alongside the
 * actions breaks the whole module at runtime.
 */

export interface AuthFormState {
  readonly message: string | null;
  readonly status: "idle" | "error" | "check_email";
}

export const INITIAL_AUTH_STATE: AuthFormState = {
  message: null,
  status: "idle",
};
