import "server-only";

import { readSessionClaims, type SessionClaims } from "@dp/auth/claims";

import { createServerSupabaseClient } from "@/lib/supabase/server-client";

/**
 * The signed-in account, or null.
 *
 * Derived from a verified token, never from a request body. The assurance
 * level rides along because every operator page requires the second factor:
 * a password alone gets the challenge page, not the board.
 */
export async function getOperatorSession(): Promise<SessionClaims | null> {
  try {
    return await readSessionClaims(await createServerSupabaseClient());
  } catch {
    return null;
  }
}
