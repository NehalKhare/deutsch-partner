import {
  credentialsSchema,
  type Credentials,
} from "@/lib/auth/credentials";
import {
  authFailure,
  mapAuthError,
  type AuthFailure,
} from "@/lib/auth/errors";

export type AuthResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: AuthFailure };

interface AuthResponse {
  data: { user?: { id: string } | null; session?: unknown | null } | null;
  error: { code?: string | null; message?: string | null } | null;
}

/** The slice of the Supabase auth client this service uses. */
export interface AuthClient {
  auth: {
    signUp(credentials: Credentials): Promise<AuthResponse>;
    signInWithPassword(credentials: Credentials): Promise<AuthResponse>;
    signOut(): Promise<{ error: { message?: string | null } | null }>;
  };
}

export interface AuthService {
  signUp(input: unknown): Promise<AuthResult<{ needsEmailConfirmation: boolean }>>;
  signIn(input: unknown): Promise<AuthResult<{ userId: string }>>;
  signOut(): Promise<AuthResult<null>>;
}

/** Errors that mean "this address already has an account", in some form. */
const ENUMERATION_CODES = new Set([
  "user_already_exists",
  "email_exists",
  "email_address_not_authorized",
]);

export function createAuthService(client: AuthClient): AuthService {
  return {
    async signUp(input) {
      const parsed = credentialsSchema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: authFailure("invalid_input") };
      }

      const { data, error } = await client.auth.signUp(parsed.data);

      if (error) {
        // Answer identically whether or not the address is already taken.
        // The learner is told to check their inbox either way, and someone
        // probing addresses learns nothing.
        if (error.code && ENUMERATION_CODES.has(error.code)) {
          return { ok: true, data: { needsEmailConfirmation: true } };
        }
        return { ok: false, error: mapAuthError(error) };
      }

      return {
        ok: true,
        data: { needsEmailConfirmation: !data?.session },
      };
    },

    async signIn(input) {
      const parsed = credentialsSchema.safeParse(input);
      if (!parsed.success) {
        // A malformed email is reported as bad credentials rather than as a
        // validation error, so probing cannot distinguish the two.
        return { ok: false, error: authFailure("invalid_credentials") };
      }

      const { data, error } = await client.auth.signInWithPassword(parsed.data);

      if (error) return { ok: false, error: mapAuthError(error) };
      if (!data?.user) {
        return { ok: false, error: authFailure("invalid_credentials") };
      }

      return { ok: true, data: { userId: data.user.id } };
    },

    async signOut() {
      // The session cookie is cleared regardless of what the provider says.
      // Leaving somebody unable to sign out is worse than a silent hiccup.
      await client.auth.signOut();

      return { ok: true, data: null };
    },
  };
}
