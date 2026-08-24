import "server-only";

import { redirect } from "next/navigation";
import { z } from "zod";

import { LOGIN_PATH } from "@/lib/auth/routes";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

const subjectSchema = z.uuid();

/**
 * The signed-in learner's id, or null.
 *
 * Derived from a verified token, never from a request body or a client-supplied
 * parameter. getClaims verifies the JWT against the project's signing keys —
 * locally where asymmetric keys are configured — so this is safe to use as the
 * identity the rest of a request is scoped to.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;

    // The claim selects which learner's rows we read, so it must be the shape
    // the database expects, not merely present.
    const subject = subjectSchema.safeParse(data?.claims?.sub);

    return subject.success ? subject.data : null;
  } catch {
    return null;
  }
}

/** As above, but sends the learner to sign in instead of returning null. */
export async function requireAuthenticatedUserId(): Promise<string> {
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect(LOGIN_PATH);

  return userId;
}
